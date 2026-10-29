const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildRoutePath, parseRouteFromHref } = require('../src/runtime/app/router-url.ts');

const pageRegistry = [
  { id: 'home', name: '首页', template: 'page', active: true },
  { id: 'projects', name: '项目', template: 'projects', active: false },
  { id: 'articles', name: '文章', template: 'articles', active: false },
];

test('Phase 9 router：应从路径式 URL 和 hash 解析有效单页路由', () => {
  const route = parseRouteFromHref('https://example.com/page/projects/#开源项目', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.deepEqual(route, {
    pageId: 'projects',
    rawPageId: 'projects',
    hash: '开源项目',
    shouldReplaceUrl: false,
  });
});

test('Phase 9 router：应同时接受无尾斜杠形式的路径式 URL', () => {
  const route = parseRouteFromHref('https://example.com/page/articles', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.equal(route.pageId, 'articles');
  assert.equal(route.rawPageId, 'articles');
  assert.equal(route.shouldReplaceUrl, false);
});

test('Phase 9 router：旧式 ?page 链接应解析出页面并要求迁移为路径式', () => {
  const route = parseRouteFromHref('https://example.com/?page=projects#开源项目', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.equal(route.pageId, 'projects');
  assert.equal(route.rawPageId, 'projects');
  assert.equal(route.hash, '开源项目');
  assert.equal(route.shouldReplaceUrl, true);
});

test('Phase 9 router：未知 page 应回退首页并要求规范化 URL', () => {
  const route = parseRouteFromHref('https://example.com/page/missing/#abc', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.equal(route.pageId, 'home');
  assert.equal(route.rawPageId, 'missing');
  assert.equal(route.hash, 'abc');
  assert.equal(route.shouldReplaceUrl, true);
});

test('Phase 9 router：根路径应回退首页且不改写 URL', () => {
  const route = parseRouteFromHref('https://example.com/#置顶', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.equal(route.pageId, 'home');
  assert.equal(route.rawPageId, '');
  assert.equal(route.hash, '置顶');
  assert.equal(route.shouldReplaceUrl, false);
});

test('Phase 9 router：非 /page/ 路径应回退首页并要求规范化 URL', () => {
  const route = parseRouteFromHref('https://example.com/legacy-path/', {
    pageRegistry,
    homePageId: 'home',
  });

  assert.equal(route.pageId, 'home');
  assert.equal(route.shouldReplaceUrl, true);
});

test('Phase 9 router：应构造路径式 /page/<pageId>/#<categorySlug> URL', () => {
  assert.equal(
    buildRoutePath('https://example.com/page/home/#old', {
      pageId: 'projects',
      hash: '开源项目',
    }),
    '/page/projects/#%E5%BC%80%E6%BA%90%E9%A1%B9%E7%9B%AE'
  );

  assert.equal(
    buildRoutePath('https://example.com/page/projects/#old', {
      pageId: 'articles',
      hash: '',
    }),
    '/page/articles/'
  );
});

test('Phase 9 router：构造 URL 时应丢弃残留的 ?page= 并保留其它查询参数', () => {
  assert.equal(
    buildRoutePath('https://example.com/?page=home&utm_source=nav#old', {
      pageId: 'projects',
      hash: '',
    }),
    '/page/projects/?utm_source=nav'
  );
});

test('Phase 9 router：带部署基路径时应生成 /<base>/page/<pageId>/', () => {
  const options = { pageRegistry, homePageId: 'home', basePath: '/menav' };

  const route = parseRouteFromHref('https://example.com/menav/page/articles/#置顶', options);
  assert.equal(route.pageId, 'articles');
  assert.equal(route.hash, '置顶');
  assert.equal(route.shouldReplaceUrl, false);

  assert.equal(
    buildRoutePath(
      'https://example.com/menav/page/articles/',
      { pageId: 'projects', hash: '' },
      { basePath: '/menav' }
    ),
    '/menav/page/projects/'
  );

  // 裸基路径视作首页
  const root = parseRouteFromHref('https://example.com/menav', options);
  assert.equal(root.pageId, 'home');
  assert.equal(root.shouldReplaceUrl, false);
});

test('Phase 9 runtime：router 应绑定 popstate 并用 pushState 记录导航历史', () => {
  const router = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'runtime', 'app', 'router.ts'),
    'utf8'
  );

  assert.match(router, /addEventListener\('popstate'/);
  // 导航项点击：跨页 pushState（保留新页历史）
  assert.match(router, /setUrlState\(\{ pageId, hash: '' \}, \{ replace: false \}\)/);
  // 子菜单点击（双 pushState 修复）：同页 replace 当前条目，避免冗余中间历史态
  assert.match(router, /setUrlState\(\{ pageId, hash: '' \}, \{ replace: wasSamePage \}\)/);
  assert.ok(!router.includes('/<id>'), 'router 不应恢复旧路径回跳模型');
});
