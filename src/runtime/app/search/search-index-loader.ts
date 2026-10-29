import type { RuntimeSearchIndexItem, RuntimeState } from '../../types';
import type { SearchIndexPayload } from '../../../types/search';

const { normalizeIndexItem } = require('./index-item.ts') as {
  normalizeIndexItem: (raw: unknown) => RuntimeSearchIndexItem | null;
};

const { withBasePath } = require('../../../shared/base-path.ts') as typeof import('../../../shared/base-path');
const { getBasePath } = require('../../runtime-config.ts') as typeof import('../../runtime-config');

const SEARCH_INDEX_SCHEMA_VERSION = 1;
const SEARCH_INDEX_FILE = 'search-index.json';

/**
 * 索引地址必须跟随部署基路径：路径式路由下页面位于 /page/<id>/，
 * 相对路径 './search-index.json' 会指向 /page/<id>/search-index.json 而 404。
 */
function getSearchIndexUrl(): string {
  return withBasePath(getBasePath(), SEARCH_INDEX_FILE);
}

async function loadBuildSearchIndex(state: RuntimeState): Promise<void> {
  if (state.searchIndex.initialized || state.searchIndex.loading) return;

  state.searchIndex.loading = true;

  try {
    const response = await fetch(getSearchIndexUrl(), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = (await response.json()) as SearchIndexPayload;
    if (payload.schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION || !Array.isArray(payload.items)) {
      throw new Error('search index schema mismatch');
    }

    const items = payload.items
      .map((item) => normalizeIndexItem(item))
      .filter((item: RuntimeSearchIndexItem | null): item is RuntimeSearchIndexItem =>
        Boolean(item)
      );

    state.searchIndex.items = items;
    state.searchIndex.error = undefined;
    state.searchIndex.initialized = true;
    state.searchIndex.loading = false;
    state.searchIndex.source = 'build';
  } catch (error) {
    console.error('Error loading search index:', error);
    state.searchIndex.items = [];
    state.searchIndex.initialized = true;
    state.searchIndex.loading = false;
    state.searchIndex.source = 'build';
    state.searchIndex.error = error instanceof Error ? error.message : String(error);
  }
}

module.exports = {
  SEARCH_INDEX_SCHEMA_VERSION,
  getSearchIndexUrl,
  loadBuildSearchIndex,
};
