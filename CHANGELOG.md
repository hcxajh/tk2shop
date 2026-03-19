# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
