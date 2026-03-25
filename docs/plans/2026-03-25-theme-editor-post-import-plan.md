# Shopify 导入后直进 Theme Editor 与 Product 模板创建 Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** 在现有 tk2shop 发布链路中，新增一段最小可复用脚本：从 CSV 导入成功后的当前 Shopify 后台上下文，直接进入 Theme Editor，切到 Product，创建模板，并进入 Multicolumn。

**Architecture:** 复用现有 publisher 目录下的 Playwright + AdsPower 连接方式，不重造浏览器管理。新脚本只负责“导入后后台 → Theme Editor → Product 模板 → Multicolumn”这一段，避免和 CSV 导入、商品信息填写、列内容编辑混在一起。先把稳定可复现路径固化，再决定是否并入更长总流程。

**Tech Stack:** Node.js, Playwright, AdsPower CDP, 现有 tk2shop scripts/publisher 结构

---

### Task 1: 梳理脚本入口与复用边界

**Files:**
- Create: `/root/.openclaw/skills/tk2shop/docs/plans/2026-03-25-theme-editor-post-import-plan.md`
- Inspect: `/root/.openclaw/skills/tk2shop/scripts/publisher/import-csv-onestop.js`
- Inspect: `/root/.openclaw/skills/tk2shop/scripts/publisher/upload-product.js`

**Step 1: 明确新脚本职责**
- 只处理以下动作：
  1. 连接现有店铺对应浏览器
  2. 从当前 Shopify 后台上下文进入 Theme Editor
  3. 切到 Product
  4. 创建模板
  5. 进入 Multicolumn
  6. 成功后停住

**Step 2: 明确不做的范围**
- 不处理 CSV 生成
- 不处理 CSV 导入本身
- 不处理 Multicolumn 下 Column 的编辑
- 不处理保存发布
- 不处理模板分配到具体商品

**Step 3: 产出落点决定**
- 新增脚本：`/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`
- 原因：避免把导入逻辑和主题编辑逻辑硬耦合，先独立验证稳定性

**Step 4: Commit**
- 与代码任务一起提交，不单独提交计划文档

---

### Task 2: 实现浏览器连接与 Shopify 后台上下文检测

**Files:**
- Create: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 1: 写最小失败验证**
- 先以最小方式验证：脚本能连接 AdsPower 对应 profile，并拿到现有 context/page
- 若当前无 Shopify 后台页，明确报错退出，而不是盲开新后台页

**Step 2: 实现最小能力**
- 复用 stores.json 店铺查找方式
- 复用 AdsPower open/attach 逻辑
- 在现有 pages 中寻找：
  - `admin.shopify.com/store/<slug>/...`
- 找到后聚焦该页作为入口页

**Step 3: 成功标准**
- 日志能明确打印：
  - 店铺
  - profile
  - 命中的 Shopify 后台页 URL

---

### Task 3: 实现从当前后台进入 Theme Editor

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 1: 写最小失败验证**
- 若当前页不是可通往主题编辑的后台上下文，脚本应明确报错：无法从当前上下文进入 Theme Editor

**Step 2: 实现进入逻辑**
- 先按已验证思路处理：
  1. 在当前后台页中寻找能进入 `Online Store / Themes` 的稳定入口
  2. 进入主题页后，识别主体 iframe
  3. 从 `Edit theme` 区域获取真实 Theme Editor 入口
  4. 直接打开 editor 链接

**Step 3: 成功判定**
- 页面 URL 命中：`/themes/<themeId>/editor`
- 或正文中出现 Theme Editor 顶部模板切换结构

---

### Task 4: 实现切到 Product 并创建模板

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 1: 实现 iframe 内定位**
- 在 editor iframe 中工作，不在顶层 DOM 盲找
- 定位顶部模板切换按钮：`aria-controls="topbar-picker-templates"`

**Step 2: 实现模板创建路径**
- 打开模板切换器
- 点击 `li#PRODUCT button`
- 点击 `li#__create__ button`
- 在模板弹窗中输入模板名
- 点击 `Create template`

**Step 3: 输入策略**
- 不只依赖 `input.value = xxx`
- 优先使用真实输入事件
- 若输入值异常，报错并退出，不静默继续

**Step 4: 成功判定**
- 创建后进入新模板页面
- 左侧出现 Product 模板相关 section 列表

---

### Task 5: 实现进入 Multicolumn 并停住

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 1: 实现稳定点击逻辑**
- 先锁定 `data-component-extra-section_type="multicolumn"` 对应 `li`
- 再点击其主按钮：
  - `button.Online-Store-UI-NavItem__PrimaryAction_1232d`

**Step 2: 成功判定**
- 左侧出现：
  - `Add Column`
  - 三个 `Column`
- 或右侧/设置区出现 Multicolumn 典型字段：
  - `Heading`
  - `Image`
  - `Button`
  - `Layout`

**Step 3: 停止策略**
- 一旦确认进入 Multicolumn，脚本立即结束
- 不继续编辑列内容

---

### Task 6: 增加最小命令行参数与文档说明

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`
- Modify: `/root/.openclaw/skills/tk2shop/CHANGELOG.md`
- Modify: `/root/.openclaw/skills/tk2shop/docs/shopify-post-publish-steps.md`

**Step 1: CLI 约定**
- 最小参数：
  - `--store <storeId>`
  - `--template-name <name>`
- 若缺模板名，可使用默认名并打印日志

**Step 2: 文档更新**
- 在发布后步骤文档中补充：
  - 脚本定位
  - 脚本职责范围
  - 当前只自动做到 Multicolumn

**Step 3: CHANGELOG 更新**
- 新增版本记录，说明已新增“导入后直进 Theme Editor 与 Product 模板创建”脚本

---

### Task 7: 自检验证

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 1: 基础自检**
- 运行一次脚本帮助或最小参数校验，确认无语法错误

**Step 2: 代码级自检**
- 至少执行：
  - `node --check /root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**Step 3: 结果要求**
- 无语法错误
- 日志与错误信息可读
- 不依赖隐式全局变量

**Step 4: Commit**
- `git add scripts/publisher/post-import-theme-setup.js docs/shopify-post-publish-steps.md CHANGELOG.md docs/plans/2026-03-25-theme-editor-post-import-plan.md && git commit -m "新增导入后主题编辑最小闭环脚本"`
