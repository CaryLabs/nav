const assert = require('node:assert/strict');
const path = require('node:path');

const { chromium } = require('playwright');
const { startServer } = require('../../scripts/serve-dist.ts');
const { normalizeBasePath } = require('../../src/shared/base-path.ts');

// 与构建期一致的部署基路径：设置 MENAV_BASE_PATH 时契约按子路径访问
const BASE_PATH = normalizeBasePath(process.env.MENAV_BASE_PATH || '');
const { createLogger, startTimer } = require('../../src/lib/logging/logger.ts');

const log = createLogger('browser-contract');

async function waitForMenav(page) {
  await page.waitForFunction(() => Boolean(document.getElementById('menav-runtime-config')), null, {
    timeout: 5000,
  });
}

async function openPage(page, baseUrl, pathAndQuery = '/') {
  await page.goto(`${baseUrl}${pathAndQuery}`, { waitUntil: 'domcontentloaded' });
  await waitForMenav(page);
  // 给 idle 阶段发起的 search-index 请求一个落点，避免测试立即导航时把同源请求中止成控制台错误。
  await page.waitForTimeout(250);
}

function parseRgba(input) {
  const match = String(input).match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i
  );
  if (!match) return null;

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] == null ? 1 : Number(match[4]),
  };
}

async function waitForRouteState(page, expected) {
  await page.waitForFunction(
    ({ pageId, hash }) => {
      const activePageId = document.querySelector('.page.active')?.id || '';
      const activeNavId =
        document.querySelector('.nav-item.active')?.getAttribute('data-page') || '';
      const currentHash = decodeURIComponent((location.hash || '').replace(/^#/, ''));
      const pageMatches = activePageId === pageId && activeNavId === pageId;
      const hashMatches = typeof hash === 'string' ? currentHash === hash : true;

      return pageMatches && hashMatches;
    },
    expected,
    { timeout: 5000 }
  );
}

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

/**
 * 第三方资源（字体 CDN、图标 CDN、favicon 服务）在 CI 网络下的加载失败不应阻塞契约：
 * 线上可用性由真实浏览器环境保证，这里只约束站点自身资源不得报错。
 */
function isThirdPartyResourceError(message) {
  if (!/Failed to load resource/i.test(String(message.text))) return false;
  try {
    const { hostname } = new URL(message.url);
    return !LOCAL_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

async function assertNoConsoleErrors(messages) {
  const ignored = messages.filter(
    (message) => message.type === 'error' && isThirdPartyResourceError(message)
  );
  if (ignored.length > 0) {
    log.warn('忽略第三方资源加载失败（不影响站点自身契约）', {
      count: ignored.length,
      samples: ignored.slice(0, 3).map((message) => message.url),
    });
  }

  const errors = messages.filter(
    (message) => message.type === 'error' && !isThirdPartyResourceError(message)
  );
  assert.deepEqual(errors, [], `浏览器控制台不应输出 error：${JSON.stringify(errors)}`);
}

async function runRouteContract(page, baseUrl) {
  await openPage(page, baseUrl, '/');

  const routeState = await page.evaluate(() => {
    const navItems = Array.from(document.querySelectorAll('.nav-item[data-page]'));
    const pageIds = navItems.map((item) => item.getAttribute('data-page')).filter(Boolean);
    const targetPageId = pageIds.find((id) => id !== pageIds[0]);
    const targetSubmenu = targetPageId
      ? document.querySelector(
          `.submenu-item[data-page="${CSS.escape(targetPageId)}"][data-category-id]`
        )
      : null;
    const categoryId = targetSubmenu ? targetSubmenu.getAttribute('data-category-id') : '';

    return {
      pageIds,
      targetPageId,
      categoryId,
    };
  });

  assert.ok(routeState.pageIds.length >= 2, '浏览器契约需要至少两个导航页');
  assert.ok(routeState.targetPageId, '浏览器契约需要目标导航页');

  await page.evaluate((targetPageId) => {
    document.querySelector(`.nav-item[data-page="${CSS.escape(targetPageId)}"]`)?.click();
  }, routeState.targetPageId);
  await waitForRouteState(page, { pageId: routeState.targetPageId });

  const afterClick = await page.evaluate(() => ({
    activePageId: document.querySelector('.page.active')?.id || '',
    activeNavId: document.querySelector('.nav-item.active')?.getAttribute('data-page') || '',
    path: `${location.pathname}${location.search}${location.hash}`,
  }));
  assert.equal(afterClick.activePageId, routeState.targetPageId);
  assert.equal(afterClick.activeNavId, routeState.targetPageId);
  assert.equal(
    afterClick.path.startsWith(`${BASE_PATH}/page/${routeState.targetPageId}/`),
    true,
    `页面切换应写入路径式 URL，实际为 ${afterClick.path}`
  );

  // 深链接：直接打开 /page/<id>/ 时 SSR 即应为该页 active，且样式/脚本按基路径加载成功
  await openPage(page, baseUrl, `/page/${routeState.targetPageId}/`);
  const deepLink = await page.evaluate(() => ({
    activePageId: document.querySelector('.page.active')?.id || '',
    activeNavId: document.querySelector('.nav-item.active')?.getAttribute('data-page') || '',
    pathname: location.pathname,
    stylesheetLoaded: Array.from(document.styleSheets).some((sheet) => {
      if (!sheet.href || !sheet.href.includes('/assets/style.css')) return false;
      try {
        return sheet.cssRules.length > 0;
      } catch {
        return false;
      }
    }),
  }));
  assert.equal(deepLink.activePageId, routeState.targetPageId, '深链接 SSR 应直接命中目标页面');
  assert.equal(deepLink.activeNavId, routeState.targetPageId);
  assert.equal(deepLink.pathname, `${BASE_PATH}/page/${routeState.targetPageId}/`);
  assert.equal(deepLink.stylesheetLoaded, true, '深链接下样式表应按基路径命中');

  if (routeState.categoryId) {
    await page.evaluate((targetPageId) => {
      document
        .querySelector(`.submenu-item[data-page="${CSS.escape(targetPageId)}"][data-category-id]`)
        ?.click();
    }, routeState.targetPageId);
    await waitForRouteState(page, {
      pageId: routeState.targetPageId,
      hash: routeState.categoryId,
    });

    const afterSubmenu = await page.evaluate(() => ({
      path: `${location.pathname}${location.search}${location.hash}`,
    }));
    assert.ok(
      afterSubmenu.path.includes(`#${encodeURIComponent(routeState.categoryId)}`),
      '分类点击应写入 hash 深链接'
    );
  }

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await waitForRouteState(page, {
    pageId: routeState.categoryId ? routeState.targetPageId : routeState.pageIds[0],
  });
  const afterBack = await page.evaluate(() => ({
    activePageId: document.querySelector('.page.active')?.id || '',
    path: `${location.pathname}${location.search}${location.hash}`,
  }));
  assert.equal(
    afterBack.activePageId,
    routeState.categoryId ? routeState.targetPageId : routeState.pageIds[0]
  );

  await page.goForward({ waitUntil: 'domcontentloaded' });
  await waitForRouteState(page, {
    pageId: routeState.targetPageId,
    hash: routeState.categoryId || undefined,
  });

  // 旧式 ?page= 链接（含未知 id）应迁移为路径式 URL 并回退首页
  await openPage(page, baseUrl, '/?page=__missing__');
  const normalized = await page.evaluate(() => ({
    activePageId: document.querySelector('.page.active')?.id || '',
    path: `${location.pathname}${location.search}${location.hash}`,
  }));
  assert.equal(normalized.activePageId, routeState.pageIds[0]);
  assert.equal(
    normalized.path,
    `${BASE_PATH}/page/${routeState.pageIds[0]}/`,
    '旧式链接应迁移为路径式 URL'
  );

  // 旧式 ?page=<已知页> 同样应迁移并命中该页
  await openPage(page, baseUrl, `/?page=${routeState.targetPageId}`);
  const legacyKnown = await page.evaluate(() => ({
    activePageId: document.querySelector('.page.active')?.id || '',
    path: `${location.pathname}${location.search}${location.hash}`,
  }));
  assert.equal(legacyKnown.activePageId, routeState.targetPageId);
  assert.equal(legacyKnown.path, `${BASE_PATH}/page/${routeState.targetPageId}/`);

  const response404 = await page.request.get(`${baseUrl}/missing-path`);
  assert.equal(response404.status(), 404);
}

async function runRuntimeConfigContract(page, baseUrl) {
  await openPage(page, baseUrl, '/');

  const runtimeConfigState = await page.evaluate(() => {
    const script = document.getElementById('menav-runtime-config');
    const parsed = script ? JSON.parse(script.textContent || '{}') : null;

    return {
      hasRuntimeConfig: Boolean(script),
      version: parsed?.version || '',
      hasIcons: Boolean(parsed?.icons && typeof parsed.icons === 'object'),
      homePageId: parsed?.data?.homePageId || '',
      pageRegistryCount: Array.isArray(parsed?.data?.pageRegistry)
        ? parsed.data.pageRegistry.length
        : 0,
      hasPageTemplates: Boolean(
        parsed?.data?.pageTemplates && typeof parsed.data.pageTemplates === 'object'
      ),
      leaksCategories: Object.prototype.hasOwnProperty.call(parsed?.data || {}, 'categories'),
      leaksSites: Object.prototype.hasOwnProperty.call(parsed?.data || {}, 'sites'),
    };
  });

  assert.equal(runtimeConfigState.hasRuntimeConfig, true);
  assert.ok(runtimeConfigState.version);
  assert.equal(runtimeConfigState.hasIcons, true);
  assert.ok(runtimeConfigState.homePageId);
  assert.ok(runtimeConfigState.pageRegistryCount > 0, '运行时配置应包含页面注册表');
  assert.equal(runtimeConfigState.hasPageTemplates, true);
  assert.equal(runtimeConfigState.leaksCategories, false);
  assert.equal(runtimeConfigState.leaksSites, false);
}

async function runDomThemeSearchContract(page, baseUrl) {
  await openPage(page, baseUrl, '/');

  const domState = await page.evaluate(async () => {
    const nav = document.querySelector('.nav-item[data-page]');
    const category = document.querySelector('[data-type="category"]');
    const site = document.querySelector('[data-type="site"]');
    const social = document.querySelector('[data-type="social-link"]');
    const themeButton = document.querySelector('.theme-toggle');
    const search = document.querySelector('#search');

    themeButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const htmlHasLight = document.documentElement.classList.contains('light-theme');
    const surfaceFrosted = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface-frosted')
      .trim();
    const searchBoxBg = document.querySelector('.search-box')
      ? getComputedStyle(document.querySelector('.search-box')).backgroundColor
      : '';

    if (search) {
      search.value = site?.getAttribute('data-name') || 'example';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      navAttrs: {
        type: nav?.getAttribute('data-type') || '',
        id: nav?.getAttribute('data-id') || '',
        page: nav?.getAttribute('data-page') || '',
      },
      categoryAttrs: {
        type: category?.getAttribute('data-type') || '',
        id: category?.getAttribute('data-id') || '',
        name: category?.getAttribute('data-name') || '',
      },
      siteAttrs: {
        type: site?.getAttribute('data-type') || '',
        name: site?.getAttribute('data-name') || '',
        url: site?.getAttribute('data-url') || '',
        icon: site?.getAttribute('data-icon') || '',
      },
      socialAttrs: {
        type: social?.getAttribute('data-type') || '',
        name: social?.getAttribute('data-name') || '',
        url: social?.getAttribute('data-url') || '',
      },
      htmlHasLight,
      surfaceFrosted,
      searchBoxBg,
      storedTheme: localStorage.getItem('theme') || '',
      searchPageActive:
        document.querySelector('#search-results')?.classList.contains('active') || false,
      searchHasState:
        document.querySelector('.search-box')?.classList.contains('has-results') ||
        document.querySelector('.search-box')?.classList.contains('no-results') ||
        false,
      searchSubtitle: document.querySelector('#search-results .subtitle')?.textContent || '',
    };
  });

  assert.equal(domState.navAttrs.type, 'nav-item');
  assert.ok(domState.navAttrs.id);
  assert.ok(domState.navAttrs.page);
  assert.equal(domState.categoryAttrs.type, 'category');
  assert.ok(domState.categoryAttrs.id || domState.categoryAttrs.name);
  assert.equal(domState.siteAttrs.type, 'site');
  assert.ok(domState.siteAttrs.name);
  assert.ok(domState.siteAttrs.url);
  assert.ok(domState.siteAttrs.icon);
  assert.equal(domState.socialAttrs.type, 'social-link');
  assert.ok(domState.socialAttrs.name);
  assert.ok(domState.socialAttrs.url);
  assert.equal(domState.htmlHasLight, true);
  assert.match(domState.surfaceFrosted, /240, 240, 235/);
  const searchBoxBg = parseRgba(domState.searchBoxBg);
  assert.ok(searchBoxBg, '搜索框背景色应为 rgba 格式');
  assert.ok(searchBoxBg.r >= 235 && searchBoxBg.g >= 235 && searchBoxBg.b >= 230);
  assert.ok(searchBoxBg.a >= 0.6 && searchBoxBg.a <= 0.75);
  assert.equal(domState.storedTheme, 'light');
  assert.equal(domState.searchPageActive, true);
  assert.equal(domState.searchHasState, true);
  assert.match(domState.searchSubtitle, /找到|未找到|加载/);

  await page.evaluate(() => {
    const search = document.querySelector('#search');
    if (search) {
      search.value = '';
      search.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    }
  });
  await page.waitForTimeout(100);
  const resetState = await page.evaluate(() => ({
    searchActive: document.querySelector('#search-results')?.classList.contains('active') || false,
    activePageId: document.querySelector('.page.active')?.id || '',
    activeNavId: document.querySelector('.nav-item.active')?.getAttribute('data-page') || '',
  }));
  assert.equal(resetState.searchActive, false);
  assert.equal(resetState.activePageId, resetState.activeNavId);
}

async function runTodoContract(page, baseUrl, messages) {
  await openPage(page, baseUrl, '/');
  await page.evaluate(() => {
    localStorage.removeItem('menav_todos_v2');
    localStorage.setItem(
      'menav_todos_v1',
      JSON.stringify([
        { text: '迁移任务 A', done: false },
        { text: '迁移任务 B', done: true },
      ])
    );
  });

  await openPage(page, baseUrl, '/');
  await page.waitForFunction(() => document.querySelectorAll('.todo-item').length === 2);

  const state = await page.evaluate(() => {
    const panel = document.querySelector('.dashboard-panel');
    const reference = document.querySelector('.global-tools-card');
    const title = document.querySelector('#todo-panel-title');

    function cardStyles(element) {
      const computed = getComputedStyle(element);
      return {
        border: `${computed.borderTopWidth} ${computed.borderTopColor}`,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        backgroundImage: computed.backgroundImage,
      };
    }

    return {
      title: title?.textContent?.trim() || '',
      hasIcon: Boolean(title?.querySelector('i.fa-list-check')),
      panel: cardStyles(panel),
      reference: cardStyles(reference),
      items: Array.from(document.querySelectorAll('.todo-text')).map(
        (node) => node.textContent || ''
      ),
      v1: JSON.parse(localStorage.getItem('menav_todos_v1') || 'null'),
      v2: JSON.parse(localStorage.getItem('menav_todos_v2') || 'null'),
    };
  });

  assert.equal(state.title, '待办事项');
  assert.equal(state.hasIcon, true, 'Todo 标题应显示图标');
  assert.deepEqual(state.panel, state.reference, 'Todo 卡片应与左侧栏位保持相同卡面样式');
  assert.deepEqual(state.items, ['迁移任务 A', '迁移任务 B']);
  assert.equal(state.v1.length, 2, '迁移后应保留 v1 键');
  assert.equal(state.v2.version, 2);
  assert.equal(state.v2.items.length, 2);

  await page.locator('.todo-item').first().locator('.todo-checkbox').click();
  await page.waitForFunction(
    () => document.querySelector('.todo-checkbox')?.getAttribute('aria-checked') === 'true'
  );

  const afterToggle = await page.evaluate(() => {
    const v2 = JSON.parse(localStorage.getItem('menav_todos_v2') || 'null');
    const active = document.activeElement;
    return {
      firstDone: v2?.items?.[0]?.done,
      activeRole: active?.getAttribute('role') || '',
      activeChecked: active?.getAttribute('aria-checked') || '',
    };
  });
  assert.equal(afterToggle.firstDone, true, '勾选后应写入 v2');
  assert.equal(afterToggle.activeRole, 'checkbox', '勾选后键盘焦点应停留在原条目');
  assert.equal(afterToggle.activeChecked, 'true');

  const peer = await page.context().newPage();
  peer.on('console', (message) => {
    messages.push({
      type: message.type(),
      text: message.text(),
      url: message.location()?.url || '',
    });
  });
  peer.on('pageerror', (error) => {
    messages.push({ type: 'error', text: error.message });
  });
  await openPage(peer, baseUrl, '/');
  await peer.waitForFunction(() => document.querySelectorAll('.todo-item').length === 2);

  await page.evaluate(() => {
    document.querySelector('[data-todo-toggle-input]')?.click();
    const input = document.querySelector('#todo-input-field');
    input.value = '跨标签新增';
    document.querySelector('.todo-add-btn-small')?.click();
  });
  await peer.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.todo-text')).some(
        (node) => node.textContent === '跨标签新增'
      ),
    null,
    { timeout: 5000 }
  );

  await peer.locator('.todo-item', { hasText: '迁移任务 B' }).locator('.todo-checkbox').click();
  await page.waitForFunction(
    () => {
      const item = Array.from(document.querySelectorAll('.todo-item')).find(
        (node) => node.querySelector('.todo-text')?.textContent === '迁移任务 B'
      );
      return item?.querySelector('.todo-checkbox')?.getAttribute('aria-checked') === 'false';
    },
    null,
    { timeout: 5000 }
  );

  const merged = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('menav_todos_v2') || 'null')
  );
  assert.equal(merged.items.length, 3, '跨标签新增和勾选后应保留全部变更');
  await peer.close();

  const failurePage = await page.context().newPage();
  failurePage.on('console', (message) => {
    messages.push({
      type: message.type(),
      text: message.text(),
      url: message.location()?.url || '',
    });
  });
  failurePage.on('pageerror', (error) => {
    messages.push({ type: 'error', text: error.message });
  });
  await failurePage.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    let blocked = true;
    Storage.prototype.setItem = function (key, value) {
      if (blocked && key === 'menav_todos_v2') {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
    window.__allowTodoWrites = () => {
      blocked = false;
    };
  });
  await openPage(failurePage, baseUrl, '/');
  await failurePage.waitForFunction(() => document.querySelectorAll('.todo-item').length === 3);

  await failurePage
    .locator('.todo-item', { hasText: '迁移任务 B' })
    .locator('.todo-checkbox')
    .click();
  await failurePage
    .locator('.todo-item', { hasText: '跨标签新增' })
    .locator('.todo-checkbox')
    .click();

  const degraded = await failurePage.evaluate(() => {
    const checked = (text) =>
      Array.from(document.querySelectorAll('.todo-item'))
        .find((node) => node.querySelector('.todo-text')?.textContent === text)
        ?.querySelector('.todo-checkbox')
        ?.getAttribute('aria-checked');
    return {
      b: checked('迁移任务 B'),
      added: checked('跨标签新增'),
      stored: JSON.parse(localStorage.getItem('menav_todos_v2') || 'null'),
    };
  });
  assert.equal(degraded.b, 'true', '写失败后应保留第一次会话内变更');
  assert.equal(degraded.added, 'true', '写失败后应保留第二次会话内变更');
  assert.equal(
    degraded.stored.items.find((item) => item.text === '迁移任务 B').done,
    false,
    '写失败期间存储不应被更新'
  );

  await failurePage.evaluate(() => {
    window.__allowTodoWrites();
    document.querySelector('[data-todo-toggle-input]')?.click();
    const input = document.querySelector('#todo-input-field');
    input.value = '恢复写入';
    document.querySelector('.todo-add-btn-small')?.click();
  });

  const recovered = await failurePage.evaluate(() =>
    JSON.parse(localStorage.getItem('menav_todos_v2') || 'null')
  );
  assert.equal(recovered.items.length, 4, '写入恢复后应一次落盘全部会话内变更');
  assert.equal(recovered.items.find((item) => item.text === '迁移任务 B').done, true);
  assert.equal(recovered.items.find((item) => item.text === '跨标签新增').done, true);
  await failurePage.close();

  await page.setViewportSize({ width: 375, height: 812 });
  const mobile = await page.evaluate(() => {
    const header = document.querySelector('.panel-header h2');
    const item = document.querySelector('.todo-item');
    const panel = document.querySelector('.dashboard-panel');
    return {
      headerLeft: header?.getBoundingClientRect().left || 0,
      itemLeft: item?.getBoundingClientRect().left || 0,
      overflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
    };
  });
  assert.ok(Math.abs(mobile.headerLeft - mobile.itemLeft) <= 1, '移动端标题与条目应左对齐');
  assert.ok(mobile.overflow <= 1, `移动端 Todo 面板不应横向溢出：${mobile.overflow}`);
}

async function main() {
  const elapsedMs = startTimer();
  const repoRoot = path.resolve(__dirname, '..', '..');
  const messages = [];
  const { server, port } = await startServer({
    rootDir: path.join(repoRoot, 'dist'),
    host: '127.0.0.1',
    port: 0,
    strictPort: true,
  });
  const baseUrl = `http://127.0.0.1:${port}${BASE_PATH}`;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (message) => {
      messages.push({
        type: message.type(),
        text: message.text(),
        url: message.location()?.url || '',
      });
    });
    page.on('pageerror', (error) => {
      messages.push({ type: 'error', text: error.message });
    });
    await runRouteContract(page, baseUrl);
    await runRuntimeConfigContract(page, baseUrl);
    await runDomThemeSearchContract(page, baseUrl);
    await runTodoContract(page, baseUrl, messages);
    await assertNoConsoleErrors(messages);

    log.ok('完成', { ms: elapsedMs(), url: baseUrl });
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (require.main === module) {
  main().catch((error) => {
    log.error('失败', { message: error && error.message ? error.message : String(error) });
    if (error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  });
}
