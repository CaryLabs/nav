import { buildPagePath, normalizeBasePath, withBasePath } from '../shared/base-path.ts';

/**
 * 构建期站点基路径来源：环境变量 MENAV_BASE_PATH。
 *
 * - 未设置：根路径部署（本地 dev、根域/自定义域），行为与历史版本一致。
 * - 设置（如 /menav）：GitHub Pages 项目站点子路径部署。
 */
function getBasePath(): string {
  return normalizeBasePath(process.env.MENAV_BASE_PATH);
}

/** 站内资源地址（style.css、script.js、favicon、search-index.json 等）。 */
function assetUrl(target: unknown): string {
  return withBasePath(getBasePath(), target);
}

/** 页面地址：/page/<id>/，用于 SSR 生成的导航与子菜单链接。 */
function pageUrl(pageId: unknown, hash?: unknown): string {
  return buildPagePath({ basePath: getBasePath(), pageId, hash });
}

/** 站点入口地址（含基路径，带尾斜杠）。 */
function siteRootUrl(): string {
  const base = getBasePath();
  return base ? `${base}/` : '/';
}

export { assetUrl, getBasePath, normalizeBasePath, pageUrl, siteRootUrl };
