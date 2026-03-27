# CHANGELOG - tk2shop

## v0.3.34 (2026-03-27)

### 修复：Theme template 精准绑定、模板列表同步等待与足贴标题串货

**本轮修复内容：**
- `scripts/publisher/post-import-theme-setup.js`
  - 不再只靠全页模糊扫描 `s-internal-select` 猜测模板控件
  - 改为命中真正 `label=Theme template` 的下拉后再执行绑定
  - 新增“模板列表同步等待”逻辑：
    - Theme Editor 新建模板后，先检查商品页下拉是否已出现目标模板
    - 若未同步，则等待并在必要时 reload 商品页后重查
  - 修复模板绑定收尾 bug：
    - 临时标记 `data-openclaw-theme-template-target` 不再过早移除
    - 改为最终状态确认完成后再清理，避免后续 locator 超时
- `scripts/publisher/enrich-product.js`
  - 修复足贴类商品标题与评论素材串到旧脚磨脚器模板的问题
  - 为 `(turmeric|ginger) + foot patches` 增加独立标题规则
  - 不再把新商品默认归并到旧爆款品类标题风格

**真实验证结果：**
- 样本目录：`/root/.openclaw/TKdown/2026-03-27/004`
- Shopify 商品 ID：`9161183756510`
- 最终成功模板：`20260327173916`
- 最终链路验证通过：
  - 标题正确：`24 Pack Turmeric & Ginger Foot Patches for Overnight Foot Care`
  - 新模板创建成功
  - 模板列表同步后成功绑定商品
  - 日志出现：`商品模板已绑定并保存`
  - AdsPower profile 最终确认回到 `Inactive`

**本次修复意义：**
- 把模板绑定问题从“误抓控件”进一步收口到“模板列表同步延迟”并彻底修通
- 避免新商品标题/评论串货到旧品类，减少发布错误
- 让 `publish-product.js` 一条龙链路在真实新商品上再次闭环成功

## v0.3.33 (2026-03-27)

### 修复：模板收尾后增加 AdsPower profile 关闭确认与兜底关闭

**本轮修复内容：**
- `scripts/publisher/post-import-theme-setup.js`
  - 在脚本主动打开 AdsPower profile 的场景下，关闭后不再只执行一次 `close-browser`
  - 新增关闭确认逻辑：
    - 关闭后连续轮询 profile 状态
    - 若短时间内仍显示 `Active`，自动再执行一次兜底 `close-browser`
  - 新增收尾日志：
    - `AdsPower profile 已确认关闭`
    - 若状态持续抖动，则明确提示人工复核

**本次修复意义：**
- 区分“真实残留未关”与“AdsPower 状态查询短暂延迟”
- 让模板收尾后的退出判定更稳，不再只依赖单次状态查询
- 为后续定位 AdsPower 状态同步抖动留下更清晰日志

## v0.3.32 (2026-03-27)

### 调整：发布总入口统一编排采集、增强、CSV、导入与模板收尾

**本轮调整内容：**
- `scripts/collector/runner.js`
  - 移除“采集完成后自动调用 `enrich-product.js`”逻辑
  - 现在只负责：采集商品、下载图片、生成原始 `product.json`
- `scripts/publisher/publish-product.js`
  - 升级为统一总入口，支持两种模式：
    - 目录模式：`node publish-product.js <商品目录> --store <店铺ID>`
    - URL 模式：`node publish-product.js --url "<商品链接>" --store <店铺ID>`
  - 统一编排链路改为：
    1. 采集（仅 URL 模式）
    2. 内容增强 `enrich-product.js`
    3. CSV 生成 `to-csv.js`
    4. Shopify 导入 `import-csv-onestop.js`
    5. 模板收尾（由导入脚本内部继续执行）
  - 新增可选参数：
    - `--skip-enrich`
    - `--collect-only`
    - 保留 `--skip-csv` / `--csv-only`

**本次结构意义：**
- 采集、增强、发布职责彻底拆开，便于单独执行和排查
- 总入口统一编排，既能“一步执行”，也支持“分步执行”
- 原始采集产物与发布加工产物边界更清晰，后续扩展价格规则、标签规则、SEO 规则更方便

## v0.3.31 (2026-03-27)

### 修复：CSV 残留原始标题字段，并统一评论模板使用发布标题

**本轮修复内容：**
- `scripts/publisher/to-csv.js` 已修正 CSV 首行 `Image alt text` 的来源：
  - 之前仍使用原始 `product.title`
  - 现在改为优先使用 `product.shopifyContent.title`
- `scripts/publisher/enrich-product.js` 已修正评论模板文案生成来源：
  - 评论模板不再继续吃原始长标题
  - 现在优先基于发布标题 `shopifyContent.title` 生成评论内容
- 本次修复目标是清理“主字段已切到 Shopify 文案，但残留列仍带原始 TikTok 标题”的问题

**测试补充：**
- `scripts/publisher/__tests__/to-csv.test.js`
  - 新增：校验 CSV 首行 `Image alt text` 使用新标题
- `scripts/publisher/__tests__/enrich-product.test.js`
  - 新增：校验评论模板内容基于新发布标题生成，而不是旧长标题

**意义：**
- CSV 不再出现 `Title` 已切换、但 `Image alt text` 仍残留旧标题的混杂状态
- 模板评论素材也与发布标题保持一致，减少后台中旧标题残留痕迹

## v0.3.30 (2026-03-27)

### 调整：enrich 阶段改为直接生成 Shopify 发布用标题与介绍

**本轮调整内容：**
- `scripts/publisher/enrich-product.js` 的发布用文案生成逻辑从通用“轻清洗”收口为更直接的 Shopify 化改写：
  - 只写入 `shopifyContent.title`
  - 只写入 `shopifyContent.descriptionHtml`
  - 只写入 `shopifyContent.descriptionText`
- 保持原始采集字段不动：
  - 原 `title` 保留
  - 原 `description` 保留
  - 原 `descriptionBlocks` 保留
- 标题改写策略调整为：
  - 去除 TikTok / 平台味冗余词
  - 聚合核心品类与主要卖点
  - 输出更适合 Shopify 商品页的标题结构
