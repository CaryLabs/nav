type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

type TodoStore = {
  version: 2;
  items: TodoItem[];
};

type TodoStorage = Pick<Storage, 'getItem' | 'setItem'>;

type TodoReadSource = 'v2' | 'v1' | 'seed' | 'invalid' | 'unavailable';

type TodoReadResult = {
  items: TodoItem[];
  source: TodoReadSource;
  shouldPersist: boolean;
};

type TodoLoadResult = TodoReadResult & {
  writeFailed: boolean;
};

const { SELECTORS, byId, qs, qsa } =
  require('../dom/selectors.ts') as typeof import('../dom/selectors');

const TODO_STORAGE_KEY = 'menav_todos_v2';
const LEGACY_TODO_STORAGE_KEY = 'menav_todos_v1';
const DEFAULT_TODOS: Array<Pick<TodoItem, 'text' | 'done'>> = [
  { text: 'Drink Water', done: false },
  { text: 'Explore MeNav', done: true },
];

function createTodoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultTodos(): TodoItem[] {
  return DEFAULT_TODOS.map(({ text, done }) => ({ id: createTodoId(), text, done }));
}

function normalizeTodo(value: unknown): TodoItem | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!text) return null;

  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : createTodoId();
  const done = record.done === true || record.done === 1 || record.done === 'true';

  return { id, text, done };
}

function normalizeTodoList(values: unknown[]): TodoItem[] {
  const ids = new Set<string>();
  const items: TodoItem[] = [];

  values.forEach((value) => {
    const todo = normalizeTodo(value);
    if (!todo) return;

    if (ids.has(todo.id)) todo.id = createTodoId();
    ids.add(todo.id);
    items.push(todo);
  });

  return items;
}

function parseTodoStore(raw: string | null): TodoItem[] | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    // v1: [{ text, done }]
    if (Array.isArray(parsed)) {
      return normalizeTodoList(parsed);
    }

    // v2: { version: 2, items: [{ id, text, done }] }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as Record<string, unknown>).version === 2 &&
      Array.isArray((parsed as Record<string, unknown>).items)
    ) {
      return normalizeTodoList((parsed as TodoStore).items);
    }
  } catch {
    return null;
  }

  return null;
}

function readTodoItems(storage: TodoStorage | null): TodoReadResult {
  if (!storage) {
    return { items: createDefaultTodos(), source: 'unavailable', shouldPersist: false };
  }

  let v2Raw: string | null = null;
  let v1Raw: string | null = null;

  try {
    v2Raw = storage.getItem(TODO_STORAGE_KEY);
    v1Raw = storage.getItem(LEGACY_TODO_STORAGE_KEY);
  } catch {
    return { items: createDefaultTodos(), source: 'unavailable', shouldPersist: false };
  }

  const current = parseTodoStore(v2Raw);
  if (current) {
    return { items: current, source: 'v2', shouldPersist: false };
  }

  const legacy = parseTodoStore(v1Raw);
  if (legacy) {
    return { items: legacy, source: 'v1', shouldPersist: true };
  }

  if (v2Raw === null && v1Raw === null) {
    return { items: createDefaultTodos(), source: 'seed', shouldPersist: true };
  }

  return { items: [], source: 'invalid', shouldPersist: false };
}

function loadTodoItems(storage: TodoStorage | null): TodoLoadResult {
  const result = readTodoItems(storage);
  let writeFailed = false;

  if (result.shouldPersist) {
    writeFailed = !writeTodoItems(storage, result.items);
  }

  return { ...result, writeFailed };
}

