# tk2shop 正式发布流程

> 适用目标：把 TikTok Shop 商品采集到本地后，整理为 Shopify 可导入的 CSV，并导入到指定 Shopify 店铺后台。

---

## 一、当前正式链路

当前已经验证跑通的正式链路是：

1. TikTok 商品页采集
2. 生成正式 `product.json`
3. `product.json` 转 `product.csv`
4. 图片转为可导入外链（优先使用 imgbb 缓存）
5. 通过 Shopify CSV Import 导入后台
6. 后台核验商品、变体、图片状态

已经验证成功的关键结果：
- 可成功导入为 **1 个商品 + 多个变体**
- 当前 `/034` 样例已成功导入为 **1 个商品 + 12 个变体**
- Shopify 预览页的“约 X 个产品”文案**不可靠**，应以导入后的商品详情页和产品列表为准

---

## 二、目录与输入输出

### 输入
- TikTok 商品链接
- 目标店铺（`config/stores.json` 中已配置）
- 可选：`IMGBB_API_KEY`

### 输出目录
默认输出到 `profile-pool.json` 中配置的 `outputDir`，当前通常为：

```bash
/root/.openclaw/TKdown/YYYY-MM-DD/NNN/
```

典型输出文件：

```bash
product.json
product.csv
imgbb-urls.json
images/
sku/
```

说明：
- `product.json`：正式商品结构
- `product.csv`：Shopify 导入文件
- `imgbb-urls.json`：图片外链缓存，避免重复上传
- `images/`：主图与描述图
- `sku/`：变体图

---

## 三、正式数据结构

### 1）`product.json`
当前正式结构以 `variants` 为准：

```json
{
  "title": "商品标题",
  "description": "商品描述",
  "price": "61.11",
  "compareAtPrice": "134.88",
  "images": ["001.jpg", "002.jpg"],
  "descriptionImages": ["desc_001.jpg"],
  "variants": [
    {
      "name": "Tan",
      "sku": "TK-1729507034286822427-01",
      "price": "61.11",
      "compareAtPrice": "134.88",
      "image": "sku_01_Tan.jpg",
      "thumbnail": "sku_01_Tan.jpg",
      "detail": ""
    }
  ],
  "_meta": {
    "productId": "1729507034286822427",
    "seq": "034",
    "sourceUrl": "https://shop.tiktok.com/...",
    "source": "tiktok-shop-detail",
    "extractedAt": "2026-03-24T..."
  }
}
```

注意：
- 顶层 `variants` 是正式变体来源
- `_meta.skus` 已废弃，不再作为正式链路输入
- `_meta` 只保留采集元信息

### 2）`product.csv`
当前 Shopify 多变体 CSV 的正式策略：

- **首行即首个变体**
- 不再使用“父产品空行 + 全量变体行”旧结构
- 所有变体使用同一个 `URL handle`
- 当前单维变体商品使用：
  - `Option1 name = Color`

这个结构已经在 `/034` 样例上验证通过。

---

## 四、正式执行步骤

## 步骤 1：采集 TikTok 商品

命令：

```bash
cd /root/.openclaw/skills/tk2shop
node scripts/collector/runner.js '{"tiktokUrl":"https://shop.tiktok.com/us/pdp/商品slug/商品ID"}'
```

说明：
- 采集脚本会从 `config/profile-pool.json` 读取：
  - `outputDir`
  - `profiles`
- 代码不写死这些配置
- 如遇 TikTok 验证页，当前策略是**等待人工/页面恢复**，最长可等 10 分钟

采集完成后，先检查：
- `product.json` 是否生成
- 主图是否下载
- SKU 图是否下载
- `variants` 是否存在且内容完整

---

## 步骤 2：生成 Shopify CSV

