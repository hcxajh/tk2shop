---
name: tk2shop
description: TikTok Shop 商品数据提取插件。从 TikTok Shop 商品页提取数据转换为 Shopify product.json 格式。触发场景：用户提到 TikTok Shop 商品链接、商品采集、tiktok 商品下载、从 TikTok 搬家到 Shopify。
---

# TikTok → Shopify 商品采集

## 执行方式

```bash
cd /root/.openclaw/skills/tk2shop
node extract-detail.js
```

**前提：**
- AdsPower 浏览器已打开目标商品页
- 页面已滚动到商品区域，商品数据已渲染

**输出路径：** `/root/.openclaw/TKdown/YYYY-MM-DD/001/`

---

## DOM 结构（精准选择器）

```
1. 商品主图区
   选择器: [class*="items-center"][class*="gap-12"][class*="overflow-visible"]
   说明: div.items-center.gap-12.overflow-visible 是横向轮播的主图容器
   注意: 不要用 overflow-x-auto，会混入评论区图片

2. SKU 选项区
   选择器: [class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]
   说明: 每个子 div 是一种颜色/规格变体（如 Purple、Red、Yellow）
   每个子 div 里包含：文字 + 缩略图

3. 展开按钮
   选择器: span.Headline-Semibold
   说明: 点击后出现完整商品介绍

4. 完整介绍
   选择器: [class*="overflow-hidden"][class*="transition-all"]
   说明: 点击展开按钮后出现

5. 商品标题
   选择器: h2.H2-Semibold
   说明: 取第一个且文本较长的那个
   推荐: 用 meta[property="og:title"] 最准确
```

---

## 采集流程

```
1. 滚动页面触发商品数据渲染
2. 提取商品主图（items-center + gap-12 + overflow-visible）
3. 提取 SKU 变体（flex-row + gap-12 + flex-wrap）
4. 点击每个 SKU → 提取对应价格 + 完整介绍
5. 下载图片（主图 + SKU 缩略图）
6. 生成 product.json
```

---

## product.json 格式

```json
{
  "title": "商品标题",
  "description": "商品介绍（点击展开后的内容）",
  "price": "5.00",
  "compareAtPrice": "179.00",
  "sku": "TK-商品ID",
  "status": "active",
  "images": ["001.webp", "002.webp", ...],
  "descriptionImages": [],
  "_meta": {
    "productId": "商品ID",
    "source": "tiktok-shop-detail",
    "extractedAt": "ISO时间",
    "skus": [
      {
        "name": "Purple",
        "thumbnail": "sku_01_Purple.webp",
        "price": "36.00",
        "compareAtPrice": "",
        "detail": "商品介绍...",
        "inventoryQuantity": 100
      }
    ]
  }
}
```

---

## 重要经验（踩坑记录）

### 1. 选择器用错会混入大量无关图片
❌ 错误：`[class*="overflow-x-auto"]` — 会匹配评论区、导航栏等
✅ 正确：`[class*="items-center"][class*="gap-12"][class*="overflow-visible"]` — 精准主图区

### 2. API 拦截在新版 TikTok Shop 无效
❌ `/api/product/detail` 请求不存在（新版不走这个接口）
✅ 改用 DOM 提取：meta og 标签 + DOM 选择器

### 3. 标题要排除干扰元素
❌ 错误：直接取第一个 h2.H2-Semibold（可能是 "Coupon center"）
✅ 正确：用 meta[property="og:title"]

### 4. 价格在商品详情区，不是全页 DOM
❌ 错误：遍历全页找 $/ 导致混入其他商品价格
✅ 正确：先点击 SKU，再在标题父容器内查找价格

### 5. 描述区图片必须在特定位置提取
**踩坑记录：** 之前 `descriptionImages` 一直为空。
**原因：** 页面需要先滚动到位置0加载商品数据，再点击展开按钮，描述图片才在 DOM 中可见。
**正确步骤：**
1. `window.scrollTo(0, 0)` — 先回到顶部
2. 等待商品数据渲染
3. 点击 Description/Details 展开按钮
4. 立即在 `[class*="overflow-hidden"][class*="transition-all"]` div 内提取 `<img>` 标签
5. 图片 URL 格式：`~tplv-fhlh96nyum-origin-jpeg.jpeg`（原始分辨率）
6. 如果提取偏晚，图片可能随页面滚动被销毁

