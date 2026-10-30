# MeNav 栏位维护开发手册

面向维护者：本文按「页面上看到的一个栏位」组织，说明它由哪个文件控制、怎么增减条目、改完怎么验证。

配套文档：`README.md`（部署与功能）、`USERGUIDE.md`（使用者视角）、`config/README.md`（配置字段全集）、`bookmarks/README.md`（书签导入细节）。

---

## 0. 一分钟定位

| 页面 / 栏位                                                | 文件                                 | 维护方式                  |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------- |
| 首页「出海工具」快捷卡片                                   | `src/components/HomeDashboard.astro` | 手工维护数组              |
| 首页右上「待办」面板                                       | 浏览器 `localStorage`                | 页面内操作，无需改文件    |
| 常用页：置顶 / 学习资源 / 设计资源 / 在线工具 / 云服务平台 | `config/user/pages/common.yml`       | 手改 YAML                 |
| 书签页各目录                                               | `config/user/pages/bookmarks.yml`    | **自动生成**，一般不改    |
| 项目页各分类                                               | `config/user/pages/projects.yml`     | 手改 YAML                 |
| 文章页各分类                                               | `config/user/pages/articles.yml`     | 手改 YAML（只填站点首页） |
| 关于页正文                                                 | `content/about.md`                   | 手改 Markdown             |
| 侧边栏导航 / 社交链接 / 站点信息                           | `config/user/site.yml`               | 手改 YAML                 |
| 全站图标、主题、字体、安全策略                             | `config/user/site.yml`               | 手改 YAML                 |

页面与文件的对应关系由 `site.yml` 的 `navigation[].id` 决定：`id: common` 对应 `pages/common.yml`。

---

## 1. 三条铁律

1. **只改 `config/user/`，永远不要改 `config/_default/`**
   `_default` 是模板。加载策略是「完全替换」——只要 `config/user/` 存在，`_default` 就整体失效，缺失项**不会**被补齐。所以改 user 那份就是全量生效。

2. **YAML 缩进必须是 2 的空格倍数，不能用 Tab**
   缩进错一层会直接构建失败或字段被静默忽略。列表项 `-` 与其父键同缩进层级。

3. **`main` 有分支保护，改动走分支 + PR**
   直推 `main` 会被拒（`GH006 ... Changes must be made through a pull request`），且必须等 `build_test` 通过。

---

## 2. 首页「出海工具」

**文件**：`src/components/HomeDashboard.astro`（第 14–87 行的 `globalTools` 数组）

这是一个数据驱动的快捷入口区，只出现在首页（`navigation` 第一项）。渲染逻辑在同文件底部 `globalTools.map(...)`，不用动。

新增一条：在数组末尾（`];` 之前）追加

```ts
  {
    name: 'Ahrefs',
    desc: '外链与 SEO 数据分析',
    href: 'https://ahrefs.com/',
    icon: 'fas fa-chart-column',
  },
```

- 顺序 = 卡片顺序，调整排序直接移动对象块
- `icon` 用 Font Awesome 6 类名；写成 `fas fa-rocket` 这种形式，`fas`/`fab` 前缀不能省
- 图标尺寸与排版由 `assets/styles/_dashboard.css` 的 `.global-tools-grid` 区块控制（图标容器 1.8rem、字号 0.9rem），条数变化会自动换行，不需要改 CSS
- 该数组用 TS 接口 `GlobalTool` 约束，缺字段或写错字段名 `tsc` 会报错

## 3. 首页「待办」面板

待办数据存在浏览器 `localStorage` 的 `menav_todos_v2`，结构为 `{ version: 2, items: [{ id, text, done }] }`，属于用户本机数据，**不随仓库发布**，没有配置文件。首次读取旧 `menav_todos_v1` 数据时会自动迁移到 v2；v1 保留为迁移时快照，仅在 v2 缺失或损坏时用于恢复，不随后续修改更新。

- 想改默认初始待办（首次访问、无本地数据时显示的内容）：`src/runtime/app/todo.ts` 的 `DEFAULT_TODOS`
- 想清空自己的：浏览器控制台执行 `localStorage.removeItem('menav_todos_v2'); localStorage.removeItem('menav_todos_v1')`
- 跨标签页修改会自动同步；存储不可用时仅当前页面会话内有效

---

## 4. 常用页的 5 个分类栏位

**文件**：`config/user/pages/common.yml`

结构只有两层：`categories[] → sites[]`。

```yaml
categories:
  - name: 置顶
    icon: fas fa-star
    sites:
      - name: Linux.do
        url: https://linux.do/
        icon: fab fa-linux
        description: 新的理想型社区
```

### 4.1 增加一个站点

在目标分类的 `sites:` 下追加（注意 `- name` 的缩进与同级条目对齐）：

```yaml
- name: Notion
  url: https://www.notion.so
  icon: fas fa-book
  description: 笔记与知识库
```

### 4.2 删除一个站点 / 整个栏位

- 删站点：整段 `- name:` 到 `description:` 一起删，不要只删 `name`
- 删栏位：删掉从 `- name: 学习资源` 到下一个 `- name:` 之前的整块（含 `sites:` 及其条目）
- 只留一个 `sites:` 为空数组也合法，但页面上会渲染一个空分类，建议整块删除

