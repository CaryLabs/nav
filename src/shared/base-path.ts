/**
 * 站点部署基路径的纯函数工具（浏览器与构建期共用）。
 *
 * 约定：
 * - 归一化结果不含尾部斜杠；根路径部署返回空串 ''。
 * - 拼接函数在 base 为空时退化为根相对路径，保持上游默认行为不变。
 */

function normalizeBasePath(value: unknown): string {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw || raw === '/') return '';

  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withLeading.replace(/\/{2,}/g, '/').replace(/\/+$/, '');

  return collapsed === '/' ? '' : collapsed;
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

/**
 * 把站内路径挂到基路径下。已是绝对 URL（http:、mailto: 等）时原样返回。
 */
function withBasePath(basePath: unknown, target: unknown): string {
  const base = normalizeBasePath(basePath);
  const path = String(target === null || target === undefined ? '' : target);

  if (!path) return base ? `${base}/` : '/';
  if (isAbsoluteUrl(path)) return path;

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

/**
 * 页面路径：`<base>/page/<id>/`，可选 hash（分类 slug）。
 */
function buildPagePath(options: {
  basePath?: unknown;
  pageId: unknown;
  hash?: unknown;
}): string {
  const base = normalizeBasePath(options.basePath);
  const pageId = String(options.pageId === null || options.pageId === undefined ? '' : options.pageId).trim();
  const hash = String(options.hash === null || options.hash === undefined ? '' : options.hash)
    .trim()
    .replace(/^#/, '');

  if (!pageId) return base ? `${base}/` : '/';

  const path = `${base}/page/${encodeURIComponent(pageId)}/`;
  return hash ? `${path}#${encodeURIComponent(hash)}` : path;
}

export { buildPagePath, isAbsoluteUrl, normalizeBasePath, withBasePath };