function writeTodoItems(storage: TodoStorage | null, items: TodoItem[]): boolean {
  if (!storage) return false;

  const store: TodoStore = { version: 2, items };
  const serialized = JSON.stringify(store);

  try {
    if (storage.getItem(TODO_STORAGE_KEY) === serialized) return true;
    storage.setItem(TODO_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

function initTodo(): void {
  const list = byId(SELECTORS.todoList);
  if (!list || list.dataset.todoInitialized === 'true') return;

  const container = list;
  container.dataset.todoInitialized = 'true';
  let storage: TodoStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }

  const initial = loadTodoItems(storage);
  let todos = initial.items;
  let pendingWrite = initial.writeFailed || initial.source === 'unavailable';
  let isIgnoreBlur = false;

  const inputContainer = byId(SELECTORS.todoInputContainer);
  const input = byId<HTMLInputElement>(SELECTORS.todoInputField);
  const addButton = qs<HTMLButtonElement>(SELECTORS.todoAddButton);
  const toggleInputButton = qs<HTMLButtonElement>(SELECTORS.todoToggleInputButton);

  function render(): void {
    if (todos.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-todo-hint';
      hint.textContent = 'No tasks.';
      container.replaceChildren(hint);
      return;
    }

    const fragment = document.createDocumentFragment();

    todos.forEach((todo) => {
      const item = document.createElement('div');
      item.className = `todo-item${todo.done ? ' done' : ''}`;
      item.dataset.todoId = todo.id;

      const checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.className = `todo-checkbox${todo.done ? ' checked' : ''}`;
      checkbox.setAttribute('role', 'checkbox');
      checkbox.setAttribute('aria-checked', String(todo.done));
      checkbox.setAttribute('aria-label', todo.text);

      if (todo.done) {
        const check = document.createElement('span');
        check.className = 'fas fa-check';
        check.setAttribute('aria-hidden', 'true');
        checkbox.appendChild(check);
      }

      const text = document.createElement('div');
      text.className = 'todo-text';
      text.title = todo.text;
      text.textContent = todo.text;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'todo-delete-btn';
      removeButton.dataset.action = 'delete';
      removeButton.setAttribute('aria-label', `删除待办：${todo.text}`);
      removeButton.setAttribute('title', 'Delete');

      const trash = document.createElement('span');
      trash.className = 'fas fa-trash-alt';
      trash.setAttribute('aria-hidden', 'true');
      removeButton.appendChild(trash);

      item.append(checkbox, text, removeButton);
      fragment.appendChild(item);
    });

    container.replaceChildren(fragment);
  }

  function focusTodoItem(id: string, target: 'checkbox' | 'delete'): void {
    const item = qsa<HTMLElement>(SELECTORS.todoItem, container).find(
      (node) => node.dataset.todoId === id
    );
    if (!item) return;

    const selector = target === 'delete' ? SELECTORS.todoDeleteButton : SELECTORS.todoCheckbox;
    qs<HTMLElement>(selector, item)?.focus();
  }

  function applyMutation(
    mutate: (items: TodoItem[]) => TodoItem[] | void,
    focus?: { id: string; target: 'checkbox' | 'delete' }
  ): void {
    // 写入前重读，避免用本标签页的旧数组覆盖其他标签页的最新变更。
    // 写入失败后以当前会话内存为准，直到再次成功落盘。
    let latest = todos;
    if (storage && !pendingWrite) {
      const result = readTodoItems(storage);
      if (result.source !== 'unavailable') latest = result.items;
    }

    const next = mutate(latest) || latest;

    if (storage) {
      pendingWrite = !writeTodoItems(storage, next);
    } else {
      pendingWrite = true;
    }

    todos = next;
    render();

    if (focus) focusTodoItem(focus.id, focus.target);
  }

  function toggleTodo(id: string): void {
    applyMutation(
      (items) => {
        const target = items.find((todo) => todo.id === id);
        if (target) target.done = !target.done;
      },
      { id, target: 'checkbox' }
    );
  }

  function removeTodo(id: string): void {
    const index = todos.findIndex((todo) => todo.id === id);
    const nextFocusId = index >= 0 ? (todos[index + 1]?.id ?? todos[index - 1]?.id) : undefined;

    applyMutation(
      (items) => items.filter((todo) => todo.id !== id),
      nextFocusId ? { id: nextFocusId, target: 'checkbox' } : undefined
    );

    if (!nextFocusId) toggleInputButton?.focus();
  }

  function addFromInput(): void {
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    applyMutation((items) => {
      items.push({ id: createTodoId(), text, done: false });
    });

    input.value = '';
    container.scrollTop = container.scrollHeight;
    input.focus();
  }

  function setInputVisible(visible: boolean): void {
    if (!inputContainer) return;

    inputContainer.style.display = visible ? 'flex' : 'none';
    toggleInputButton?.setAttribute('aria-expanded', String(visible));

    if (visible) input?.focus();
  }

  function toggleInput(): void {
    if (!inputContainer || !input) return;
    setInputVisible(inputContainer.style.display === 'none');
  }

  container.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const item = target.closest<HTMLElement>(SELECTORS.todoItem);
    if (!item) return;

    const id = item.dataset.todoId;
    if (!id) return;

    if (target.closest(SELECTORS.todoDeleteButton)) {
      removeTodo(id);
      return;
    }

    toggleTodo(id);
  });

  toggleInputButton?.addEventListener('click', toggleInput);

  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addFromInput();
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (isIgnoreBlur) {
          isIgnoreBlur = false;
          return;
        }
        setInputVisible(false);
      }, 200);
    });
  }

  if (addButton) {
    addButton.addEventListener('mousedown', () => {
      isIgnoreBlur = true;
    });
    addButton.addEventListener('click', addFromInput);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== TODO_STORAGE_KEY || pendingWrite) return;

    const result = readTodoItems(storage);
    if (result.source === 'unavailable') return;

    todos = result.items;
    render();
  });

  render();
}

module.exports = {
  initTodo,
  parseTodoStore,
  readTodoItems,
  loadTodoItems,
  writeTodoItems,
  TODO_STORAGE_KEY,
  LEGACY_TODO_STORAGE_KEY,
};