### 4.3 新增一个分类栏位

在 `categories:` 下按同一缩进追加：

```yaml
- name: AI 工具
  icon: fas fa-robot
  sites:
    - name: ChatGPT
      url: https://chat.openai.com
      icon: fas fa-robot
      description: AI 智能助手
```

分类还支持 `slug`（锚点标识）、`subgroups` / `subcategories`（继续嵌套）、`level`（层级），一般用不到。

### 4.4 改栏位名和图标

改该分类的 `name` 与 `icon` 即可，`icon` 是栏位标题左侧的图标，与站点的 `icon` 互不影响。

---

## 5. 图标为什么改了没反应

这是最容易踩的坑。`config/user/site.yml` 当前是：

```yaml
icons:
  mode: favicon # 卡片优先显示站点真实 favicon
  region: cn # 优先走 gstatic.cn
```

`favicon` 模式下，卡片图标来自第三方 favicon 服务，**`icon:` 字段只在 favicon 加载失败时作为回退**。所以：

| 目标                     | 做法                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| 只让某一个站点用矢量图标 | 该站点下加 `forceIconMode: manual`                               |
| 用自己准备的图片         | 该站点下加 `faviconUrl: assets/xxx.svg`（本地路径会随构建复制）  |
| 全站都不用第三方 favicon | 改 `icons.mode: manual`（顺带消除 favicon 请求失败的控制台噪音） |
| 想让 favicon 更快        | 保持 `mode: favicon`，`region` 按所在地区选 `cn` / `com`         |

优先级：`faviconUrl` > `forceIconMode` > 全局 `icons.mode`。

---

## 6. 书签页（自动生成，不要手改）

**文件**：`config/user/pages/bookmarks.yml`，文件头写着「自动生成」。

流程：

1. 浏览器导出书签 HTML → 放入 `bookmarks/` 目录
2. `npm run import-bookmarks` 解析 → 覆写 `bookmarks.yml` → 删除已处理的 HTML
3. `npm run dev` 或 `npm run build` 查看效果（**`dev` 不会自动导入**，必须手动跑第 2 步）

需要稳定 diff（便于 review）时加环境变量：

```bash
MENAV_BOOKMARKS_DETERMINISTIC=1 npm run import-bookmarks
```

线上自动链路：`bookmarks/*.html` 一进 `main`，`Build and Deploy Site` 工作流会导入、推到 `automation/bookmarks-sync` 分支、开 PR 并开启自动合并。若 PR 卡在 `action_required`，去 Actions 里手动 approve 一次即可继续。

**注意**：手改 `bookmarks.yml` 的成果会在下一次导入时被整体覆盖。想长期保留的站点应放回浏览器的书签源里，或改到 `common.yml` 手工栏位。

---

## 7. 项目页

**文件**：`config/user/pages/projects.yml`，`template: projects`，卡片自动使用「代码仓库风」样式。

```yaml
categories:
  - name: 个人项目
    icon: fas fa-code
    sites:
      - name: MeNav
        icon: fab fa-github
        description: 一键部署的个人导航站生成器
        url: https://github.com/CaryLabs/nav
```

- 增删项目 = 增删 `sites` 条目，与常用页写法一致
- 卡片上的语言 / star / fork 数是**自动抓取**的：`npm run sync-projects` 联网拉取并写入 `dev/` 缓存（该目录不入库）
- `npm run build` 会尽力刷新缓存；拿不到数据时卡片只显示标题与描述，不会报错

---

## 8. 文章页

**文件**：`config/user/pages/articles.yml`，`template: articles`。

**关键约束**：`url` 必须填**站点首页**，不是某篇文章的链接——系统会自己去发现该站的 RSS/Atom。

- 增删来源站点 = 增删 `sites` 条目
- 抓取：`npm run sync-articles`（联网，写入 `dev/` 缓存）；`npm run build` 本身不联网
- 抓取上限在 `site.yml` 的 `rss` 段：`articles.perSite`（单站条数，当前 8）、`articles.total`（总上限，当前 50）、`articles.summaryMaxLength`（摘要长度）
- 没有缓存时，页面退化为来源站点列表

---

## 9. 关于页

**文件**：`config/user/pages/content.yml` 指向 `content/about.md`，直接改 Markdown 即可。

要换文件：新建 `content/xxx.md`，把 `content.file` 改成 `content/xxx.md`。

---

## 10. 侧边栏与站点级设置

**文件**：`config/user/site.yml`

```yaml
navigation: # 侧边栏导航；第一项即首页
  - name: 常用
    icon: fas fa-star
    id: common # 必须对应 pages/common.yml
```

常用字段：