命令：

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/to-csv.js 2026-03-24/034 --store vellin1122
```

说明：
- `to-csv.js` 从 `product.json` 读取正式 `variants`
- 如果提供 `IMGBB_API_KEY`：
  - 主图、变体图会上传到 imgbb
  - 外链缓存写入当前商品目录下的 `imgbb-urls.json`
- 如果同一批图片已经上传过：
  - 会复用缓存，不重复上传

生成后重点检查：
- `product.csv` 是否存在
- CSV 行数是否等于变体数（多变体商品）
- 首行是否是“产品信息 + 首个变体”
- `Variant image URL` 是否有值

---

## 步骤 3：导入 Shopify

正式导入命令：

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/import-csv-onestop.js 2026-03-24/034 --store vellin1122
```

说明：
- 如果 `product.csv` 已经是外链图片，就算不传 `IMGBB_API_KEY` 也能直接导入
- 只有当 CSV 里仍含本地图片路径、脚本需要代上传时，才强依赖 `IMGBB_API_KEY`
- `import-csv-onestop.js` 会：
  1. 读取 `product.csv`
  2. 必要时上传本地图片并生成 `product-imgbb.csv`
  3. 打开 AdsPower 浏览器
  4. 进入 Shopify Products
  5. 执行 Import
  6. 抓取预览页与导入后页面摘要

---

## 步骤 4：后台核验

### 必查项
导入后不要只看日志里的“✅ 导入完成”，必须核后台。

核验顺序：

1. **Products 列表数量是否变化**
2. **目标商品是否出现在列表中**
3. **点进商品详情页**
4. 检查是否为：
   - 1 个商品
   - 正确的变体数量
   - 正确的选项名（如 `Color`）
   - 正确的 SKU 列表
   - 变体图片是否应用

### 推荐判断标准
以下结果比预览页文案更可信：
- 产品列表总数变化
- 后台出现商品详情页
- 商品详情页出现多变体区块
- 详情页列出了所有 SKU / 颜色值

---

## 五、当前已知结论

### 1）Shopify 预览页文案不可靠
预览页可能显示：

- `将导入约 12 个产品，总共包含 12 个 SKU 和 1 张图片`

这句话**不能直接判定导入结构错误**。
最终要以导入后真实商品页为准。

### 2）首个变体图片仍有尾巴
当前样例 `/034` 的结果是：
- 12 个变体已成功导入
- 后 11 个变体显示“图片已应用”
- **首个变体 `Tan` 仍显示“图片未应用”**

该问题当前定性为：
- **非阻塞优化项**
- 不影响正式发布主链路

### 3）CSV 多行描述必须正确解析
`import-csv-onestop.js` 已修复：
- 不再用简单 `split('\n')` 解析 CSV
- 现在兼容描述字段中的多行内容
- 否则会出现“商品数量 18/19”这类误判

---

## 六、常用命令速查

### 采集

```bash
node scripts/collector/runner.js '{"tiktokUrl":"https://shop.tiktok.com/us/pdp/..."}'
```

### 生成 CSV

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/to-csv.js 2026-03-24/034 --store vellin1122
```

### 一体化导入 Shopify

```bash
IMGBB_API_KEY=你的密钥 node scripts/publisher/import-csv-onestop.js 2026-03-24/034 --store vellin1122
```

---

## 七、推荐正式操作顺序

以后跑新商品，建议严格按下面顺序：

1. 采集 TikTok 商品
2. 检查 `product.json` 里的 `variants`
3. 生成 `product.csv`
4. 检查 CSV 行数、首行结构、图片链接
5. 导入 Shopify
6. 后台核验商品、变体、图片状态
7. 有问题先看导入后页面摘要，不要只看预览页文案

---

## 八、当前不建议再走的旧路径

以下路径目前不建议作为正式链路：

- 继续依赖 `_meta.skus`
- 使用“父产品空行 + 变体行”的旧 CSV 结构
- 只看“点击到导入按钮”就判断成功
- 只看 Shopify 预览页文案就判断导入结构
- 在代码里写死店铺配置、profile 或 imgbb 密钥

---

## 九、当前正式结论

截至 2026-03-24，`tk2shop` 的正式可用链路是：

- `runner.js` 采集
- `to-csv.js` 生成 Shopify 多变体 CSV
- `import-csv-onestop.js` 完成 Shopify 导入

并且已在真实商品 `/034` 上验证：
- 商品创建成功
- 12 个变体创建成功
- 主流程达到可正式复用状态
