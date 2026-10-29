const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildPagePath,
  normalizeBasePath,
  withBasePath,
} = require('../src/shared/base-path.ts');
const {
  parsePageIdFromPath,
  parseRouteFromHref,
  stripBasePath,
} = require('../src/runtime/app/router-url.ts');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('base-path：归一化应去除尾斜杠并把根路径视作空串', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('menav'), '/menav');
  assert.equal(normalizeBasePath('/menav/'), '/menav');
  assert.equal(normalizeBasePath('//menav//sub//'), '/menav/sub');
  assert.equal(normalizeBasePath(null), '');
  assert.equal(normalizeBasePath(undefined), '');
});

test('base-path：站内资源拼接应保留绝对 URL 原样', () => {
  assert.equal(withBasePath('', 'script.js'), '/script.js');
  assert.equal(withBasePath('', '/script.js'), '/script.js');
  assert.equal(withBasePath('/menav', 'script.js'), '/menav/script.js');
  assert.equal(withBasePath('/menav', '/assets/style.css'), '/menav/assets/style.css');
  assert.equal(withBasePath('/menav', ''), '/menav/');
  assert.equal(withBasePath('', ''), '/');
  assert.equal(withBasePath('/menav', 'https://cdn.example.com/a.css'), 'https://cdn.example.com/a.css');
  assert.equal(withBasePath('/menav', 'mailto:a@b.c'), 'mailto:a@b.c');
});

test('base-path：页面路径应带尾斜杠并可携带分类 hash', () => {
  assert.equal(buildPagePath({ pageId: 'common' }), '/page/common/');
  assert.equal(buildPagePath({ basePath: '/menav', pageId: 'common' }), '/menav/page/common/');
  assert.equal(
    buildPagePath({ basePath: '/menav', pageId: 'common', hash: '#置顶' }),
    '/menav/page/common/#%E7%BD%AE%E9%A1%B6'
  );
  assert.equal(buildPagePath({ basePath: '/menav', pageId: '' }), '/menav/');
});

test('router-url：应从 pathname 中剥离部署基路径', () => {
  assert.equal(stripBasePath('/menav/page/common/', '/menav'), '/page/common/');
  assert.equal(stripBasePath('/menav', '/menav'), '/');
  assert.equal(stripBasePath('/page/common/', ''), '/page/common/');
  // 不属于基路径的请求原样返回，交由上层按未知路径处理
  assert.equal(stripBasePath('/other/page/common/', '/menav'), '/other/page/common/');
});

test('router-url：应只把 /page/<pageId>/ 识别为页面深链接', () => {
  assert.equal(parsePageIdFromPath('/page/common/'), 'common');
  assert.equal(parsePageIdFromPath('/page/my-page'), 'my-page');
  assert.equal(parsePageIdFromPath('/page/'), '');
  assert.equal(parsePageIdFromPath('/'), '');
  assert.equal(parsePageIdFromPath('/pages/common/'), '');
  assert.equal(parsePageIdFromPath('/page/common/extra/'), '');
});

test('router-url：带基路径时未知路径应回退首页并触发规范化', () => {
  const pageRegistry = [
    { id: 'common', name: '常用', template: 'page', active: true },
    { id: 'projects', name: '项目', template: 'projects', active: false },
  ];

  const route = parseRouteFromHref('https://example.com/menav/unknown/', {
    pageRegistry,
    homePageId: 'common',
    basePath: '/menav',
  });

  assert.equal(route.pageId, 'common');
  assert.equal(route.shouldReplaceUrl, true);
});

test('SSR：导航不再产出 ?page= 查询参数式链接', () => {
  const navigation = read('src/components/Navigation.astro');
  assert.ok(!navigation.includes('?page='), 'Navigation 应使用路径式页面链接');
  assert.ok(navigation.includes('pageUrl('), 'Navigation 应通过 pageUrl 生成链接');
});

test('SSR：资源引用应走基路径而不是相对路径', () => {
  const layout = read('src/layouts/DefaultLayout.astro');
  const runtimeScripts = read('src/components/RuntimeScripts.astro');

  assert.ok(!layout.includes('href="./assets/style.css"'), '样式应走 assetUrl');
  assert.ok(layout.includes('assetUrl('), '布局应通过 assetUrl 生成资源地址');
  assert.ok(layout.includes('data-base-path'), '布局应注入 data-base-path 供运行时读取');
  assert.ok(runtimeScripts.includes('assetUrl('), '运行时脚本应走 assetUrl');
});

test('部署：GitHub Pages 构建应声明项目站点基路径', () => {
  const workflow = read('.github/workflows/deploy.yml');
  assert.match(workflow, /MENAV_BASE_PATH:\s*\/menav/);
});

test('构建：每个导航页都应产出独立的静态路由文件', () => {
  const routePage = read('src/pages/page/[pageId].astro');
  assert.ok(routePage.includes('getStaticPaths'), '页面路由必须在构建期展开');
  assert.ok(routePage.includes('buildRenderData'), '页面路由应复用统一渲染数据');
});
