# CHANGELOG - tk2shop

## v0.2.5 (2026-03-24)

### 新增/修复：import-csv-onestop.js 配置外部化和CDP逻辑对齐

**修复内容：**
- 配置外部化：`PROFILE_NO` 从 `config/stores.json` 读取，支持 `--store` 参数
- URL 改为 `https://admin.shopify.com`（不再拼接 store slug）
- CDP 逻辑对齐：改用 `openBrowser()` 返回 `{cdpUrl, isNew}`，与 `upload-product.js` 一致
- CLI：`node import-csv-onestop.js <商品目录> --store <店铺ID>`
- 修复：点击"上传 Shopify 格式的 CSV 文件"文字选择CSV模式（原选择器不稳定）
- 清理：新建 Tab 前关闭已有 Tab，按 `isNew` 策略清理
- `stores.json` 更新：添加 vellin1122 店铺配置（profileNo: 1896325）

### 修复：to-csv.js 图片路径格式

- 图片 URL 改为 `/root/...` 格式（不带 `file://` 前缀），便于 import-csv-onestop.js 正确识别本地路径并上传到 imgbb

### 修复：to-csv.js CSV 格式按官方模板修正

**修复内容：**
- 去掉 BOM 输出（避免列名错位）
- 加第58列（末尾空列，与官方58列对齐）
- 主产品行：Option1/2 name 填值，Option1/2 value 为空
- 变体行：Option1/2 name 为空，Option1/2 value 填具体值
- Linked To 字段：全部留空
- Color metafield 字段：留空

## v0.2.4 (2026-03-24)

### 修复：Publisher/Collector 多处 CDP 资源泄漏和清理逻辑

**问题1：** Publisher `isProfileActive` 用 `JSON.parse()` 解析 `Browser active info: {...}` 导致解析失败，永远返回 false，每次都开新浏览器
- 修复：改用 `out.includes('"status": "Active"')`

**问题2：** Publisher `openBrowser` 成功后 `chromium.connectOverCDP` 失败时，catch 调用 `process.exit(1)` 导致 finally 不执行，AdsPower 浏览器泄漏
- 修复：移除 `process.exit(1)`，让异常传播到 finally 统一清理

**问题3：** Publisher/Collector finally 块未检查 `pg`/`browser`/`cdpResult`/`lockFile` 是否 undefined，在某些提前失败的路径下会 throw
- 修复：添加 `if (pg)`、`if (browser)` 等守卫条件

**问题4：** Collector 成功路径 `browser.disconnect()` 没 `.catch()` 保护，throws 时被 `main().catch()` 捕获导致 exit(1)
- 修复：用 try-catch 包裹清理代码

**问题5：** Publisher 新建 Tab 前没关闭已有 Tab，可能遗留干扰页面
- 修复：与 collector 一致，先关多余 Tab 再建新的

**问题6：** `existingPageCount` 变量声明后未使用
- 修复：删除

## v0.2.3 (2026-03-24)

### 修复：format-csv.js CSV 格式问题（Shopify 导入变体数量异常）

**问题根因：**
1. BOM 问题：`'\uFEFF' + csvContent` 导致 CSV 第一列名变成 `\ufeffTitle`，Shopify 解析错位
2. 变体行 Option name 错误：我们填了 `Size/Color`，官方模板变体行为**空**
3. 主产品行 Option value 问题：填了具体值导致和变体行合并
4. 缺少 Shopify 必填字段：`Fulfillment service`、`Continue selling when out of stock`、`Requires shipping`、`Inventory tracker` 均缺失

**修复内容：**
- `format-csv.js`：移除手动 BOM，Json2csvParser 原生输出
- 主产品行：`option1Value/option2Value` 留空，避免 Shopify 合并变体
- 变体行：`option1Name/option2Name` 留空，与官方模板一致
- 新增字段：主产品行和变体行均添加 `Inventory tracker=shopify`、`Fulfillment service=manual`、`Continue selling when out of stock=DENY`、`Requires shipping=TRUE`

## v0.2.2 (2026-03-23)

### 新增：Shopify CSV 批量导入功能

**import-csv.js** — 通过 AdsPower 浏览器自动完成 Shopify CSV 导入全流程：
- 点击"导入"按钮 → 选择 CSV 模式 → 上传 CSV → 点击"上传并预览" → 点击"导入产品"
- `.Polaris-Modal-Dialog__Container` 弹窗内精准元素定位
- `input[name="importMethodOptions"][value="csv"]` radio 选择
- 预览按钮"导入产品"轮询检测（最多20次）
- 错误 Banner 检测（`.Polaris-Banner--variantCritical`）
- 15秒页面加载等待（应对 Cloudflare 验证）

