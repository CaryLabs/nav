import type { MenavConfig } from './types';

import { SELECTORS, byId } from './dom/selectors.ts';
import { normalizeBasePath } from '../shared/base-path.ts';

const BASE_PATH_ATTRIBUTE = 'data-base-path';

let runtimeConfigCacheReady = false;
let runtimeConfigCacheRaw: string | null = null;
let runtimeConfigCacheValue: MenavConfig | null = null;

function cloneConfig(config: MenavConfig | null): MenavConfig | null {
  if (config === null) return null;

  if (typeof structuredClone === 'function') {
    return structuredClone(config);
  }

  return JSON.parse(JSON.stringify(config)) as MenavConfig;
}

function getRuntimeConfig(options?: { clone?: boolean }): MenavConfig | null {
  const configData = byId(SELECTORS.runtimeConfigData);
  if (!configData) return null;

  const raw = configData.textContent || '';
  if (!runtimeConfigCacheReady || runtimeConfigCacheRaw !== raw) {
    runtimeConfigCacheValue = JSON.parse(raw) as MenavConfig;
    runtimeConfigCacheRaw = raw;
    runtimeConfigCacheReady = true;
  }

  if (options && options.clone) {
    return cloneConfig(runtimeConfigCacheValue);
  }

  return runtimeConfigCacheValue;
}

export { getRuntimeConfig };

/**
 * 站点部署基路径（不含尾斜杠；根路径部署返回空串）。
 *
 * 唯一真源为 <html data-base-path>（构建期由布局无条件写入，空串也视为有效值）；
 * 读取失败时回退根路径，保证任何异常都不会拼错 URL。
 */
function getBasePath(): string {
  try {
    const docEl = typeof document === 'undefined' ? null : document.documentElement;
    if (docEl && docEl.hasAttribute(BASE_PATH_ATTRIBUTE)) {
      return normalizeBasePath(docEl.getAttribute(BASE_PATH_ATTRIBUTE));
    }
  } catch {
    // 忽略 DOM 读取异常，回退根路径
  }

  return '';
}

export { getBasePath };
