import type { PageRegistryItem } from '../../types/page';

const { buildPagePath, normalizeBasePath } =
  require('../../shared/base-path.ts') as typeof import('../../shared/base-path');

type PageRegistryEntry = Pick<PageRegistryItem, 'id'>;

type RouteParseOptions = {
  pageRegistry?: PageRegistryEntry[] | null;
  homePageId?: unknown;
  fallbackPageId?: unknown;
  basePath?: unknown;
};

type RouteBuildOptions = {
  basePath?: unknown;
};

type RouteState = {
  pageId: string;
  rawPageId: string;
  hash: string;
  shouldReplaceUrl: boolean;
};

type RoutePatch = {
  pageId?: string;
  hash?: string | null;
};

// 路径式路由：/<base>/page/<pageId>/（尾斜杠为静态托管的目录索引形式）
const PAGE_PATH_PATTERN = /^\/page\/([^/]+)\/?$/;

function normalizeText(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).trim();
}

function decodeHash(value: unknown): string {
  const raw = normalizeText(value).replace(/^#/, '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function getRegisteredPageIds(pageRegistry: PageRegistryEntry[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(pageRegistry)) return ids;

  pageRegistry.forEach((entry) => {
    const id = normalizeText(entry && typeof entry === 'object' ? entry.id : '');
    if (id) ids.add(id);
  });

  return ids;
}

function resolveFallbackPageId(ids: Set<string>, options: RouteParseOptions): string {
  const homePageId = normalizeText(options.homePageId);
  if (homePageId && ids.has(homePageId)) return homePageId;

  const fallbackPageId = normalizeText(options.fallbackPageId);
  if (fallbackPageId && (ids.size === 0 || ids.has(fallbackPageId))) return fallbackPageId;

  const first = ids.values().next();
  return first.done ? fallbackPageId || homePageId || 'home' : first.value;
}

/** 去掉部署基路径，得到站点内部路径（始终以 / 开头）。 */
function stripBasePath(pathname: string, basePath: unknown): string {
  const base = normalizeBasePath(basePath);
  const path = normalizeText(pathname) || '/';
  if (!base) return path;
  if (path === base) return '/';
  if (path.startsWith(`${base}/`)) return path.slice(base.length) || '/';
  return path;
}

/** 从 /page/<id>/ 中取出 page id；非该形式返回空串。 */
function parsePageIdFromPath(pathname: string): string {
  const match = PAGE_PATH_PATTERN.exec(normalizeText(pathname) || '/');
  if (!match) return '';

  const rawSegment = match[1];
  try {
    return decodeURIComponent(rawSegment).trim();
  } catch {
    return rawSegment.trim();
  }
}

function parseRouteFromHref(href: string, options: RouteParseOptions = {}): RouteState {
  const ids = getRegisteredPageIds(options.pageRegistry);
  const basePath = normalizeBasePath(options.basePath);

  try {
    const url = new URL(href, 'https://menav.local/');
    const innerPath = stripBasePath(url.pathname, basePath);
    const pathPageId = parsePageIdFromPath(innerPath);
    // 兼容旧式 ?page=<id> 链接：解析出 id 后由 shouldReplaceUrl 触发迁移
    const legacyPageId = normalizeText(url.searchParams.get('page'));
    const rawPageId = pathPageId || legacyPageId;
    const hasRegistry = ids.size > 0;
    const isKnownPage = Boolean(rawPageId && (!hasRegistry || ids.has(rawPageId)));
    const fallbackPageId = resolveFallbackPageId(ids, options);
    const isRootPath = innerPath === '/';
    const isCanonicalPath = Boolean(pathPageId) || isRootPath;

    return {
      pageId: isKnownPage ? rawPageId : fallbackPageId,
      rawPageId,
      hash: decodeHash(url.hash),
      // 需要 replaceState 规范化的三种情况：
      // 1) 旧式 ?page= 链接 → 迁移为路径式；
      // 2) pathname 既不是根路径也不是 /page/<id>/；
      // 3) 路径中的 page id 未注册。
      shouldReplaceUrl: Boolean(legacyPageId || !isCanonicalPath || (rawPageId && !isKnownPage)),
    };
  } catch {
    const fallbackPageId = resolveFallbackPageId(ids, options);
    return {
      pageId: fallbackPageId,
      rawPageId: '',
      hash: '',
      shouldReplaceUrl: false,
    };
  }
}

function buildRoutePath(
  currentHref: string,
  patch: RoutePatch,
  options: RouteBuildOptions = {}
): string {
  const basePath = normalizeBasePath(options.basePath);

  try {
    const url = new URL(currentHref, 'https://menav.local/');

    if (typeof patch.pageId === 'string') {
      const pageId = normalizeText(patch.pageId);
      url.pathname = pageId ? `${basePath}/page/${encodeURIComponent(pageId)}/` : `${basePath}/`;
    }

    // 路径式 URL 不再携带 ?page=，同时保留其它查询参数（如 utm）
    url.searchParams.delete('page');

    if (Object.prototype.hasOwnProperty.call(patch, 'hash')) {
      const hash = normalizeText(patch.hash);
      url.hash = hash ? `#${encodeURIComponent(hash)}` : '';
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const pageId = normalizeText(patch.pageId);
    const hash = normalizeText(patch.hash);
    const path = pageId ? buildPagePath({ basePath, pageId }) : `${basePath}/`;
    return `${path}${hash ? `#${encodeURIComponent(hash)}` : ''}`;
  }
}

export {
  buildRoutePath,
  decodeHash,
  getRegisteredPageIds,
  normalizeText,
  parsePageIdFromPath,
  parseRouteFromHref,
  stripBasePath,
};
export type { PageRegistryEntry, RouteBuildOptions, RouteParseOptions, RoutePatch, RouteState };