- 介绍改写策略调整为：
  - 保持 `descriptionBlocks` 顺序不变
  - 保持图片区块位置和顺序不变
  - 仅替换 `text` block 的发布用表达
  - 使用更明确的商品页英文文案，而不是只做轻度清洗
- `contentMeta.descriptionMode` 已更新为：
  - `direct_rewrite`

**测试与验证：**
- 更新 `scripts/publisher/__tests__/enrich-product.test.js`
- 保留 `scripts/publisher/__tests__/to-csv.test.js`
- 本地测试通过：
  - `PASS enrich-product tests`
  - `PASS to-csv tests`
- 已对样本目录 `/root/.openclaw/TKdown/2026-03-26/018` 直接写入新的发布用标题与介绍，并成功重生成 `product.csv`

**意义：**
- 发布链路不再只做“文字清洗”，而是直接产出一版更接近 Shopify 商品页的发布用标题与介绍
- 在不动原始采集结果的前提下，把“源数据”和“发布数据”明确分层
- 保持 CSV 主链路稳定，后续导入会继续优先使用 `shopifyContent.descriptionHtml`

## v0.3.29 (2026-03-27)

### 新增：enrich 阶段同步生成 Shopify 轻改版产品介绍，并由 CSV 优先导出

**本轮新增内容：**
- `scripts/publisher/enrich-product.js` 不再只生成 `shopifyContent.title`，现已同步生成：
  - `shopifyContent.descriptionHtml`
  - `shopifyContent.descriptionText`
- 描述增强模式已从原来的 `disabled` 切到：
  - `contentMeta.descriptionMode = 'light_rewrite'`
- 轻改版描述遵循以下边界：
  - 保留原 `descriptionBlocks` 块顺序
  - 保留原图片区块位置，不重排图片
  - 仅轻改文字内容，不凭空新增卖点或参数
  - 全量去除 emoji
  - 弱化 TikTok / 平台味表达，使文案更接近 Shopify 商品页风格
- `scripts/publisher/to-csv.js` 新增描述导出优先级：
  1. `product.shopifyContent.descriptionHtml`
  2. `descriptionBlocks -> HTML`
  3. 原 `description -> <br>`
- 当前正式收口策略：
  - 原 `descriptionBlocks` 保留，作为结构化原始素材
  - 原 `description` 保留，作为回退输入源与排查对照基线
  - 最终发布优先使用 enrich 阶段生成的 Shopify 版介绍

**测试与验证：**
- 新增本地测试：
  - `scripts/publisher/__tests__/enrich-product.test.js`
  - `scripts/publisher/__tests__/to-csv.test.js`
- 已完成真实样本验证：
  - 样本目录：`/root/.openclaw/TKdown/2026-03-26/016`
  - enrich 后已生成 `shopifyContent.descriptionHtml`
  - 新 HTML 中 emoji 已去除
  - 图片顺序与文本块顺序保持不变
  - `product.csv` 的 `Description` 已优先使用新 HTML 输出

**意义：**
- 商品介绍不再只有“格式适配”，现已正式进入“轻改版 Shopify 化内容”阶段
- 在不打乱现有版式基础上，补齐了“标题已增强、描述未增强”的链路断点
- 保留完整回退逻辑，避免介绍增强异常时影响 Shopify CSV 主链路

## v0.3.28 (2026-03-26)

### 新增：Theme Editor 评论模板自动填写并自动绑定商品模板

**本轮新增内容：**
- `scripts/publisher/post-import-theme-setup.js` 现已打通完整后处理闭环：
  1. 从 `product.json.templateAssets.reviews` 读取 3 条评论素材
  2. 自动生成 Product 模板名 `YYYYMMDDHHmmss`
  3. 进入 Shopify Theme Editor 的 `Multicolumn`
  4. 依次点击左侧 3 个 `Column`
  5. 在右侧 `Column` 弹窗中填写：
     - `Heading` → 用户名
     - `Description` → 好评内容
  6. 点击 **iframe 内部** 的 `Save` 保存模板
  7. 点击左上角 `Exit` 退出 Theme Editor
  8. 自动进入对应商品后台编辑页
  9. 将商品右下角 `Theme template` 绑定到刚创建的模板
  10. 点击商品页顶部 `Save` 完成模板绑定保存
- Theme template 绑定逻辑已针对 Shopify 后台实际控件修正：
  - 当前商品页使用的是 `s-internal-select[label="Theme template"]`
  - 不再按普通下拉菜单可见项点击处理
  - 改为直接设置组件值并触发 `input/change` 事件，再回读确认值已切换
- 对 Shopify 验证页增加了等待与刷新处理：
  - 若商品编辑页出现 `Your connection needs to be verified before you can proceed`
  - 脚本会继续等待并自动刷新，直到真正进入商品编辑页

**真实验证结果：**
- 店铺：`vellin1122`
- 样本目录：`2026-03-26/010`
- 已成功创建并填写模板：`20260326162154`
- 已成功将商品绑定到该模板：
  - 商品 ID：`9159876346078`
  - `Theme template` 从 `Default product` 切换为 `20260326162154`
- 当前说明：
  - `评论素材 -> Theme Editor Multicolumn -> 商品 Theme template 绑定` 已完成真实闭环

**最终加固与回归补充：**
- 左侧 `Column` 的稳定打开方式已从不稳定点击，收口为：
  - 基于 `li[data-component-extra-block_type="column"]` 的 `id`
  - 定位 `button[aria-labelledby="<rowId>-label"]`
  - 先 `focus()` 再 `press('Enter')`
- 商品页 `Theme template` 最终可靠绑定方式已修正为：
  - 进入 `s-internal-select[label="Theme template"]` 的 `shadowRoot`
  - 操作内部原生 `select#select`
  - 令目标 `<option>` 真正 selected
  - 同步 `selectedIndex / select.value / host.value / 显示文本`
  - 触发 `input/change`
  - 点击商品页顶部 `Save`
