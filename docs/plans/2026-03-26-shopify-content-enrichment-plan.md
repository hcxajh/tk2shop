# Shopify 标题/描述增强与评论素材接入 Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** 在 tk2shop 现有采集 → CSV 导入 Shopify 链路中，新增一个内容加工步骤：把原始标题规范化为 Shopify 标题、对产品介绍做保结构轻优化、生成 3 条供后续模板使用的评论素材，并让 `to-csv.js` 优先读取增强字段。

**Architecture:** 保持采集层输出原始 `product.json` 不变，在发布前新增 `scripts/publisher/enrich-product.js` 作为中间加工层。该脚本回写 `shopifyContent` 和 `templateAssets` 字段；CSV 导出层只负责读取增强结果并带兜底回退，不在导出脚本里承担生成逻辑。

**Tech Stack:** Node.js, fs/path, 现有 tk2shop 脚本结构, Shopify CSV (`Body (HTML)`), 轻量 HTML 保结构处理。

---

## 范围与约束

- 标题：**仅**基于原始标题做 Shopify 化规范，不扩写、不加营销话术。
- 描述：**必须保留原图文顺序与结构**，不重建详情页模板，只做文字层轻优化。
- 评论：生成 3 条 `templateAssets.reviews`，当前**不**写入 CSV 主体描述。
- 回退：任一增强步骤失败，都不能阻断 CSV 导出主链路。

---

### Task 1: 明确 `product.json` 增强字段结构

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/docs/plans/2026-03-26-shopify-content-enrichment-plan.md`
- Create: `/root/.openclaw/skills/tk2shop/docs/plans/2026-03-26-shopify-content-enrichment-design-snippet.json`

**Step 1: Write the failing test**
- 这里不写自动化测试，先落一份字段契约样例，作为后续脚本实现与回归检查基准。

**Step 2: Run test — confirm it fails**
- 不适用（文档任务）。

**Step 3: Write minimal implementation**
- 创建字段契约样例，至少包含：
  - `shopifyContent.title`
  - `shopifyContent.descriptionHtml`
  - `templateAssets.reviews`
  - `contentMeta.version`
  - `contentMeta.descriptionMode`
- 样例如下：

```json
{
  "title": "Original product title",
  "shopifyContent": {
    "title": "Normalized Shopify Title",
    "descriptionHtml": "<div><p>Original layout preserved.</p><img src=\"https://example.com/a.jpg\"></div>"
  },
  "templateAssets": {
    "reviews": [
      { "name": "Emily", "content": "Looks great and feels very practical for daily use." },
      { "name": "Jason", "content": "Good quality and easy to use. Exactly what I needed." },
      { "name": "Mia", "content": "Nice details, simple to use, and matches the description well." }
    ]
  },
  "contentMeta": {
    "version": "v1",
    "descriptionMode": "preserve-layout",
    "reviewsGenerated": true
  }
}
```

**Step 4: Run test — confirm it passes**
- 人工检查字段命名与职责是否与本计划一致。

**Step 5: Commit**
- 暂不提交，等代码一并完成后再统一提交。

---

### Task 2: 新增 `enrich-product.js` 骨架与 CLI 入口

**Files:**
- Create: `/root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js`
- Test: `/root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js`（先用命令行样本回归代替单元测试）

**Step 1: Write the failing test**
- 先定义最小执行命令：
  - `node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js <商品目录>`
- 预期当前失败：文件不存在。

**Step 2: Run test — confirm it fails**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039
```
Expected: FAIL — `Cannot find module` / 文件不存在。

**Step 3: Write minimal implementation**
- 新建脚本并支持：
  - 解析商品目录参数
  - 读取 `product.json`
  - 调用三个内部函数：
    - `normalizeShopifyTitle(product)`
    - `refineDescriptionPreservingLayout(product)`
    - `buildTemplateReviews(product)`
  - 将结果回写到 `product.json` 的：
    - `shopifyContent`
    - `templateAssets`
    - `contentMeta`
- 第一版允许内部函数先返回基础兜底值。

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039
```
Expected: PASS — 脚本成功执行，`product.json` 被回写增强字段。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js && git commit -m "feat: add product enrichment entry script"
```

---

