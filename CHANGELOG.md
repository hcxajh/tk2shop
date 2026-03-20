# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
