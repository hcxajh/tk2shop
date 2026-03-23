# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.3.0] - 2026-03-23

### 新增
- **runner.js**：自动采集子代理，全流程（开浏览器→导航→采集→下载→关浏览器）无人值守
- **spawn.js**：并发启动器，支持多URL并发、文件导入URL列表、结果汇总
- **profile-pool.json**：配置文件池，供子代理自动选择空闲 profile

### 修复
- URL 正则修复：从 `/\/(\d+)\?/` 改为 `/\/(\d+)(?:\?.*)?$/`，正确提取商品ID
- CDP URL 解析：从 `ws.puppeteer:` 行提取 WebSocket URL
- 浏览器打开命令 JSON 格式确认：`{"profileNo":"1896381"}`

### 优化
- **划线价（compareAtPrice）采集**：从 `items-baseline` 容器提取现价+划线价，处理 TikTok 分段文本（`$\n15\n.80\n$29.99`）
- **cleanDescImgUrl**：删除泛化 replace 规则，避免误匹配
- **并发安全**：文件锁机制，防止多进程抢同一 profile
- **并发预检**：启动时自动过滤不存在的 profile 编号

## [1.2.0] - 2026-03-21

### 新增
- **descriptionAi 字段**：调用 MiniMax AI 根据原始描述重新生成 Shopify 风格营销型产品介绍
- 营销风格，面向欧美市场，突出卖点和使用场景
- HTML 结构：`<h2>` 标题 + `<p>` 段落 + `<ul><li>` 列表 + `<img>` 图片
- descriptionHtml 保留格式优化版，descriptionAi 为 AI 重写版，两字段独立

### 优化
- descriptionHtml 全面升级为 Shopify 风格：自动识别标题、列表项、段落，合理插入图片
- 内容主体完全保留，只调格式（不做内容改写）
- 标题识别：全大写、短句冒号结尾、常见标题词（Features/Specifications/Price等）
- 列表识别：自动归并连续列表项为 `<ul><li>` 结构
- 图片插入：每3段自动插入一张描述图，保持图文均衡排版

## [1.1.0] - 2026-03-20

### 修复
- 修复 descriptionImages 始终为空的问题：描述区图片需在页面顶部位置点击 Description 展开按钮后提取
- 修复描述区图文混排丢失：新增 descriptionHtml 字段，以 HTML 格式存储图文混排内容，图片 src 已替换为本地文件名
- 修复 URL 替换失败问题：从 HTML 中直接提取 img src 下载，保证下载 URL 与 HTML 中 URL 一致

### 新增
- 自动序号递增：每次采集创建新文件夹（001→002→003...）
- descriptionHtml 字段：图文混排 HTML（含 `<img src="desc-images/desc_001.jpg">` 等本地图片引用）
- descriptionImages 字段：描述图文件名列表（含 `desc-images/` 前缀）
- 描述图独立目录：描述图统一放到 `desc-images/` 子文件夹，与主图 `images/` 分离
- 从 HTML img src/srcset 自动识别最高分辨率版本下载

## [1.0.0] - 2026-03-19

### 新增
- 初始版本 - TikTok Shop 商品采集脚本
- 支持商品标题、价格（每个 SKU 单独提取）、主图、SKU 变体、缩略图、商品描述提取
- 图片串行下载，失败自动重试 3 次
- 自动序号递增（001, 002, 003...）
- product.json 格式兼容 Shopify 上传

### 踩坑记录
- TikTok 新版不走 `/api/product/detail` 接口，改用 DOM 提取
- 选择器 `items-center + gap-12 + overflow-visible` 精准锁定主图（避免混入29张无关图片）
- 价格限定在标题父容器内查找，避免全页 DOM 混入其他价格
- 详情改为点击展开后提取（不用 meta 广告语）
- 标题使用 `meta[property="og:title"]`（避免取到 Coupon center 等干扰项）
