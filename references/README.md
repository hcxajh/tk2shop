# tk2shop 详细文档

## 目录

1. [采集流程](#采集流程)
2. [DOM 选择器](#dom-选择器)
3. [product.json 格式](#productjson-格式)
4. [踩坑记录](#踩坑记录)
5. [发布流程](#发布流程)
6. [并发采集](#并发采集)

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
  "images": ["001.jpg", "002.jpg", ...],
  "descriptionImages": ["desc_001.jpeg", ...],
  "_meta": {
    "productId": "商品ID",
    "source": "tiktok-shop-detail",
    "extractedAt": "2026-03-23T10:00:00+08:00",
    "skus": [
      {
        "name": "2 PCS-iPhone",
        "price": "15.80",
        "compareAtPrice": "29.99",
        "thumbnail": "sku_03_2 PCS-iPhone.jpg",
        "detail": ""
      }
    ]
  }
}
```

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

### 前提条件

- AdsPower 浏览器已打开目标 Shopify 店铺的 admin 并登录
- 该店铺已在 `config/stores.json` 中配置

### 店铺匹配（模糊搜索）

用户可能用以下方式指定店铺：
- 店铺名称（如"花错"）→ 模糊匹配 `name`
- profileNo（如 1895750）→ 精确匹配
- 备注关键词 → 模糊匹配 `remark`

### 命令

```bash
node scripts/publisher/upload-product.js 2026-03-23/001 --store "店铺名称或profileNo"
```

### 发布内容

1. 上传商品主图到 Shopify Media
2. 填写标题、价格（现价 + 划线价）
3. 填写 SKU
4. 填写商品描述（支持 descriptionBlocks 图文混排）
5. 上传描述图片
6. 设置为 Active 状态并保存

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

使用文件锁防止多进程抢同一 profile：
- 锁文件目录：`/tmp/tk2shop-locks/`
- 每个 profile 独立锁文件
- 自动检测锁持有者进程是否存活，死了自动清理

### 预检机制

启动时自动过滤 `profile-pool.json` 中不存在的 profile，避免无效等待。

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
