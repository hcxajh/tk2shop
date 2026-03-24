#!/usr/bin/env node
/**
 * product.json → product.csv 转换脚本
 * 
 * 将采集的商品数据转换为 Shopify CSV 导入格式
 * 
 * 用法: node to-csv.js <商品目录> [--store <店铺名>
 * 
 * 输出: product.csv
 */

const fs = require('fs')
const path = require('path')

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown'
const CONFIG_DIR = '/root/.openclaw/skills/tk2shop/config'
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json')

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

function loadStores() {
  try { return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')).stores || [] }
  catch (e) { return [] }
}

function findStore(query) {
  const stores = loadStores()
  if (!query) return stores[0] || null
  const q = query.toLowerCase()
  for (const s of stores) {
    if (s.profileNo === parseInt(query)) return s
    if ((s.storeId||'').toLowerCase().includes(q) || (s.name||'').toLowerCase().includes(q)) return s
  }
  return null
}

// ============================================================
// CSV 列定义（按 Shopify CSV 模板顺序，共58列）
// ============================================================
const CSV_HEADERS = [
  'Title',                     // 0
  'URL handle',                // 1
  'Description',               // 2
  'Vendor',                    // 3
  'Product category',          // 4
  'Type',                      // 5
  'Tags',                      // 6
  'Published on online store', // 7
  'Status',                    // 8
  'SKU',                       // 9
  'Barcode',                   // 10
  'Option1 name',              // 11
  'Option1 value',             // 12
  'Option1 Linked To',         // 13
  'Option2 name',              // 14
  'Option2 value',             // 15
  'Option2 Linked To',         // 16
  'Option3 name',              // 17
  'Option3 value',             // 18
  'Option3 Linked To',         // 19
  'Price',                     // 20
  'Compare-at price',          // 21
  'Cost per item',             // 22
  'Charge tax',                // 23
  'Tax code',                  // 24
  'Unit price total measure',  // 25
  'Unit price total measure unit',    // 26
  'Unit price base measure',   // 27
  'Unit price base measure unit',     // 28
  'Inventory tracker',         // 29
  'Inventory quantity',        // 30
  'Continue selling when out of stock', // 31
  'Weight value (grams)',      // 32
  'Weight unit for display',   // 33
  'Requires shipping',         // 34
  'Fulfillment service',       // 35
  'Product image URL',         // 36
  'Image position',            // 37
  'Image alt text',            // 38
  'Variant image URL',         // 39
  'Gift card',                 // 40
  'SEO title',                 // 41
  'SEO description',           // 42
  'Color (product.metafields.shopify.color-pattern)', // 43
  'Google Shopping / Google product category',  // 44
  'Google Shopping / Gender',                  // 45
  'Google Shopping / Age group',               // 46
  'Google Shopping / Manufacturer part number (MPN)', // 47
  'Google Shopping / Ad group name',            // 48
  'Google Shopping / Ads labels',               // 49
  'Google Shopping / Condition',                 // 50
  'Google Shopping / Custom product',           // 51
  'Google Shopping / Custom label 0',           // 52
  'Google Shopping / Custom label 1',           // 53
  'Google Shopping / Custom label 2',           // 54
  'Google Shopping / Custom label 3',           // 55
  'Google Shopping / Custom label 4',           // 56
  '',                                          // 57: 末尾空列
]

// ============================================================
// CSV 转义（处理逗号、换行、引号）
// ============================================================
function escapeCSV(str) {
  if (str === null || str === undefined) return ''
  const s = String(str)
  if (s.includes(',') || s.includes('\n') || s.includes('"') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

// ============================================================
// 生成 Handle（URL slug）
// ============================================================
function toHandle(title) {
  if (!title) return ''
  return title.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '') // 保留字母数字中文
    .replace(/\s+/g, '-')           // 空格变-
    .replace(/-+/g, '-')            // 多个-合并
    .replace(/^-|-$/g, '')          // 首尾-去掉
}

// ============================================================
// 从 SKU 名称提取选项值
// ============================================================
function parseSkuName(name) {
  if (!name) return { opt1: '', opt2: '' }
  // 格式: "(xxx) iPhone" 或 "2 PCS-Type C"
  if (name.includes(') ')) {
    const parts = name.split(') ')
    const opt1 = parts[0].replace(/^\(/, '').trim()
    const opt2 = parts[1]?.trim() || ''
    return { opt1, opt2 }
  } else {
    const hyIdx = name.lastIndexOf('-')
    if (hyIdx > 0) {
      return {
        opt1: name.slice(0, hyIdx).trim(),
        opt2: name.slice(hyIdx + 1).trim()
      }
    }
    return { opt1: name.trim(), opt2: '' }
  }
}

// ============================================================
// 生成单行 CSV
//
// 规则（按官方模板）：
// - 主产品行（isFirstRow=true）：Option1/2 name 填，Option1/2 value 为空
// - 变体行（isFirstRow=false）：Option1/2 name 为空，Option1/2 value 填具体值
// - Linked To 字段：全部留空
// - Color metafield：留空
// ============================================================
function generateRow(product, sku, mainImageUrl, variantImageUrl, isFirstRow) {
  const skus = product._meta?.skus || []
  const hasMultipleSkus = skus.length > 1
  
  // 主产品数据（只在第一行填）
  const title       = isFirstRow ? (product.title || '') : ''
  const handle     = isFirstRow ? toHandle(product.title) : ''
  const description = isFirstRow ? (product.description || '') : ''
  const vendor     = isFirstRow ? '' : ''
  const tags       = isFirstRow ? '' : ''
  const status     = 'Active'
  const published  = isFirstRow ? 'TRUE' : ''
  
  // SKU 数据：没有则自动生成
  let skuVal = sku?.sku || ''
  if (!skuVal && sku?.name) {
    const parsed = parseSkuName(sku.name)
    const opt1short = (parsed.opt1 || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    const opt2short = (parsed.opt2 || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    skuVal = `${opt1short}-${opt2short}`.toUpperCase()
  }
  const price     = sku?.price || ''
  const compareAt = sku?.compareAtPrice || ''
  
  // 选项
  // 主产品行：填 Option name，Option value 为空
  // 变体行：Option name 为空，填 Option value
  let opt1Name = '', opt1Val = '', opt2Name = '', opt2Val = ''
  let opt1Linked = '', opt2Linked = ''
  
  if (hasMultipleSkus) {
    opt1Name = 'Color/Size'
    opt2Name = 'Port'
    // Linked To 固定为空
    opt1Linked = ''
    opt2Linked = ''
    
    if (isFirstRow) {
      // 主产品行：Option value 为空
      opt1Val = ''
      opt2Val = ''
    } else if (sku) {
      // 变体行：Option name 为空，填具体值
      opt1Name = ''
      opt2Name = ''
      const parsed = parseSkuName(sku.name)
      opt1Val = parsed.opt1
      opt2Val = parsed.opt2
    }
  }
  // 单个 SKU：全部留空（不需要选项）
  
  // 图片
  const imageUrl   = isFirstRow ? (mainImageUrl || '') : ''
  const imagePos   = isFirstRow ? '1' : ''
  const imageAlt   = isFirstRow ? (product.title || '') : ''
  const variantImg = !isFirstRow ? (variantImageUrl || '') : ''
  
  // 其他字段（按官方模板）
  const weight         = ''
  const weightUnit     = 'g'
  const requiresShip   = 'TRUE'
  const fulfillSvc    = 'manual'
  const giftCard      = 'FALSE'
  const chargeTax      = 'TRUE'
  const inventoryTracker = 'shopify'
  const inventoryQty   = '100'
  const continueSelling = 'DENY'
  const unitPriceTotal = ''
  const unitPriceTotalUnit = ''
  const unitPriceBase = ''
  const unitPriceBaseUnit = ''
  const colorMetafield = ''  // 固定为空
  const googleCategory = ''
  const googleGender  = ''
  const googleAge     = ''
  const googleMPN     = ''
  const googleAdGroup = ''
  const googleAdsLabels = ''
  const googleCondition = ''
  const googleCustomProduct = ''
  const googleLabel0 = ''
  const googleLabel1 = ''
  const googleLabel2 = ''
  const googleLabel3 = ''
  const googleLabel4 = ''
  
  const row = [
    title, handle, description, vendor, '', '', tags, published, status,  // 0-8
    skuVal, '',                                                         // 9-10
    opt1Name, opt1Val, opt1Linked,                                     // 11-13
    opt2Name, opt2Val, opt2Linked,                                     // 14-16
    '', '', '',                                                         // 17-19: Option3
    price, compareAt, '', chargeTax, '',                                // 20-24
    unitPriceTotal, unitPriceTotalUnit, unitPriceBase, unitPriceBaseUnit, // 25-28
    inventoryTracker, inventoryQty, continueSelling,                      // 29-31
    weight, weightUnit, requiresShip, fulfillSvc,                       // 32-35
    imageUrl, imagePos, imageAlt, variantImg, giftCard, '', '',         // 36-42
    colorMetafield, googleCategory, googleGender, googleAge, googleMPN,  // 43-47
    googleAdGroup, googleAdsLabels, googleCondition, googleCustomProduct, // 48-51
    googleLabel0, googleLabel1, googleLabel2, googleLabel3, googleLabel4, // 52-56
    '',                                                                 // 57: 末尾空列
  ]
  
  return row.map(escapeCSV).join(',')
}

// ============================================================
// 主函数
// ============================================================
function generateCSV(product, imagesDir) {
  const skus = product._meta?.skus || []
  
  // 收集所有图片 URL
  const mainImages = []
  const descImages = []
  
  if (imagesDir && fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir).sort()
    for (const f of files) {
      if (!/\.(webp|png|jpg|jpeg|gif)$/i.test(f)) continue
      const url = product._meta?.imageUrls?.[f] || path.join(imagesDir, f)
      if (f.startsWith('desc_')) {
        descImages.push({ filename: f, url })
      } else {
        mainImages.push({ filename: f, url })
      }
    }
  }
  
  // CSV 标题行
  const rows = [CSV_HEADERS.join(',')]
  
  if (skus.length === 0) {
    // 无变体：只有一行
    rows.push(generateRow(product, null, mainImages[0]?.url || '', '', true))
  } else if (skus.length === 1) {
    // 单个 SKU：两行（主产品行 + 变体行）
    rows.push(generateRow(product, null, mainImages[0]?.url || '', '', true))
    rows.push(generateRow(product, skus[0], mainImages[0]?.url || '', '', false))
  } else {
    // 多个 SKU：
    // Row 1: 主产品行（无 SKU，第一张主图为 product image）
    rows.push(generateRow(product, null, mainImages[0]?.url || '', '', true))
    
    // Row 2+: 每个 SKU 一行（带 SKU，价格，选项值，图片）
    // 第一张主图作为 product image，后续主图作为各行的 variant image
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i]
      // 变体行：如果有单独的 variant image 用它，否则用主图
      const variantImgUrl = mainImages[i + 1]?.url || mainImages[0]?.url || ''
      rows.push(generateRow(product, sku, mainImages[0]?.url || '', variantImgUrl, false))
    }
  }
  
  return rows.join('\n')
}

// ============================================================
// CLI
// ============================================================
const args = process.argv.slice(2)
let folder = '', storeQuery = ''

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--store' && args[i+1]) {
    storeQuery = args[++i]
  } else if (args[i].includes('/')) {
    folder = args[i]
  }
}