- 新增了模板 option 等待逻辑，避免刚创建模板后商品页下拉列表尚未完成可见同步时误判 `option missing`
- 最终完整端到端回归成功：
  - 本轮模板：`20260326172538`
  - 3 个 Column 已自动填写：`Emily / Jason / Mia`
  - 模板已保存并退出 Theme Editor
  - 商品 `9159876346078` 已成功绑定到模板 `20260326172538`
  - 脚本日志最终结果：`🎉 模板闭环完成：已创建模板、填写 3 个 Column、保存模板，并绑定到商品`
- `scripts/publisher/import-csv-onestop.js` 已正式串接导入后模板收尾：
  - CSV 导入成功后会自动调用 `post-import-theme-setup.js`
  - 实现 `CSV 导入 -> 评论模板填写 -> 商品模板绑定` 一次跑完
- 串接后的真实主流程回归成功：
  - 命令：`node scripts/publisher/import-csv-onestop.js 2026-03-26/010 --store vellin1122`
  - 导入完成后已自动继续执行模板收尾
  - 本轮自动创建并绑定模板：`20260326173731`
  - 商品 `9159876346078` 最终已成功切到模板 `20260326173731`

**意义：**
- 评论素材不再只是留档，现已真正进入 Shopify 模板编辑自动化链路
- 商品导入后可自动把“评论模板”直接挂到对应商品，减少手工收尾
- `post-import-theme-setup.js` 已从“最小闭环”升级为“可直接落到商品”的正式流程
- `import-csv-onestop.js` 现已升级为包含导入后模板收尾的一体化正式发布链路

## v0.3.27 (2026-03-26)

### 修复：Shopify CSV 导入兼容，并将描述图统一切到 imgbb

**本轮收口内容：**
- `scripts/publisher/to-csv.js` 对齐 Shopify 官方 CSV 样例表头，不再额外输出错位的 `Body (HTML)` 列，也移除了尾部空列
- 商品介绍 HTML 现统一写入 `Description` 列，继续由 `descriptionBlocks` 渲染：
  - `type: "text"` → `<p>...</p>`
  - `type: "image"` → `<img ...>`
- 修复 Shopify 导入报错 `Inventory policy is not included in the list`：
  - `Inventory tracker = shopify`
  - `Inventory quantity = 100`
  - `Continue selling when out of stock = DENY`
- `scripts/publisher/import-csv-onestop.js` 增强失败判定：
  - 导入弹窗出现 `There was an error importing your CSV file...` 时明确判失败
  - 不再误报 `✅ 导入完成`
- 图片链路正式收口为“全部统一走 imgbb”：
  - 主图 → imgbb
  - SKU 图 → imgbb
  - 描述图 → imgbb
- `descriptionBlocks` 中的图片 URL 现会按上传返回结果替换为 imgbb 链接，不再继续使用 TikTok 详情图外链

**真实样本闭环验证：**
- 样本目录：`2026-03-26/010`
- CSV 已重新生成并通过 Shopify 导入
- 新导入商品 ID：`9159876346078`
- 前台商品页已验证：
  - 正文文本正常显示
  - 命中 `imgbb` 描述图 `6` 张
  - 描述图已真实加载（`1600 x 1600`）
- 当前说明：
  - `descriptionBlocks -> Description HTML -> Shopify CSV -> Shopify 前台` 这条链路已完成真实闭环

**意义：**
- Shopify CSV 导入兼容问题已从“无法导入”收口到“稳定可导入”
- 描述图不再依赖 TikTok 外链，正式改为可控的 imgbb 托管
- 当前发布链路已具备：标题规范化、结构化描述恢复、主图/SKU 图/描述图统一托管与真实导入验证能力

## v0.3.26 (2026-03-26)

### 新增：descriptionBlocks 导出为 Shopify Body (HTML)

**新增内容：**
- `scripts/publisher/to-csv.js` 新增 `descriptionBlocks -> Body (HTML)` 导出链路
- 导出规则保持最小化、低改写：
  - `type: "text"` → `<p>...</p>`
  - `type: "image"` → `<img ...>`
- `Body (HTML)` 当前导出优先级调整为：
  1. 优先使用 `product.descriptionBlocks`
  2. 若无 block 或渲染为空，再回退到原始 `description` 的 `<br>` 逻辑
- 新增基础 HTML 转义，避免正文中的特殊字符直接破坏 HTML 结构
- 图片标签当前使用基础安全样式：
  - `max-width:100%`
  - `height:auto`
  - `display:block`

**当前行为说明：**
- Shopify CSV 图片列（主图 / SKU 图）仍按原逻辑走 imgbb 上传
- `Body (HTML)` 中由 `descriptionBlocks` 输出的详情图，当前直接使用 block 中的原始详情图 URL
- 本轮先以“最小可用、顺序正确”为目标，不在导出阶段重写文案、不强加版式模板

**真实样本回归：**
- `2026-03-26/008`
  - `Body (HTML)` 已按 block 顺序输出：图 → 文 → 图
  - 导出结果统计：`IMG_COUNT = 10`, `P_COUNT = 5`
- `2026-03-26/009`
  - `Body (HTML)` 已按 block 顺序输出：文 → 图
  - 导出结果统计：`IMG_COUNT = 11`, `P_COUNT = 10`

**意义：**
- `descriptionBlocks` 已从“采集端结构化字段”正式接入“发布端 HTML 导出链路”
- 后续 Shopify 商品介绍恢复原始图文顺序，已有可落地的数据与导出路径

## v0.3.25 (2026-03-26)

### 修复：TikTok 商品描述区抓取收口，补全描述图并输出结构化 blocks

**本轮收口内容：**
- `scripts/collector/runner.js` 收紧商品描述提取逻辑，优先锁定 `Product description / Description / About this product` 标题后的近邻容器，不再依赖过宽 fallback 扫整页大容器
- 为描述候选新增对 `Details` 规格区的降权与拦截，避免将以下参数块误写入描述正文：
  - `Plug Type`
  - `Quantity Per Pack`
  - `Sensitive Goods Type`
  - `Warranty Type`
  - `Input Voltage(V)`
  - `Power(W)`
  - 以及其他同类规格字段