| 段                                 | 作用               | 常用键                                                |
| ---------------------------------- | ------------------ | ----------------------------------------------------- |
| `title` / `description` / `author` | 站点元信息         | 字符串                                                |
| `profile`                          | 首页顶部欢迎语     | `title`、`subtitle`                                   |
| `navigation`                       | 侧边栏菜单         | `id`（必填）、`name`、`icon`、`hidden`                |
| `social`                           | 侧边栏底部社交链接 | `name`、`url`、`icon`                                 |
| `icons`                            | 卡片图标模式       | `mode`、`region`                                      |
| `theme`                            | 默认明暗           | `mode: dark \| light \| system`                       |
| `fonts`                            | 全站字体           | `source: css \| google \| system`、`cssUrl`、`family` |
| `security.allowedSchemes`          | 允许的链接协议     | 默认 `http/https/mailto/tel`                          |
| `github`                           | 项目页热力图       | `username`、`heatmapColor`                            |
| `rss`                              | 文章聚合           | 见第 8 节                                             |

### 新增一个页面

1. 建 `config/user/pages/<id>.yml`，至少写 `title` 与 `template`（`page` / `projects` / `articles` / `bookmarks` / `content`）
2. 在 `site.yml` 的 `navigation` 里加一项 `{ name, icon, id: <id> }`
3. 想换首页：把该项移到 `navigation` 第一行
4. 隐藏某页但保留配置：该项加 `hidden: true`

---

## 11. 字段速查

站点条目（`sites[]`）：

| 字段             | 类型                 | 说明                                    |
| ---------------- | -------------------- | --------------------------------------- |
| `name`           | 字符串               | 卡片标题                                |
| `url`            | 字符串               | 目标地址，仅 `http/https` 或相对路径    |
| `icon`           | 字符串               | Font Awesome 类名，favicon 模式下为回退 |
| `description`    | 字符串               | 卡片副标题                              |
| `faviconUrl`     | 字符串               | 单站点图标，优先级最高                  |
| `forceIconMode`  | `favicon` / `manual` | 单站点图标模式覆盖                      |
| `external`       | 布尔                 | 外链打开行为                            |
| `style` / `type` | 字符串               | 卡片样式与类型标记，一般不用            |

分类节点：`name`、`icon`、`slug`、`level`、`sites`、`subcategories` / `groups` / `subgroups`。

---

## 12. 本地验证与发布

```bash
npm run dev            # 本地预览；config/ 改动会自动重建，assets/styles/ 改动不生效时重启 dev
npm run check          # lint + 单元测试 + 完整构建（含配置 schema 校验）+ 产物审计 + tsc
npm run build          # 只产出 dist/（不入库），比 check 快
npm run test:browser   # Playwright 契约测试（需先 build）
npx prettier --check <文件>   # 单独校验格式
```

`npm run check` 是最全的一道门，但它内部会跑完整构建，耗时长；日常小改动用 `npm run build` + `npx prettier --check` 即可，提交前再补一次 `check`。

发布流程：

1. 从 `main` 切分支：`git switch -c feat/xxx`
2. 改配置 / 代码，本地 `npm run dev` 看效果
3. `npm run check` 与（涉及页面时）`npm run test:browser`
4. 提交并推送分支 → 开 PR → 等 `build_test` 变绿
5. squash 合并到 `main` → `Build and Deploy Site` 自动构建部署

---

## 13. 常见坑

| 现象                                     | 原因                                                            | 处理                                       |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| 改了 `_default` 完全没生效               | `config/user/` 存在时 `_default` 被整体忽略                     | 改 `config/user/` 同名文件                 |
| 改了 `icon` 但卡片图标没变               | `icons.mode: favicon`，显示的是站点真实图标                     | 加 `forceIconMode: manual` 或改全局 `mode` |
| 构建报 YAML 错误                         | Tab 缩进，或 `-` 与父键缩进不一致                               | 统一为 2 空格倍数                          |
| 书签页改动被「还原」                     | `bookmarks.yml` 由导入脚本整体覆写                              | 改书签源，或迁到 `common.yml`              |
| 文章页没有内容                           | 未跑 `npm run sync-articles`，或 `url` 填了文章链接而非站点首页 | 补抓取、改 `url`                           |
| 项目卡片只有标题                         | `dev/` 缓存缺失且未联网抓取                                     | `npm run sync-projects`                    |
| 新页面侧边栏点进去 404                   | `navigation.id` 与 `pages/<id>.yml` 文件名不一致                | 两者对齐                                   |
| 搜索搜不到新加的站点                     | 搜索索引在构建时生成                                            | 重新 `npm run build`                       |
| 直推 `main` 被拒                         | 分支保护要求走 PR 且 `build_test` 通过                          | 开 PR，等检查变绿                          |
| `npm run format:check:changed` 报 ENOENT | 该脚本以 POSIX sh 形式调用 `.bin/prettier`，Windows 下不可用    | 改用 `npx prettier --check <文件>`         |

---

## 14. 改动影响范围速查

- 只改 `config/user/pages/*.yml`、`content/*.md`：只影响页面数据，不动构建逻辑
- 改 `src/components/HomeDashboard.astro`：只影响首页快捷区与待办
- 改 `assets/styles/*.css`：全站样式，改完务必同时看深色 / 浅色主题与移动端宽度
- 改 `src/lib/**`、`src/runtime/**`：属于功能改动，必须跑 `npm run check` 与 `npm run test:browser`，并在 PR 描述里写清验证方式