**imgbb-upload.js** — 将 CSV 本地图片上传到 imgbb 图床：
- 读取 CSV 中 `./images/xxx` 本地路径
- 通过 imgbb API 上传，得到公网 URL
- 替换 CSV 中的图片路径为 imgbb URL
- 输出 `product-imgbb.csv` 供 import-csv.js 使用

## v0.2.1 (2026-03-23)

### 修复：浏览器 session 冲突问题

**问题：** 同时运行多个脚本（采集+发布）时，多个进程共用同一 AdsPower profile（1896325），导致 session 冲突过期。

**修复内容：**
- `upload-product.js` 新增 `isProfileActive()` — 打开浏览器前检查 profile 是否已被占用
- 新增 `acquireLock()` / `releaseLock()` 文件锁机制 — 防止同一机器上多脚本实例争用同一 profile
- 锁文件路径：`/tmp/tk2shop-locks/profile-{profileNo}.lock`
- 锁超时 30s，过期锁（>2分钟）视为孤儿锁自动清除

## v0.2.0 (2026-03-23)

### 重大修复：Shopify 发布脚本完全重写

**问题根因：**
- Shopify 新UI用 React 动态生成 DOM，ID每次变化（如 `#title` → `#P0-0`）
- `input#title` 不存在，必须用 `input[name="title"]`
- Product Options 的选项名/值输入框 name 属性稳定：`optionName[0]`, `optionValue[0][0]`
- 中文界面按钮文字不同："添加尺寸或颜色等选项"、"完成"

**修复内容：**

1. **标题输入**：`input[name="title"]` 替代 `input#title`
2. **价格输入**：`input[name="price"]` 替代动态ID选择器
3. **Product Options 流程**：
   - 按钮：中文 `添加尺寸或颜色等选项`
   - 选项名：`input[name="optionName[0]"]`
   - 选项值：`input[name="optionValue[0][0]"]`
   - 第二选项：先点 `添加其他选项`，再用 `optionName[1]`, `optionValue[1][0]`
   - 确认：`button:has-text("完成")`
4. **变体编辑**：`input.variant-price-input`, `input.variant-sku-input`
5. **保存按钮**：中文 `保存`

**发布结果：**
- 商品ID: 9157775491294 ✅
- 4个变体价格/SKU ✅
- 标题 ✅
- 价格/划线价 ✅

**仍需优化：**
- 主图上传（Media区域）
- 描述文字（ProseMirror富文本编辑器）
- SKU缩略图

---

## v0.1.0 (2026-03-22)

- tk2shop-agent 子代理技能创建
- 商品采集流程完成（9主图+2描述图+4 SKU）
- upload-product.js 初版（基于 API，非UI模拟）

## v0.3.0 (2026-03-23 later)

### 修复：SKU解析和描述上传

**SKU解析修复：**
- 原逻辑：`s.name.split('-')` 会把"(Noise-reduced upgraded version) iPhone"错误拆分
- 新逻辑：`s.name.split(') ')` 按") "分隔，正确提取出选项名和端口

**图片上传（已验证）：**
- Media区域文件输入框: `input#:r1f:` (accept=image/*)
- 直接 `setInputFiles()` 上传，无需点击按钮
- 上传9主图+2描述图 = 11张，全部成功

**描述填写（部分有效）：**
- `textarea#product-description-rn.value=` 可写入数据
- 但UI编辑器可能不显示（Shopify内部状态未更新）
- 提交时应能正确保存（需进一步验证）

**发布结果：**
- 商品ID: 9157776146654 ✅
- 标题 ✅ / 价格 ✅ / 图片 ✅
- 变体选项：提取逻辑已修复

## v0.4.0 (2026-03-23 later)

### 重大修复：描述编辑器 + SKU解析

**描述编辑器（已解决）：**
- Shopify 描述编辑器是 **TinyMCE**，渲染在 iframe 中
- iframe ID: `product-description-rn_ifr`
- 编辑器元素: `#tinymce` (在iframe内)
- 正确方式: `pg.frameLocator('iframe#product-description-rn_ifr').locator('#tinymce').type(text)`
- 之前用 `textarea.value=` 写入不显示，改用 iframe TinyMCE 后成功显示

**SKU解析（已解决）：**
- 两种SKU名称格式:
  1. `(Noise-reduced upgraded version) iPhone` → 用 `) ` 分隔
  2. `2 PCS-Type C` → 用最后一个 `-` 分隔
- 修复后: option1 = ["Noise-reduced upgraded version", "2 PCS"], option2 = ["iPhone", "Type C", "Type-C"]

**关键选择器（中文Shopify）：**
- 描述iframe: `iframe#product-description-rn_ifr`
- TinyMCE编辑区: `#tinymce`
- 选项名: `input[name="optionName[0]"]`
- 选项值: `input[name="optionValue[0][0]"]`