if (!folder) {
  console.error('❌ 请指定商品目录')
  console.log('用法: node to-csv.js <目录> [--store <店铺名>]')
  console.log('示例: node to-csv.js 2026-03-23/023 --store default')
  process.exit(1)
}

const store = findStore(storeQuery)
if (!store) {
  console.error(`❌ 未找到店铺: ${storeQuery || 'default'}`)
  process.exit(1)
}

const productJsonPath = path.join(TK_OUTPUT_DIR, folder, 'product.json')
if (!fs.existsSync(productJsonPath)) {
  console.error(`❌ product.json 不存在: ${folder}`)
  process.exit(1)
}

const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'))
const imagesDir = path.join(TK_OUTPUT_DIR, folder, 'images')

log(`📦 商品: ${product.title}`)
log(`   目录: ${folder}`)
log(`   店铺: ${store.name}`)

const csv = generateCSV(product, imagesDir)

const csvPath = path.join(TK_OUTPUT_DIR, folder, 'product.csv')
fs.writeFileSync(csvPath, csv, 'utf8')

log(`✅ CSV 已生成: ${csvPath}`)
log(`   大小: ${(Buffer.byteLength(csv, 'utf8') / 1024).toFixed(1)} KB`)

// 统计
const skus = product._meta?.skus || []
const imagesDir2 = path.join(TK_OUTPUT_DIR, folder, 'images')
let imgCount = 0
if (fs.existsSync(imagesDir2)) {
  imgCount = fs.readdirSync(imagesDir2).filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f)).length
}
log(`   SKU: ${skus.length}个`)
log(`   图片: ${imgCount}张`)
log(`   CSV 行数: ${csv.split('\n').length - 1}行（不含标题）`)
