import type { NavigationItem } from '../../types/config';
import type { PageEntry } from '../../types/page';
import type { SiteModel } from '../../types/model';
import { loadConfig } from '../config/index.ts';
import { generateFontCss, generateFontLinks } from '../html/fonts.ts';
import { buildSiteModel } from '../site-model/index.ts';
import { collectSiteExternalData } from '../site-model/external-data.ts';
import { pageUrl, siteRootUrl } from '../urls.ts';

export type RenderData = {
  config: SiteModel['config'];
  pages: PageEntry[];
  navigationData: NavigationItem[];
  renderContext: SiteModel['renderContext'];
  fontLinks: string;
  fontCss: string;
  currentYear: number;
  runtimeConfigJson: string;
  version: string;
  canonicalUrl: string;
};

let cachedModel: SiteModel | null = null;

/**
 * 站点模型只构建一次：每个页面路由都要复用同一份渲染数据，
 * 重复构建会成倍放大外部数据采集与渲染成本。
 */
function getSiteModel(): SiteModel {
  if (!cachedModel) {
    const config = loadConfig();
    cachedModel = buildSiteModel({ config, externalData: collectSiteExternalData(config) });
  }

  return cachedModel;
}

/**
 * 生成 DefaultLayout 所需数据。
 *
 * @param activePageId 当前路由对应的页面 id；省略时沿用模型默认的 active 页（导航第一项）。
 *   指定后同时改写 pages[].isActive 与 navigationData，使 SSR 首屏即为正确的高亮/可见状态。
 */
function buildRenderData(activePageId?: string): RenderData {
  const model = getSiteModel();
  const targetPageId = activePageId ? String(activePageId).trim() : '';
  const targetPage = targetPageId
    ? model.pages.find((entry) => entry.id === targetPageId) || null
    : null;

  const pages: PageEntry[] = targetPageId
    ? model.pages.map((entry) => ({ ...entry, isActive: entry.id === targetPageId }))
    : model.pages;

  const targetNavigation = targetPage?.data?.navigation;
  const navigationData: NavigationItem[] = Array.isArray(targetNavigation)
    ? (targetNavigation as NavigationItem[])
    : model.navigationData;

  // 规范 URL：首页（含根路径与 /page/<homePageId>/）统一收敛到站点根路径，
  // 其余页面收敛到自身路径式 URL，避免重复内容
  const homePageId = model.config.homePageId || '';
  const canonicalPageId = targetPageId || homePageId;
  const canonicalUrl =
    canonicalPageId === homePageId ? siteRootUrl() : pageUrl(canonicalPageId);

  return {
    config: model.config,
    pages,
    navigationData,
    renderContext: model.renderContext,
    fontLinks: generateFontLinks(model.config),
    fontCss: generateFontCss(model.config),
    currentYear: model.meta.generatedAt.getFullYear(),
    runtimeConfigJson: model.runtimeConfigJson,
    version: model.meta.version,
    canonicalUrl,
  };
}

export { buildRenderData };