### Task 3: 实现标题规范化逻辑

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js`
- Test: 使用真实样本 `product.json` 回归

**Step 1: Write the failing test**
- 选 1~2 个真实商品样本，断言输出标题：
  - 不为空
  - 与原始标题相比更干净
  - 不新增明显营销词
- 可先用人工断言标准代替自动化测试。

**Step 2: Run test — confirm it fails**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq '.shopifyContent.title, .title' /root/.openclaw/TKdown/2026-03-24/039/product.json
```
Expected: FAIL — 当前标题尚未经过规范化或与原始标题完全一致。

**Step 3: Write minimal implementation**
- 在 `normalizeShopifyTitle(product)` 中实现：
  - 去掉前后多余空格
  - 收缩重复空格
  - 去掉明显平台化前缀/噪声词（如 `New`, `Hot`, 年份噪声等，需谨慎）
  - 保留核心商品名，不主动扩写
  - 如果处理后为空，回退原始标题

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq '.shopifyContent.title, .title' /root/.openclaw/TKdown/2026-03-24/039/product.json
```
Expected: PASS — `shopifyContent.title` 已生成，且符合“仅规范化原始标题”的要求。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js && git commit -m "feat: normalize source title for shopify"
```

---

### Task 4: 实现描述保结构轻优化

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js`
- Test: 使用真实样本 HTML 回归

**Step 1: Write the failing test**
- 选择一个含图文混排描述的真实样本，检查：
  - 图片数量不变
  - 图片顺序不变
  - 主要标签结构不变
  - 输出存在 `shopifyContent.descriptionHtml`

**Step 2: Run test — confirm it fails**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq '.shopifyContent.descriptionHtml' /root/.openclaw/TKdown/2026-03-24/039/product.json
```
Expected: FAIL — 当前要么无该字段，要么未体现“保结构”。

**Step 3: Write minimal implementation**
- 在 `refineDescriptionPreservingLayout(product)` 中实现：
  - 若存在原始 HTML，优先基于原始 HTML 处理
  - 若无 HTML 但有文本/描述图块，则最小兜底生成简单 HTML
  - 第一版仅允许：
    - 清理多余空白
    - 修正常见标点与换行
    - 对纯文本节点做轻微文案净化
  - 不重排图片与段落顺序
  - 若处理出错，直接回退原始 HTML

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq -r '.shopifyContent.descriptionHtml' /root/.openclaw/TKdown/2026-03-24/039/product.json | head -c 500
```
Expected: PASS — 可见增强后的 HTML，且结构与原始内容一致，不是重建模板。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js && git commit -m "feat: preserve layout while refining description"
```

---

### Task 5: 实现 3 条评论素材生成

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js`
- Test: 使用真实样本回归

**Step 1: Write the failing test**
- 断言输出：
  - `templateAssets.reviews.length === 3`
  - 每条含 `name`
  - 每条 `content` 长度 <= 100 字

**Step 2: Run test — confirm it fails**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq '.templateAssets.reviews' /root/.openclaw/TKdown/2026-03-24/039/product.json
```
Expected: FAIL — 当前无评论素材或数量不满足。

**Step 3: Write minimal implementation**
- 在 `buildTemplateReviews(product)` 中实现：
  - 固定输出 3 条评论
  - 名字从小型名字池取值
  - 内容基于标题/卖点轻量拼装
  - 限制每条 100 字内
  - 风格自然、不夸张
  - 失败时回退为空数组

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039 && jq '.templateAssets.reviews' /root/.openclaw/TKdown/2026-03-24/039/product.json
```
Expected: PASS — 返回 3 条可供后续模板使用的评论素材。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js && git commit -m "feat: generate template review assets"
```

---

### Task 6: 让 `to-csv.js` 优先读取增强字段

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/to-csv.js`
- Test: 真实商品目录导出 CSV

**Step 1: Write the failing test**
- 选择一个已 enrich 的商品目录，要求：
  - CSV 中 `Title` 使用 `shopifyContent.title`
  - CSV 中 `Body (HTML)` 使用 `shopifyContent.descriptionHtml`
  - 若增强字段缺失，仍能回退原始字段

**Step 2: Run test — confirm it fails**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/to-csv.js 2026-03-24/039 && sed -n '1,3p' /root/.openclaw/TKdown/2026-03-24/039/product.csv
```
Expected: FAIL — 当前 CSV 仍只读取原始字段。