- 描述图抓取不再过度依赖 `img.naturalWidth`，改为结合 URL、节点尺寸与可见信息判断，有效补回懒加载详情图
- `product.json` 新增：
  - `descriptionBlocks`
- `descriptionBlocks` 当前按详情区 DOM 顺序输出结构化块：
  - `type: "text"`
  - `type: "image"`
- 本轮仅保留对正式产物有价值的结构字段，调试用的 `descDebug` 未纳入最终 `product.json`

**解决的问题：**
- 修复商品描述被整页噪声污染的问题（如导航、登录、推荐、评论、店铺等内容混入）
- 修复描述区误吞 `Details` 参数表的问题
- 修复原先只抓到少量描述图（如 2 张）的情况，现可更完整抓取详情图片区

**跨样本回归验证：**
- `2026-03-26/004`
  - 描述文字：697 字符
  - 描述图：7 张
  - 结构：文本组 + 图片组
- `2026-03-26/007`
  - 描述文字：1285 字符
  - 描述图：3 张
  - 结构：文本组 + 图片组
- `2026-03-26/008`
  - 描述文字：1171 字符
  - 描述图：10 张
  - 结构：图 → 文 → 图
- `2026-03-26/009`
  - 描述文字：1920 字符
  - 描述图：11 张
  - 结构：长说明文 + 多说明图

**当前结论：**
- 当前方案已可兼容多类 TikTok 商品详情结构：
  - 文本在前、图片在后
  - 图片在前/中间、文本夹在其中
  - 长说明文 + 多说明图
- 当前 `descriptionBlocks` 已可作为后续恢复 Shopify 图文说明结构的基础数据来源

## v0.3.24 (2026-03-25)

### 新增：导入后直进 Theme Editor 的最小闭环脚本

**新增内容：**
- 新增脚本：`scripts/publisher/post-import-theme-setup.js`
- 当前最小闭环职责：
  - 连接 AdsPower 浏览器
  - 基于当前 Shopify 后台页进入 Theme Editor
  - 切到 `Product`
  - 创建模板
  - 进入 `Multicolumn`
  - 成功后停住
- 当前刻意不包含：
  - `Column` 内容编辑
  - 样式设置
  - 保存发布
  - 模板分配商品
- 同步新增计划文档：
  - `docs/plans/2026-03-25-theme-editor-post-import-plan.md`
- 同步更新发布后流程文档，明确这条链路应与 CSV 导入商品流程连起来理解：
  - 导入成功并确认商品进店后，直接从当前后台上下文进入 Theme Editor

### 优化：AdsPower 浏览器复用与脚本收尾稳定性

**已验证收口：**
- `post-import-theme-setup.js` 现优先通过 `get-browser-active` 复用已活跃的 AdsPower 浏览器实例
- AdsPower 的“活跃 / 已打开”查询结果不稳定时，不再把其结果当唯一依据
- 改为在 `connectOverCDP(...)` 之后，根据真实页面上下文判定是否已命中当前 Shopify 后台 / Theme Editor
- 若虽经 `open-browser` 建立连接，但已命中现有 Shopify 页面上下文，则按“复用已有浏览器”处理，不再在脚本结束时误关当前浏览器
- 已修复脚本成功后偶发不退出的问题：当前成功路径会正常结束并返回 `code 0`

**实跑验证：**
- 已验证可直接复用当前 Theme Editor 上下文继续执行
- 已验证最小闭环完整跑通并正常退出：
  - 命中当前后台页
  - 切到 `Product`
  - 创建模板
  - 进入 `Multicolumn`
  - 进程正常退出

## v0.3.23 (2026-03-25)

### 文档：新增 Shopify 发布后操作流程记录

**新增内容：**
- 新增文档：`docs/shopify-post-publish-steps.md`
- 用于持续记录“商品发布完成后”的 Shopify 后台操作步骤
- 当前已沉淀的内容包括：
  - 打开 AdsPower
  - 新标签页打开 Shopify Admin
  - 左侧 `Online Store` 的正确点击方式
  - 主题页右侧主体位于 iframe 的关键结论
  - 进入 `Edit theme` / 主题编辑器的当前稳定方案
- 目的：先把人工带跑步骤沉淀清楚，再逐步提炼成自动化脚本

## v0.3.22 (2026-03-25)

### 调整：全局关闭 Shopify CSV 库存跟踪字段

**调整内容：**
- `to-csv.js` 导出 Shopify CSV 时，全局关闭库存跟踪相关字段
- 以下列统一改为空值：
  - `Inventory tracker`
  - `Inventory quantity`
  - `Continue selling when out of stock`
- 这样导入后将不再通过 CSV 显式开启 Shopify 库存跟踪，也不再写死默认库存 `100`

## v0.3.21 (2026-03-25)

### 修复：SKU 规格解析通用兼容横杠词组

**修复内容：**
- `to-csv.js` 重构 `parseSkuName()` 的通用解析策略，避免把正常词组中的横杠误当成规格分隔符
- 新增对以下常见词组的保护，不再错误拆分：
  - `two-in-one`
  - `4-in-1` / `2-in-1`
  - `usb-c`
  - `type-c`
  - `c-c`
- 仅在出现高置信度分隔格式（如 `A - B`）时才按横杠拆分
- 对无法稳定拆分的 SKU，改为宁可少拆也不拆错，避免导出错误规格值

**回归验证：**
- `2026-03-25/004`（镜子商品）规格拆分保持正确
- `2026-03-25/005`（数据线商品）不再出现 `two-in | one` 这类错误拆分

## v0.3.20 (2026-03-25)

### 修复：Shopify 商品介绍同步写入 Body (HTML)

**修复内容：**
- `to-csv.js` 生成 Shopify CSV 时，除保留 `Description` 列外，新增同时写入 `Body (HTML)` 列
- 将采集到的商品描述正文按 HTML 换行格式写入 `Body (HTML)`，提高新版 Shopify 后台对商品介绍字段的识别与覆盖成功率
- 用于解决 CSV 中本地已有描述内容，但 Shopify 后台商品介绍仍不显示的问题

## v0.3.19 (2026-03-25)

