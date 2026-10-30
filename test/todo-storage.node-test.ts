const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTodoStore,
  readTodoItems,
  loadTodoItems,
  writeTodoItems,
  TODO_STORAGE_KEY,
  LEGACY_TODO_STORAGE_KEY,
} = require('../src/runtime/app/todo.ts');

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));

  return {
    failOnGet: false,
    failOnSet: false,
    stats: { gets: 0, sets: 0 },
    getItem(key) {
      this.stats.gets += 1;
      if (this.failOnGet) throw new Error('getItem failed');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      this.stats.sets += 1;
      if (this.failOnSet) throw new Error('setItem failed');
      values.set(key, String(value));
    },
  };
}

test('v1 数组应迁移为带稳定 ID 的 Todo 列表', () => {
  const items = parseTodoStore(
    JSON.stringify([
      { text: 'Drink Water', done: false },
      { text: 'Explore MeNav', done: true },
      { text: '   ', done: false },
    ])
  );

  assert.ok(items);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Drink Water');
  assert.equal(items[0].done, false);
  assert.equal(items[1].done, true);
  assert.match(items[0].id, /\S+/);
  assert.notEqual(items[0].id, items[1].id);
});

test('v2 空数组合法，不能回退默认示例或旧 v1 数据', () => {
  const storage = createStorage({
    [TODO_STORAGE_KEY]: JSON.stringify({ version: 2, items: [] }),
    [LEGACY_TODO_STORAGE_KEY]: JSON.stringify([{ text: 'legacy', done: false }]),
  });

  const result = readTodoItems(storage);
  assert.deepEqual(result.items, []);
  assert.equal(result.source, 'v2');
  assert.equal(result.shouldPersist, false);
  assert.equal(storage.stats.sets, 0);
});

test('v2 损坏时应回退 v1，并在 load 时写入可读的 v2', () => {
  const storage = createStorage({
    [TODO_STORAGE_KEY]: '{broken',
    [LEGACY_TODO_STORAGE_KEY]: JSON.stringify([{ text: 'Recovered', done: true }]),
  });

  const result = loadTodoItems(storage);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].text, 'Recovered');
  assert.equal(result.items[0].done, true);
  assert.equal(result.source, 'v1');
  assert.equal(result.shouldPersist, true);

  const migrated = JSON.parse(storage.getItem(TODO_STORAGE_KEY));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.items[0].text, 'Recovered');
  assert.deepEqual(JSON.parse(storage.getItem(LEGACY_TODO_STORAGE_KEY)), [
    { text: 'Recovered', done: true },
  ]);
});

test('v2 与 v1 均损坏时 load 返回空数组且不覆盖原始数据', () => {
  const storage = createStorage({
    [TODO_STORAGE_KEY]: '{broken',
    [LEGACY_TODO_STORAGE_KEY]: 'not-json',
  });

  const result = loadTodoItems(storage);
  assert.deepEqual(result.items, []);
  assert.equal(result.source, 'invalid');
  assert.equal(result.shouldPersist, false);
  assert.equal(storage.stats.sets, 0);
  assert.equal(storage.getItem(TODO_STORAGE_KEY), '{broken');
  assert.equal(storage.getItem(LEGACY_TODO_STORAGE_KEY), 'not-json');
});

test('首次访问应写入默认示例，保留原有完成态', () => {
  const storage = createStorage();
  const result = loadTodoItems(storage);

  assert.equal(result.source, 'seed');
  assert.equal(result.shouldPersist, true);
  assert.equal(result.writeFailed, false);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].text, 'Drink Water');
  assert.equal(result.items[0].done, false);
  assert.equal(result.items[1].text, 'Explore MeNav');
  assert.equal(result.items[1].done, true);

  const stored = JSON.parse(storage.getItem(TODO_STORAGE_KEY));
  assert.equal(stored.version, 2);
  assert.equal(stored.items.length, 2);
});

test('重复 ID 应被修正，写入后仍保留合法条目', () => {
  const items = parseTodoStore(
    JSON.stringify({
      version: 2,
      items: [
        { id: 'same', text: 'A', done: false },
        { id: 'same', text: 'B', done: true },
      ],
    })
  );

  assert.ok(items);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);

  const storage = createStorage();
  assert.equal(writeTodoItems(storage, items), true);
  assert.deepEqual(readTodoItems(storage).items, items);
});

test('v2 中非法条目应被过滤，合法条目保留', () => {
  const storage = createStorage({
    [TODO_STORAGE_KEY]: JSON.stringify({
      version: 2,
      items: [
        null,
        { text: '', done: false },
        { id: 7, text: 'valid', done: 1 },
        { text: 'string-true', done: 'true' },
      ],
    }),
  });

  const result = readTodoItems(storage);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].text, 'valid');
  assert.equal(result.items[0].done, true);
  assert.equal(result.items[1].text, 'string-true');
  assert.equal(result.items[1].done, true);
});

test('存储不可用时应回退默认示例，写入返回 false 且不抛错', () => {
  const items = readTodoItems(null);
  assert.equal(items.items.length, 2);
  assert.equal(items.source, 'unavailable');
  assert.equal(writeTodoItems(null, items.items), false);
});

test('getItem 抛错时应标记 unavailable，不回写也不覆盖', () => {
  const storage = createStorage();
  storage.failOnGet = true;

  const result = loadTodoItems(storage);
  assert.equal(result.source, 'unavailable');
  assert.equal(result.items.length, 2);
  assert.equal(storage.stats.sets, 0);
});

test('setItem 抛错时应保持可渲染数据，write 返回 false', () => {
  const storage = createStorage();
  storage.failOnSet = true;

  const result = loadTodoItems(storage);
  assert.equal(result.items.length, 2);
  assert.equal(result.writeFailed, true);
  assert.equal(writeTodoItems(storage, result.items), false);
  assert.equal(storage.getItem(TODO_STORAGE_KEY), null);
});

test('相同内容写入应跳过 setItem，避免无意义的跨标签事件', () => {
  const storage = createStorage();
  const items = parseTodoStore(JSON.stringify([{ text: 'A', done: false }]));
  assert.ok(items);
  assert.equal(writeTodoItems(storage, items), true);
  const setsAfterFirstWrite = storage.stats.sets;

  assert.equal(writeTodoItems(storage, items), true);
  assert.equal(storage.stats.sets, setsAfterFirstWrite);
});