### 6. TikTok CDN 图片 URL 清理（重要！）
**踩坑记录：** 描述区有5张图，但下载后只有2张有效图片，其他3张是46字节错误文件。
**原因：** URL 清理函数正则写错了，匹配不上 TikTok 新版 CDN 格式。
**正确格式：** `~tplv-fhlh96nyum-crop-webp:800:1190.webp` → `~tplv-fhlh96nyum-origin.webp`
**正确清理函数：**
```javascript
function cleanDescImgUrl(url) {
  return url
    .replace(/~tplv-([a-z0-9]+)-crop-webp:(\d+):(\d+)\.webp/gi, '~tplv-$1-origin.webp')
    .replace(/~tplv-([a-z0-9]+)-crop-jpeg:(\d+):(\d+)\.jpeg/gi, '~tplv-$1-origin.jpeg')
    .replace(/~tplv-([a-z0-9]+)-crop-jpg:(\d+):(\d+)\.jpg/gi, '~tplv-$1-origin.jpg')
    .replace(/~tplv-([a-z0-9]+)-resize-png:(\d+):(\d+)\.png/gi, '~tplv-$1-origin.png');
}
```

### 7. 描述图片必须加入 images 数组
**踩坑记录：** 描述图片下载到了 `desc-images/` 目录，但 `product.json` 的 `images` 数组为空。
**原因：** 下载和写入 images 数组是两条独立逻辑，漏了合并步骤。
**正确做法：** 描述图片下载后，文件名加入 `allImages = [...downloadedMain, ...descImages]` 并写入 `descriptionImages` 字段。

### 8. 详情要存展开后的真实内容
❌ 错误：存 TikTok 的 meta 广告语（"Buy... on TikTok Shop..."）
✅ 正确：点击展开按钮，从 overflow-hidden.transition-all 取 innerText

---

## 输出目录

```
TKdown/YYYY-MM-DD/001/
├── product.json
├── images/
│   ├── 001.webp
│   ├── 002.webp
│   └── ...
└── sku/
    ├── sku_01_Purple.webp
    ├── sku_02_Red.webp
    └── sku_03_Yellow.webp
```

序号自动递增：001, 002, 003...

---

---

## 子代理自动采集

通过 `runner.js` 可以自动调用 AdsPower 浏览器完成全流程采集（开浏览器→采集→下载→关浏览器）。

### 执行命令

```bash
cd /root/.openclaw/skills/tk2shop
node runner.js '{"tiktokUrl": "https://shop.tiktok.com/..."}'
```

或通过环境变量：
```bash
TK_TIKTOK_URL="https://shop.tiktok.com/..." node runner.js
```

### AdsPower 配置文件池

子代理使用的浏览器配置文件编号池定义在技能目录的 `profile-pool.json` 中：

```json
{
  "description": "tk2shop 子代理可用的 AdsPower 配置文件编号池",
  "updated": "2026-03-23",
  "profiles": [
    1896381,
    1896382,
    1896383,
    1896384,
    1896385,
    1896386,
    1896387,
    1896388,
    1896389,
    1896390
  ]
}
```

**使用方式：** 直接编辑 `profile-pool.json`，在 `profiles` 数组中添加或删除配置文件编号。脚本启动时会自动读取列表，并按顺序选择第一个空闲的配置文件。

### 返回格式

```json
{
  "success": true,
  "outputDir": "/root/.openclaw/TKdown/2026-03-23/005",
  "productId": "1774180040216",
  "title": "商品标题",
  "images": 13,
  "mainImages": 9,
  "descImages": 4,
  "skus": 4,
  "price": "$29.99",
  "message": "采集完成"
}
```

---

## 注意事项

- 采集前页面需滚动到商品区域，否则数据未渲染
- 每个 SKU 价格需单独提取（点击后从商品详情区查找）
- SKU 库存默认 100
- 滑块验证码出现时需人工处理