### 修复：按 sectionHeader 标题块区分商品描述与商品详情

**修复内容：**
- `runner.js` 描述提取逻辑新增基于 `sectionHeader-mTOhOt clickable-Q3abyt` 标题块的识别方式
- 不再只靠外层容器猜测描述区，而是先识别标题文字：
  - `Product description / Description / About this product` → 作为商品描述来源
  - `Details` → 视为商品详情参数块，排除出描述正文
- 同结构 `div` 的情况下，改为依据标题文本和内容文本做判定，避免把参数表误写进 Shopify 描述，也避免把描述整段过滤成空

## v0.3.18 (2026-03-25)

### 修复：商品描述与商品详情参数分离

**修复内容：**
- `runner.js` 的描述提取逻辑不再把 `Details` 参数表直接当成商品描述
- 优先提取 `Product description / About this product / Description` 的正文内容
- 当页面只有参数表而没有真正描述文案时，描述字段宁可留空，也不再把参数项错误写入 Shopify 商品描述
- 遇到 `Plug Type / Region Of Origin / Net Weight / Quantity Per Pack` 等参数项时，会在描述提取中自动截断或跳过

## v0.3.17 (2026-03-25)

### 修复：多变体商品按变体名动态拆分规格值

**修复内容：**
- `to-csv.js` 优化 `parseSkuName()`，新增对数量前置/后置格式的解析：
  - `1 Count Pink` → `Color=Pink`, `Specification=1 Count`
  - `Pink + black + white 3 Counts` → `Color=Pink + black + white`, `Specification=3 Counts`
- 多变体商品导出时，不再错误复用 `product.options` 的静态默认值到所有行
- 改为按每个变体的 `variant.name` 动态拆分并生成对应的 `Option1/Option2`
- 当同一商品存在数量型变体而某些行未显式带数量时，自动补全为 `1 Count`

**验证结果：**
- `2026-03-25/002` 的 14 个变体已正确拆分为各自独立规格值
- 不再出现 14 行 CSV 全部写成同一组 `Color/Specification` 的错误

## v0.3.16 (2026-03-25)

### 修复：TikTok 商品描述污染与单变体规格丢失

**修复内容：**
- `runner.js` 新增已选规格提取逻辑，能抓取 `Color`、`Specification` 等当前商品规格值
- `runner.js` 优化描述提取，限制从商品描述区起始位置截取，并在推荐商品、店铺信息、物流与保障等区块前停止，避免把整页导航、评论、猜你喜欢混进描述
- `runner.js` 在 `product.json` 中新增 `options` 字段，保留结构化规格信息
- `to-csv.js` 新增从 `product.options` 生成 Shopify 选项列的能力
- 单变体商品现在也会正确输出 `Option1/Option2`，避免规格丢失导致 SKU/属性展示异常

**验证结果：**
- 重采 `1731773758990553652` 后，已正确抓到：`Color=Green`、`Specification=2 pack`
- 新生成的 CSV 已正确输出：
  - `Option1 name = Color`
  - `Option1 value = Green`
  - `Option2 name = Specification`
  - `Option2 value = 2 pack`
- 描述字段已不再包含导航、评论区、店铺信息、猜你喜欢等整页噪音

## v0.3.15 (2026-03-25)

### 优化：发布脚本默认读取全局配置中的图床密钥

**优化内容：**
- `to-csv.js` 新增从 `/root/.openclaw/openclaw.json` 的 `env.IMGBB_API_KEY` 读取图床密钥
- `import-csv-onestop.js` 新增从 `/root/.openclaw/openclaw.json` 的 `env.IMGBB_API_KEY` 读取图床密钥
- 保持运行时环境变量优先级更高；若命令行显式传入 `IMGBB_API_KEY`，仍优先使用显式值
- 这样后续发布商品时，不再需要每次手动在命令前拼接图床密钥

## v0.3.14 (2026-03-25)

### 修复：兼容 Shopify 新版商品导入弹窗直传流程

**修复内容：**
- `import-csv-onestop.js` 不再假设导入弹窗一定是“选模式 → 下一步 → 上传文件”的旧流程
- 新增对新版直传弹窗的识别：弹窗中直接出现“添加文件 / 上传并预览”时，跳过旧版步骤
- 上传 CSV 时增加双通路：
  - 优先直接命中 `input[type="file"]`
  - 兜底通过“添加文件”按钮触发文件选择器
- 预览确认按钮兼容中英文文本识别
- 已验证脚本可成功进入新版 Shopify 导入弹窗并完成 CSV 上传与预校验

## v0.3.13 (2026-03-24)

### 修复：商品介绍区需二次点击“查看更多”时，完整描述与描述图采集不中断

**修复内容：**
- `runner.js` 的描述采集逻辑改为两阶段展开：
  - 先点击 `Description / Details / About this product`
  - 再单独点击 `查看更多 / See more / Show more`
- 针对用户提供的 `span` 样式做优先匹配：
  - `Headline-Semibold`
  - `text-color-UIText1`
  - `background-color-UIShapeNeutral4`
  - `px-24`
  - `py-13`
- 同时增加兜底逻辑：
  - 只看文案匹配
  - 只看样式匹配
- 描述容器提取改为多候选块中选取文本最长者，提升完整描述命中率
- 已用 `/037` 样例验证通过：
  - `📝 查看更多: ✅ text`
  - `描述文字: 7874 字符`
  - `描述图片: 24 张`

## v0.3.12 (2026-03-24)

### 修复：import-csv-onestop.js 显式进入目标 Shopify 店铺后台

**修复内容：**
- `stores.json` 新增 `shopifySlug` 字段，用于明确指定 Shopify 后台店铺路径
- `import-csv-onestop.js` 改为优先读取 `store.shopifySlug`，并回退到 `storeId/name`
- 导入前不再打开通用 `https://admin.shopify.com/products`
- 改为显式进入：`https://admin.shopify.com/store/${slug}/products`
- 修复已传 `--store vellin1122` 却实际跳到其他店铺（如 `a13xn8-v5`）的问题

## v0.3.11 (2026-03-24)

### 验证：正式链路补齐单 SKU 商品导入验证