**Step 3: Write minimal implementation**
- 在 `to-csv.js` 中新增读取逻辑：
  - `const exportTitle = product.shopifyContent?.title || product.title || ''`
  - `const exportDescriptionHtml = product.shopifyContent?.descriptionHtml || <原有描述兜底>`
- 明确：当前**不**把 `templateAssets.reviews` 写入 CSV 描述主体。

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/to-csv.js 2026-03-24/039 && sed -n '1,3p' /root/.openclaw/TKdown/2026-03-24/039/product.csv
```
Expected: PASS — CSV 标题与描述已优先使用增强字段。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/publisher/to-csv.js && git commit -m "feat: export enriched shopify content to csv"
```

---

### Task 7: 在采集完成后自动触发 enrich

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/collector/runner.js`
- Test: 采集成功后检查是否自动生成增强字段

**Step 1: Write the failing test**
- 断言：采集完成后，无需手动执行，也会自动得到增强字段。

**Step 2: Run test — confirm it fails**
Command:
```bash
# 以一次真实采集为准，采集结束后检查 product.json 是否已有 shopifyContent/templateAssets
```
Expected: FAIL — 当前采集后不会自动 enrich。

**Step 3: Write minimal implementation**
- 在 `runner.js` 保存完 `product.json` 后：
  - 调用 `node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js <商品目录>`
  - enrich 失败只记日志，不阻断主采集结果落盘

**Step 4: Run test — confirm it passes**
Command:
```bash
# 运行一次真实采集后检查 product.json
jq '.shopifyContent, .templateAssets' <采集结果目录>/product.json
```
Expected: PASS — 采集完成后已自动附带增强字段。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/scripts/collector/runner.js && git commit -m "feat: auto enrich product after collection"
```

---

### Task 8: 更新 CHANGELOG 并做回归验证

**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/CHANGELOG.md`
- Modify: `/root/.openclaw/skills/tk2shop/docs/plans/2026-03-26-shopify-content-enrichment-plan.md`

**Step 1: Write the failing test**
- 回归目标：
  - enrich 能执行
  - CSV 能导出
  - 标题字段正确
  - 描述不乱版
  - 评论已写入 `templateAssets`

**Step 2: Run test — confirm it fails**
- 在代码未完成前，此回归自然无法全部通过。

**Step 3: Write minimal implementation**
- 在 `CHANGELOG.md` 追加版本记录，写明：
  - 新增内容加工步骤
  - 标题 Shopify 化
  - 描述保结构轻优化
  - 评论素材字段
  - CSV 优先读增强字段
- 在计划文档末尾追加回归记录区。

**Step 4: Run test — confirm it passes**
Command:
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/enrich-product.js /root/.openclaw/TKdown/2026-03-24/039
node /root/.openclaw/skills/tk2shop/scripts/publisher/to-csv.js 2026-03-24/039
```
Expected: PASS — 关键链路可跑通。

**Step 5: Commit**
```bash
git add /root/.openclaw/skills/tk2shop/CHANGELOG.md /root/.openclaw/skills/tk2shop/docs/plans/2026-03-26-shopify-content-enrichment-plan.md && git commit -m "docs: record product content enrichment rollout"
```

---

## 执行顺序建议

1. Task 1：字段契约
2. Task 2：enrich 骨架
3. Task 3：标题规范化
4. Task 4：描述保结构轻优化
5. Task 5：评论素材
6. Task 6：CSV 读取增强字段
7. Task 7：采集后自动 enrich
8. Task 8：CHANGELOG + 回归

---

## 回退策略

- `shopifyContent.title` 生成失败 → 回退原始 `title`
- `shopifyContent.descriptionHtml` 处理失败 → 回退原始 HTML/描述
- `templateAssets.reviews` 生成失败 → 写空数组
- 自动 enrich 执行失败 → 不阻断采集完成与原始 `product.json` 落盘

---

## 验收口径

- 标题只做原始标题规范化，不扩写。
- 描述输出保留原图文混排，不重排版。
- 评论固定 3 条，当前只存档不进正文。
- CSV 导出优先读取增强字段，但保留兜底逻辑。
