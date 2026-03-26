# Description Blocks to Shopify HTML Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** 在 `to-csv.js` 中新增 `descriptionBlocks -> Body (HTML)` 导出链路，并在缺失 blocks 时回退旧逻辑。

**Architecture:** 保持最小改动，不改采集端与 enrich 职责，只在 CSV 导出阶段新增 HTML 渲染函数。优先消费 `product.descriptionBlocks`，按 block 顺序生成 Shopify 可接受的基础 HTML；无 blocks 或渲染结果为空时，回退到原始 `description` 的 `<br>` 逻辑。

**Tech Stack:** Node.js, 现有 `scripts/publisher/to-csv.js`, 本地样本 `product.json`

---

### Task 1: 在 to-csv.js 中新增 descriptionBlocks HTML 渲染函数

**Files:**
- Modify: `scripts/publisher/to-csv.js`

**Step 1: Write the failing test**
- 由于当前仓库暂无成熟测试基座，本次以真实样本回归替代最小测试闭环。

**Step 2: Run test — confirm current behavior is insufficient**
Command: 使用现有真实样本导出 CSV，确认 `Body (HTML)` 仍仅来自 `description.replace(/\n/g, '<br>')`
Expected: FAIL（从需求角度）— 无法消费 `descriptionBlocks`

**Step 3: Write minimal implementation**
- 新增 `escapeHtml()`
- 新增 `renderDescriptionBlocksHtml(product)`
- 规则：
  - `text` -> `<p>...</p>`
  - `image` -> `<img src="..." alt="" style="max-width:100%;height:auto;display:block;">`
- `Body (HTML)` 优先使用 `descriptionBlocks` 渲染结果
- 若 blocks 为空或渲染为空，则回退到旧逻辑

**Step 4: Run test — confirm it passes**
Command: 用 `/root/.openclaw/TKdown/2026-03-26/008` 或 `/009` 导出 CSV，并检查 `Body (HTML)` 已按 block 顺序输出图文
Expected: PASS

**Step 5: Commit**
`git add scripts/publisher/to-csv.js CHANGELOG.md && git commit -m "feat: export description blocks to shopify html"`

### Task 2: 更新 CHANGELOG 并做真实样本回归

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Write the failing test**
- 无独立测试基座，使用回归验证替代。

**Step 2: Run test — confirm current changelog lacks this feature**
Command: 检查 `CHANGELOG.md`
Expected: FAIL（从需求角度）— 尚未记录 block 导出能力

**Step 3: Write minimal implementation**
- 记录 `descriptionBlocks -> Body (HTML)` 导出能力
- 说明当前详情图先直接使用原始 URL，不经过 imgbb 中转

**Step 4: Run test — confirm it passes**
Command: 再次导出真实样本 CSV，确认功能与文档一致
Expected: PASS

**Step 5: Commit**
- 与 Task 1 一并提交或单独提交
