# tk2shop 详细文档

## 目录

1. [采集流程](#采集流程)
2. [DOM 选择器](#dom-选择器)
3. [product.json 格式](#productjson-格式)
4. [踩坑记录](#踩坑记录)
5. [发布流程](#发布流程)
6. [并发采集](#并发采集)
7. [正式发布流程文档](#正式发布流程文档)

---

## 采集流程

### 单次采集（runner.js）

自动完成：开浏览器 → 导航 → 采集 → 下载图片 → 生成 JSON → 关浏览器

```bash
node scripts/collector/runner.js '{"tiktokUrl": "https://shop.tiktok.com/us/pdp/商品slug/商品ID"}'
```

或通过环境变量：
```bash
TK_TIKTOK_URL="https://shop.tiktok.com/..." node scripts/collector/runner.js
```

### URL 格式

正确格式：`https://shop.tiktok.com/us/pdp/[slug]/[product-id]`

示例：
```
https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574
```

商品 ID 在 URL 最后一个斜杠后面。

---

## DOM 选择器

| 目标 | 选择器 | 说明 |
|------|--------|------|
| 主图区 | `[class*="items-center"][class*="gap-12"][class*="overflow-visible"]` | 横向轮播容器 |
| SKU 选项 | `[class*="flex-row"][class*="flex-wrap"]` | 每个子 div 是颜色/规格变体 |
| 展开按钮 | `span.Headline-Semibold` | 点击后出现完整介绍 |
| 完整介绍 | `[class*="overflow-hidden"][class*="transition-all"]` | 点击展开按钮后出现 |
| 标题 | `meta[property="og:title"]` | 最准确，避免 Coupon center 干扰 |

---

## product.json 格式

```json
{
  "title": "商品标题",
  "description": "商品介绍（点击展开后的内容）",
  "price": "18.50",
  "compareAtPrice": "34.98",
  "sku": "TK-商品ID",
  "status": "active",
  "images": ["001.jpg", "002.jpg"],
  "descriptionImages": ["desc_001.jpeg"],
  "variants": [
    {
      "name": "2 PCS-iPhone",
      "sku": "TK-商品ID-01",
      "price": "15.80",
      "compareAtPrice": "29.99",
      "image": "sku_03_2 PCS-iPhone.jpg",
      "thumbnail": "sku_03_2 PCS-iPhone.jpg",
      "detail": ""
    }
  ],
  "_meta": {
    "productId": "商品ID",
    "source": "tiktok-shop-detail",
    "extractedAt": "2026-03-23T10:00:00+08:00"
  }
}
```

> 说明：`variants` 是当前正式变体结构；`_meta.skus` 已废弃，不再作为正式发布链路输入。

---

## 踩坑记录

### 1. 选择器用错混入大量无关图片
❌ 错误：`[class*="overflow-x-auto"]` — 会匹配评论区、导航栏等  
✅ 正确：精准组合选择器

### 2. TikTok 新版不走 API 接口
❌ 错误：拦截 `/api/product/detail`  
✅ 正确：改用 DOM 提取

### 3. 标题要排除干扰元素
❌ 错误：直接取第一个 h2（可能是 "Coupon center"）  
✅ 正确：用 `meta[property="og:title"]`

### 4. 价格在商品详情区，不是全页 DOM
❌ 错误：遍历全页找 `$` 导致混入其他商品价格  
✅ 正确：先点击 SKU，再在商品详情区查找

### 5. 描述区图片必须在特定位置提取
1. `window.scrollTo(0, 0)` — 先回到顶部
2. 等待商品数据渲染
3. 点击 Description/Details 展开按钮
4. 立即提取 `[class*="overflow-hidden"][class*="transition-all"]` 内的 `<img>` 标签
5. 如果提取偏晚，图片可能随页面滚动被销毁

### 6. CDN 图片 URL 清理

TikTok CDN 图片格式：`~tplv-xxx-crop-webp:800:1190.webp`  
清理为原始分辨率：`~tplv-xxx-origin.webp`

```javascript
function cleanDescImgUrl(url) {
  return url
    .replace(/~tplv-([a-z0-9]+)-crop-webp:\d+:\d+\.webp/gi, '~tplv-$1-origin.webp')
    .replace(/~tplv-([a-z0-9]+)-crop-jpeg:\d+:\d+\.jpeg/gi, '~tplv-$1-origin.jpeg')
    .replace(/~tplv-([a-z0-9]+)-crop-jpg:\d+:\d+\.jpg/gi, '~tplv-$1-origin.jpg')
    .replace(/~tplv-([a-z0-9]+)-resize-png:\d+:\d+\.png/gi, '~tplv-$1-origin.png');
}
```

### 7. 划线价从 items-baseline 容器提取

TikTok 页面价格分段显示：`-47%\n$\n15\n.80\n$29.99`

需拼接处理：`$15.80`（现价）和 `$29.99`（划线价）

---

## 发布流程

### 当前正式发布方式

当前正式链路优先使用：

1. `scripts/publisher/to-csv.js`
2. `scripts/publisher/import-csv-onestop.js`

也就是：
- 先把 `product.json` 转成 Shopify `product.csv`
- 再通过 Shopify CSV Import 完成导入

正式流程文档见：[`publish-workflow.md`](./publish-workflow.md)

### 前提条件

- AdsPower 浏览器可正常打开目标 Shopify 店铺 admin
- 该店铺已在 `config/stores.json` 中配置
- 如需把本地图片上传为外链，运行时提供 `IMGBB_API_KEY`

### 生成 CSV

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/to-csv.js 2026-03-23/001 --store vellin1122
```

### CSV 导入 Shopify

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/import-csv-onestop.js 2026-03-23/001 --store vellin1122
```

### 旧方式说明

`upload-product.js` 仍可作为旧的人肉模拟填表方案参考，但**当前正式链路不再优先依赖它**。

---

## 并发采集

### 命令

```bash
# 单个 URL
node scripts/collector/spawn.js "https://shop.tiktok.com/us/pdp/..."

# 多个 URL 并发
node scripts/collector/spawn.js "url1" "url2" "url3" --parallel 3

# 从文件读取 URL 列表
node scripts/collector/spawn.js --file urls.txt --parallel 5
```

### 并发安全

当前并发安全机制已调整为：
- **不再依赖本地锁文件**
- 以 AdsPower 浏览器真实运行状态为准
- `runner.js` 会优先选择空闲 profile
- 如果 profile 已运行，会优先尝试复用或重新拉起

### 预检机制

启动时会读取 `profile-pool.json` 中的配置与输出目录；如缺少 `outputDir` 或 `profiles`，脚本会直接报错退出。

---

## 输出目录

```
/root/.openclaw/TKdown/YYYY-MM-DD/001/
├── product.json
├── images/
│   ├── 001.jpg ~ 009.jpg    ← 主图
│   ├── sku_01_xxx.jpg       ← SKU 缩略图
│   └── desc_001.jpeg        ← 描述图
└── sku/                     ← SKU 图片副本
```

序号自动递增：001, 002, 003...