**验证结果：**
- 新增 `/035` 样例验证：单 SKU 商品也可成功走通正式链路
- `product.json` 顶层 `variants` 在单 SKU 场景下正常落为 1 个变体
- `to-csv.js` 生成的单 SKU CSV 仅输出 1 行，`Option1 name/value` 为空
- Shopify 预览页识别结果为：`约 1 个产品 / 1 个 SKU / 1 张图片`
- Shopify 导入后产品列表数量从 `48` 变为 `49`
- 由此确认当前正式链路已同时覆盖：
  - 单 SKU 商品
  - 多变体商品

## v0.3.10 (2026-03-24)

### 整理：待删除旧文件先迁入 `bak/`，并同步更新入口文档

**整理内容：**
- 先不直接删除旧文件，改为迁入 `bak/` 目录观察是否影响主链路
- 本次迁入 `bak/` 的文件包括：
  - `._项目分析报告.md`
  - `项目分析报告.md`
  - `scripts/collector/._runner.js`
  - `scripts/publisher/upload-images.js`
  - `scripts/publisher/upload-to-imgur.js`
- 更新 `SKILL.md`，将入口说明切换到当前正式链路：
  - `runner.js`
  - `to-csv.js`
  - `import-csv-onestop.js`
- 标明 `upload-product.js` 为旧的人肉模拟填表方案，不再作为正式优先链路

## v0.3.9 (2026-03-24)

### 文档：沉淀正式发布流程并纠正文档中的旧链路说明

**文档更新：**
- 新增 `references/publish-workflow.md`，明确 TikTok → `product.json` → `product.csv` → imgbb → Shopify Import 的正式发布流程
- 记录当前正式数据结构、执行顺序、核验方式与已知限制
- 更新 `references/README.md`：
  - 将 `product.json` 示例改为正式 `variants` 结构
  - 将发布流程切换为 `to-csv.js + import-csv-onestop.js`
  - 标明 `upload-product.js` 属于旧的人肉模拟填表方案，不再是优先正式链路
  - 去掉已过时的本地锁文件说明，改为以 AdsPower 浏览器状态为准

## v0.3.8 (2026-03-24)

### 收尾：import-csv-onestop.js 去硬编码密钥并修复多行 CSV 解析

**收尾内容：**
- 删除 `import-csv-onestop.js` 中写死的 `imgbb` 密钥，改为只从运行时环境变量 `IMGBB_API_KEY` 读取
- 当脚本确实需要上传本地图片但未提供 `IMGBB_API_KEY` 时，给出明确报错
- 修复 `parseCSV()` 对带引号多行描述的处理，避免 `split('\n')` 导致商品数量统计失真
- 让导入脚本对 `/034/product.csv` 这类包含多行 `Description` 的 Shopify CSV 解析更稳

## v0.3.7 (2026-03-24)

### 修复：首个变体补写 `Variant image URL`

**修复内容：**
- 多变体商品首行在承载首个变体时，补写对应的 `Variant image URL`
- 避免 Shopify 只识别主图、不把首个变体标记为“图片已应用”
- 继续保持首行即首个变体的 Shopify 多变体导入结构

## v0.3.6 (2026-03-24)

### 调整：to-csv.js 改为首行即首个变体，贴近 Shopify 多变体模板

**调整内容：**
- 多变体商品不再输出“无 SKU 的父产品行 + 全量变体行”
- 改为首行直接承载第一个变体的数据
- 后续行只输出剩余变体，整体更贴近 Shopify 官方多变体 CSV 示例
- 首行同时保留产品级信息，并带上首个变体的 SKU / 价格 / 选项值
- 首行补充对应的变体图字段，降低 Shopify 将其误判为独立产品的概率

## v0.3.5 (2026-03-24)

### 增强：import-csv-onestop.js 抓取 Shopify 导入回执文本

**增强内容：**
- 补充导入弹窗在上传后、预览页、导入后的关键文本抓取
- 增加页面横幅、提示条、残留弹窗文本的日志输出
- 增加导入后页面摘要日志，便于判断 Shopify 是否真正接受导入
- 让“按钮点完但结果不明”的情况更容易排查

## v0.3.4 (2026-03-24)

### 修复：import-csv-onestop.js 兼容直接导入现成的 `product.csv`

**修复内容：**
- 当 CSV 中没有本地图片需要上传时，不再强制查找不存在的 `product-imgbb.csv`
- 导入脚本改为直接使用现成的 `product.csv`
- 只有在确实发生本地图上传与路径替换后，才生成并使用 `product-imgbb.csv`
- 补充日志输出当前实际导入文件路径，便于排查

## v0.3.3 (2026-03-24)

### 调整：to-csv.js 按 Shopify 官方模板收紧变体结构

**调整内容：**
- 多变体商品的变体行重复写入同一个 `URL handle`
- 单维变体商品只保留一个选项列
- `Option1 name` 改为更正式的 `Color`
- 移除不适合当前商品的 `Port` 选项占位
- 让 CSV 结构更贴近 Shopify 官方模板示例

## v0.3.2 (2026-03-24)

### 新增：to-csv.js 支持使用 imgbb 图床生成图片外链

**新增内容：**
- `to-csv.js` 支持通过运行时环境变量 `IMGBB_API_KEY` 上传图片到 imgbb
- 主图和变体图都会优先写入图床外链，不再使用本地路径或裸文件名
- 在商品目录下缓存 `imgbb-urls.json`，避免重复上传相同图片
- `Variant image URL` 改为正式输出可访问外链
- 修复 CSV 行数统计，改为按真实记录数统计

## v0.3.1 (2026-03-24)

### 调整：正式收口到 `variants`，移除 `_meta.skus`

**调整内容：**
- `to-csv.js` 改为正式读取 `product.variants`
- 不再依赖 `_meta.skus`
- 主产品行的选项值改为取第一个变体的值，便于后续导入链路对齐
- 变体行的价格、划线价、SKU、变体图都从 `variants` 读取
- `runner.js` 删除 `_meta.skus`
- `_meta` 只保留真正的采集元信息：`productId`、`seq`、`sourceUrl`、`source`、`extractedAt`

## v0.3.0 (2026-03-24)

### 新增：runner.js 正式输出 `variants` 字段

**新增内容：**
- `product.json` 新增 `variants` 数组
- 每个变体包含：
  - `name`
  - `sku`
  - `price`
  - `compareAtPrice`
  - `image`
  - `thumbnail`
  - `detail`
- 保留原有 `_meta.skus` 不动，兼容现有 `to-csv.js` 和旧流程
- 这样后续可以逐步把 CSV / 发布流程切到 `variants`，不用一次性打断旧链路

## v0.2.9 (2026-03-24)

### 调整：runner.js 去掉本地文件锁，改为以 AdsPower 浏览器状态为准

**调整原因：**
- `/tmp/tk2shop-locks/*.lock` 是本地自建状态，容易和 AdsPower 真实占用状态不一致
- 浏览器已经关闭，但锁文件残留时，会造成“明明空闲却被脚本锁住”的假冲突
- 当前流程更适合直接以 AdsPower 的打开/关闭状态作为唯一占用依据

**调整内容：**
- 删除 `acquireLock()` / `releaseLock()` / `LOCK_DIR`
- 不再创建或依赖 `/tmp/tk2shop-locks/*`
- 成功时：关闭本次浏览器并调用 `closeBrowser(profileNo)`，直接释放 AdsPower 占用
- 失败时：同样关闭浏览器，避免 profile 残留占用
- 保持“新建任务 tab 执行采集”的流程不变

## v0.2.8 (2026-03-24)

### 修复：runner.js 收尾时误用 `browser.disconnect()` 导致报错

**问题根因：**
- `chromium.connectOverCDP()` 返回的 `browser` 对象在当前环境下没有 `disconnect()` 方法
- 改成“保留浏览器”后，收尾调用 `browser.disconnect()`，导致任务最后一步报错

**修复内容：**
- 移除 `browser.disconnect()` 调用
- 成功时只关闭本次新建的 Tab，然后直接结束进程
- 异常时也只关闭本次新建的 Tab，不再做错误的断开调用
- 保持“保留旧Tab、保留整个浏览器”的新流程不变

## v0.2.7 (2026-03-24)

### 修复：runner.js 不再关闭旧标签页和整个 AdsPower 浏览器

**问题根因：**
- AdsPower 打开后本身可能自带启动页和历史页
- `runner.js` 连接后又 `newPage()`，然后把旧页全关掉
- 任务结束时还会关闭整个浏览器，导致看起来像“先关旧的，再重开一个新的”

**修复内容：**
- 连接 CDP 后只新建本次任务自己的 Tab
- 不再关闭任何旧标签页
- 任务完成后只关闭本次新建的 Tab
- 收尾时只 `disconnect`，不再 `closeBrowser(profileNo)`
- 异常时也只清理本次新建的 Tab，不误伤已有浏览器会话

## v0.2.6 (2026-03-24)

### 修复：runner.js 采集空数据时误判成功并秒退关闭浏览器

**问题根因：**
- 页面虽然打开了，但实际未加载出商品内容时，`extract()` 仍返回空标题/空图片/空SKU
- 主流程没有把“空采集结果”当作异常，导致脚本直接走成功分支
- 于是浏览器看起来像“几秒就自己关闭了”，其实是采空后正常收尾

**修复内容：**
- 新增 `inspectPageState()`：检查当前页面标题、正文长度、图片数、商品提示词、验证码/风控特征
- 新增 `hasMeaningfulProductData()`：判断采集结果是否真正拿到商品内容
- 新增 `waitForPageRecovery()`：当页面是验证码、风控页、空壳页或异常页时，继续等待最多10分钟，不再立刻当成功
- `extract()` 在采集结果为空时会先判断页面状态：
  - 若像验证码/风控/空页面 → 进入等待恢复逻辑
  - 若页面异常但始终恢复不了 → 抛错退出，不再生成“空成功”结果
- 保留原有“验证码最多等待10分钟”策略，不缩短

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

### 改进：runner.js hold 模式支持检测浏览器关闭

- 等待循环同时检测文件信号和浏览器窗口状态
- 浏览器被外部关闭时自动退出等待，避免脚本卡死

### 修复：runner.js 和 to-csv.js CSV导入Shopify报错修复

- runner.js: product.json保存时加上variants数据（之前只有title/description/price/images）
- to-csv.js: 适配product.variants字段（之前用的是_meta.skus）
- to-csv.js: 主产品行Option1/2 value填第一个变体的值
- to-csv.js: Option2 Linked To填product.metafields.shopify.color-pattern

### 修复：import-csv-onestop.js openBrowser execSync 语法错误

- 改用 spawn 异步调用 adspower-browser，避免 shell 引号转义问题

- 加 `{"tiktokUrl":"url","hold":true}` 参数后，采集完成不关浏览器，写文件 `/tmp/tk2shop-hold-{pid}.ready`，用户执行 `echo done > /tmp/tk2shop-hold-{pid}.ready` 确认后继续关闭

### 修复：runner.js CDP连接稳定性

- 移除 `isProfileActive` 检测（返回的 debug_port 无法被 Playwright 使用）
- `openBrowser` 直接调用 `open-browser`，获取正确的 CDP WebSocket URL
- `open-browser` 后等待3秒再连接CDP（避免Chrome未完全启动导致连接失败）

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

### 新增/修复：import-csv-onestop.js 配置外部化和CDP逻辑对齐

**修复内容：**
- 配置外部化：`PROFILE_NO` 从 `config/stores.json` 读取，支持 `--store` 参数
- URL 改为 `https://admin.shopify.com`（不再拼接 store slug）
- CDP 逻辑对齐：改用 `openBrowser()` 返回 `{cdpUrl, isNew}`，与 `upload-product.js` 一致
- CLI：`node import-csv-onestop.js <商品目录> --store <店铺ID>`
- 修复：点击"上传 Shopify 格式的 CSV 文件"文字选择CSV模式（原选择器不稳定）
- 清理：新建 Tab 前关闭已有 Tab，按 `isNew` 策略清理
- `stores.json` 更新：添加 vellin1122 店铺配置（profileNo: 1896325）

### 改进：runner.js hold 模式支持检测浏览器关闭

- 等待循环同时检测文件信号和浏览器窗口状态
- 浏览器被外部关闭时自动退出等待，避免脚本卡死

### 修复：runner.js 和 to-csv.js CSV导入Shopify报错修复

- runner.js: product.json保存时加上variants数据（之前只有title/description/price/images）
- to-csv.js: 适配product.variants字段（之前用的是_meta.skus）
- to-csv.js: 主产品行Option1/2 value填第一个变体的值
- to-csv.js: Option2 Linked To填product.metafields.shopify.color-pattern

### 修复：import-csv-onestop.js openBrowser execSync 语法错误

- 改用 spawn 异步调用 adspower-browser，避免 shell 引号转义问题

- 加 `{"tiktokUrl":"url","hold":true}` 参数后，采集完成不关浏览器，写文件 `/tmp/tk2shop-hold-{pid}.ready`，用户执行 `echo done > /tmp/tk2shop-hold-{pid}.ready` 确认后继续关闭

### 修复：runner.js CDP连接稳定性

- 移除 `isProfileActive` 检测（返回的 debug_port 无法被 Playwright 使用）
- `openBrowser` 直接调用 `open-browser`，获取正确的 CDP WebSocket URL
- `open-browser` 后等待3秒再连接CDP（避免Chrome未完全启动导致连接失败）

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

## v0.3.30 (2026-03-26)

### 新增：发布总入口脚本（A 方案）

**新增脚本：**
- `scripts/publisher/publish-product.js`

**定位：**
- 作为“已有商品目录 → CSV → Shopify 导入 → 模板收尾”的统一发布入口
- 只做编排，不重复实现底层导出/导入/模板逻辑，避免链路分叉

**当前能力：**
- 校验商品目录与 `product.json`
- 调用 `to-csv.js` 生成 `product.csv`
- 调用 `import-csv-onestop.js` 执行 Shopify 导入
- 由导入脚本继续串接 `post-import-theme-setup.js` 完成评论模板填写与商品模板绑定

**CLI：**
- `node publish-product.js <商品目录> --store <店铺ID>`
- 可选参数：
  - `--skip-csv`
  - `--csv-only`
  - `--help` / `-h`

**验证：**
- 已通过语法检查：`node --check scripts/publisher/publish-product.js`
- 已通过帮助命令检查：`node scripts/publisher/publish-product.js --help`
- 已在真实样本上作为正式发布入口完成闭环调用

## v0.3.30 (2026-03-26)

### 修复：TikTok 商品页已打开但 `domcontentloaded` 超时导致采集误判失败

**采集入口等待策略（已修通）：**
- `scripts/collector/runner.js` 新增 `isUsableProductPage(state)`，不再只依赖 `page.goto(..., waitUntil: 'domcontentloaded')` 作为唯一成功条件
- 新增 `openProductPage(page, tiktokUrl)`：当 `domcontentloaded` 超时但页面其实已打开时，会继续检查商品页可用状态，而不是直接抛错退出
- 商品页可用判定当前基于以下任一条件：
  - 存在 `meta[property="og:title"]`
  - 页面正文已出现 `About this product` / `Product description` / `Sold by` / `Details` 等商品页提示
  - 页面图片数足够
  - 页面正文长度足够
- `waitForPageRecovery(...)` 也已改为复用同一套可用判定，恢复后不再死等 `domcontentloaded`

**真实回归（已打通）：**
- 新样本目录：`/root/.openclaw/TKdown/2026-03-26/013`
- TikTok 商品 ID：`1729412357214802850`
- 真实现象：浏览器肉眼可见商品页已打开，但旧逻辑仍因 `domcontentloaded` 30 秒超时而误判失败并关闭页面
- 修复后成功完成采集：
  - 主图 `9`
  - 描述图 `9`
  - `descriptionBlocks = 17`
  - 评论 `3`
- 后续真实闭环结果：
  - Shopify 新商品 ID：`9160714944734`
  - 模板名：`20260326222709`
  - 已完成“采集 → CSV → Shopify 导入 → Theme Editor 填写 3 条评论 → 保存模板 → 绑定商品”完整链路


### 加固：发布总入口后半段稳定性

**导入后商品识别链路（已修通）：**
- `import-csv-onestop.js` 导入完成后，会从 Shopify Products 列表中提取本次新导入商品 ID
- 提取结果已接入并传递给 `post-import-theme-setup.js`
- `post-import-theme-setup.js` 新增 `--product-id` 参数，绑定模板时优先使用明确的 Shopify 商品 ID，不再回落到历史商品

**AdsPower / CDP 恢复（已加固）：**
- 修复导入结束后复用失效 `ws://...` 触发 `ECONNREFUSED` 直接失败的问题
- 新增 CDP 健康校验：拿到候选 ws 后先测试 `connectOverCDP`，通过后再进入正式流程
- 若候选 ws 不可用，会自动等待并重试，避免 `open-browser` 短时间返回旧失效地址时误判成功

**Shopify Themes / Theme Editor（已加固）：**
- `openEditorAndGetFrame()` 已兼容 `Your connection needs to be verified before you can proceed` 验证页，命中后继续等待自动放行
- Themes 页主体 iframe 识别已从“只看 URL”扩展为“URL + frame 文本 + empty-url/延迟挂载 iframe”联合判定
- 修复进入 `https://admin.shopify.com/store/<slug>/themes` 后 frame URL 为空、但主体已加载时无法识别的问题

**真实回归：**
- 新样本：`/root/.openclaw/TKdown/2026-03-26/012`
- TikTok 商品 ID：`1731331424713282252`
- Shopify 新商品 ID：`9160389263582`
- 本轮模板：`20260326184712`
- 真实结果：已完成“采集 → CSV → Shopify 导入 → 识别本次新商品 → Theme Editor 填 3 条评论 → 保存模板 → 绑定到新商品”完整闭环
- 最终绑定成功：商品 `9160389263582` → 模板 `20260326184712`


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
