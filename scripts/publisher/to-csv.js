#!/usr/bin/env node
/**
 * product.json → product.csv 转换脚本
 *
 * 将采集的商品数据转换为 Shopify CSV 导入格式
 * 支持使用 imgbb 图床上传主图和变体图
 *
 * 用法: node to-csv.js <商品目录> [--store <店铺名>]
 * 可选环境变量:
 *   IMGBB_API_KEY=xxx
 *
 * 输出: product.csv
 */

const fs = require('fs')
const path = require('path')

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown'
const CONFIG_DIR = '/root/.openclaw/skills/tk2shop/config'
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json')
const OPENCLAW_CONFIG_FILE = '/root/.openclaw/openclaw.json'
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload'

function loadOpenClawEnv() {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_FILE, 'utf8')).env || {}
  } catch {
    return {}
  }
}

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

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
    if ((s.storeId || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)) return s
  }
  return null
}

const CSV_HEADERS = [
  'Title',
  'URL handle',
  'Description',
  'Vendor',
  'Product category',
  'Type',
  'Tags',
  'Published on online store',
  'Status',
  'SKU',
  'Barcode',
  'Option1 name',
  'Option1 value',
  'Option1 Linked To',
  'Option2 name',
  'Option2 value',
  'Option2 Linked To',
  'Option3 name',
  'Option3 value',
  'Option3 Linked To',
  'Price',
  'Compare-at price',
  'Cost per item',
  'Charge tax',
  'Tax code',
  'Unit price total measure',
  'Unit price total measure unit',
  'Unit price base measure',
  'Unit price base measure unit',
  'Inventory tracker',
  'Inventory quantity',
  'Continue selling when out of stock',
  'Weight value (grams)',
  'Weight unit for display',
  'Requires shipping',
  'Fulfillment service',
  'Product image URL',
  'Image position',
  'Image alt text',
  'Variant image URL',
  'Gift card',
  'SEO title',
  'SEO description',
  'Color (product.metafields.shopify.color-pattern)',
  'Google Shopping / Google product category',
  'Google Shopping / Gender',
  'Google Shopping / Age group',
  'Google Shopping / Manufacturer part number (MPN)',
  'Google Shopping / Ad group name',
  'Google Shopping / Ads labels',
  'Google Shopping / Condition',
  'Google Shopping / Custom product',
  'Google Shopping / Custom label 0',
  'Google Shopping / Custom label 1',
  'Google Shopping / Custom label 2',
  'Google Shopping / Custom label 3',
  'Google Shopping / Custom label 4',
]

function escapeCSV(str) {
  if (str === null || str === undefined) return ''
  const s = String(str)
  if (s.includes(',') || s.includes('\n') || s.includes('"') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderDescriptionBlocksHtml(product, descriptionImageUrls = {}) {
  const blocks = Array.isArray(product?.descriptionBlocks) ? product.descriptionBlocks : []
  if (blocks.length === 0) return ''

  const parts = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue

    if (block.type === 'text') {
      const text = String(block.text || '').trim()
      if (!text) continue
      parts.push(`<p>${escapeHtml(text)}</p>`)
      continue
    }

    if (block.type === 'image') {
      const rawSrc = String(block.src || '').trim()
      const src = descriptionImageUrls[rawSrc] || rawSrc
      if (!src) continue
      parts.push(`<img src="${escapeHtml(src)}" alt="" style="max-width:100%;height:auto;display:block;">`)
    }
  }

  return parts.join('\n')
}

function toHandle(title) {
  if (!title) return ''
  return title.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseSkuName(name) {
  if (!name) return { opt1: '', opt2: '' }
  const raw = name.trim()

  const leadingQty = raw.match(/^(\d+\s*(?:Count|Counts|Pack|Packs|PCS|Piece|Pieces|Set|Sets))\s+(.+)$/i)
  if (leadingQty) {
    return { opt1: leadingQty[2].trim(), opt2: leadingQty[1].trim() }
  }

  const trailingQty = raw.match(/^(.+?)\s+(\d+\s*(?:Count|Counts|Pack|Packs|PCS|Piece|Pieces|Set|Sets))$/i)
  if (trailingQty) {
    return { opt1: trailingQty[1].trim(), opt2: trailingQty[2].trim() }
  }

  if (raw.includes(') ')) {
    const parts = raw.split(') ')
    const opt1 = parts[0].replace(/^\(/, '').trim()
    const opt2 = parts[1]?.trim() || ''
    return { opt1, opt2 }
  }

  const protectedRaw = raw
    .replace(/\b(?:two|four|three|five|one)-in-(?:one|1)\b/ig, m => m.replace(/-/g, '__HYPHEN__'))
    .replace(/\b\d+-in-\d+\b/ig, m => m.replace(/-/g, '__HYPHEN__'))
    .replace(/\b(?:usb|type)-c\b/ig, m => m.replace(/-/g, '__HYPHEN__'))
    .replace(/\bc-c\b/ig, m => m.replace(/-/g, '__HYPHEN__'))

  const hyphenSplit = protectedRaw.match(/^(.+?)\s+-\s+(.+)$/)
  if (hyphenSplit) {
    return {
      opt1: hyphenSplit[1].replace(/__HYPHEN__/g, '-').trim(),
      opt2: hyphenSplit[2].replace(/__HYPHEN__/g, '-').trim(),
    }
  }

  return { opt1: raw, opt2: '' }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function getImageFiles(productDir) {
  const imagesDir = path.join(productDir, 'images')
  const skuDir = path.join(productDir, 'sku')
  const isImage = (f) => /\.(webp|png|jpg|jpeg|gif)$/i.test(f)

  const mainImages = fs.existsSync(imagesDir)
    ? fs.readdirSync(imagesDir).filter(isImage).sort().map(f => ({
        key: `images/${f}`,
        filename: f,
        path: path.join(imagesDir, f),
      }))
    : []

  const skuImages = fs.existsSync(skuDir)
    ? fs.readdirSync(skuDir).filter(isImage).sort().map(f => ({
        key: `sku/${f}`,
        filename: f,
        path: path.join(skuDir, f),
      }))
    : []

  return { mainImages, skuImages }
}

function getDescriptionImages(productDir, product) {
  const blocks = Array.isArray(product?.descriptionBlocks) ? product.descriptionBlocks : []
  const imagesDir = path.join(productDir, 'images')
  const descFiles = fs.existsSync(imagesDir)
    ? fs.readdirSync(imagesDir)
        .filter(f => /^desc_/i.test(f) && /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
        .sort()
        .map(f => ({
          key: `images/${f}`,
          filename: f,
          path: path.join(imagesDir, f),
        }))
    : []

  const blockImageSrcs = blocks
    .filter(block => block?.type === 'image' && block?.src)
    .map(block => String(block.src).trim())
    .filter(Boolean)

  return { descFiles, blockImageSrcs }
}

async function uploadToImgbb(filePath, apiKey) {
  const buffer = fs.readFileSync(filePath)
  const body = new URLSearchParams({
    key: apiKey,
    image: buffer.toString('base64'),
    name: path.basename(filePath),
  })

  const res = await fetch(IMGBB_UPLOAD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const data = await res.json()
  if (!res.ok || !data?.success || !data?.data?.url) {
    throw new Error(data?.error?.message || `imgbb 上传失败: ${res.status}`)
  }
  return data.data.url
}

async function prepareHostedImages(productDir, product, apiKey) {
  const cachePath = path.join(productDir, 'imgbb-urls.json')
  const cache = readJson(cachePath, {})
  const { mainImages, skuImages } = getImageFiles(productDir)
  const { descFiles, blockImageSrcs } = getDescriptionImages(productDir, product)
  const variantMap = new Map()
  const descriptionImageUrls = {}

  if (!apiKey) {
    log('⚠️ 未提供 IMGBB_API_KEY，图片列将回退为本地路径')
    for (let i = 0; i < Math.min(descFiles.length, blockImageSrcs.length); i++) {
      descriptionImageUrls[blockImageSrcs[i]] = descFiles[i].path
    }
    return {
      mainImages: mainImages.map(img => ({ ...img, url: img.path })),
      variantUrls: Object.fromEntries(skuImages.map(img => [img.filename, img.path])),
      descriptionImageUrls,
      cache,
      cachePath,
    }
  }

  const allImages = [...mainImages, ...skuImages, ...descFiles]
  for (const img of allImages) {
    if (!cache[img.key]) {
      log(`☁️ 上传图片到 imgbb: ${img.key}`)
      cache[img.key] = await uploadToImgbb(img.path, apiKey)
    }
  }

  for (const img of skuImages) {
    variantMap.set(img.filename, cache[img.key])
  }

  for (let i = 0; i < Math.min(descFiles.length, blockImageSrcs.length); i++) {
    descriptionImageUrls[blockImageSrcs[i]] = cache[descFiles[i].key] || descFiles[i].path
  }

  writeJson(cachePath, cache)

  return {
    mainImages: mainImages.map(img => ({ ...img, url: cache[img.key] || img.path })),
    variantUrls: Object.fromEntries([...variantMap.entries()]),
    descriptionImageUrls,
    cache,
    cachePath,
  }
}

function buildVariantImageUrl(variant, variantUrls, fallbackUrl) {
  if (!variant) return ''
  if (variant.image && variantUrls[variant.image]) return variantUrls[variant.image]
  if (variant.thumbnail && variantUrls[variant.thumbnail]) return variantUrls[variant.thumbnail]
  return fallbackUrl || ''
}

function buildOptionFields(product, variant) {
  const variants = Array.isArray(product.variants) ? product.variants : []
  const options = Array.isArray(product.options) ? product.options : []
  const hasMultipleVariants = variants.length > 1
  const hasQuantityStyle = variants.some(v => /\b\d+\s*(?:Count|Counts|Pack|Packs|PCS|Piece|Pieces|Set|Sets)\b/i.test(v?.name || ''))

  let opt1Name = '', opt1Val = '', opt2Name = '', opt2Val = ''
  let opt1Linked = '', opt2Linked = ''

  if (hasMultipleVariants) {
    const parsed = parseSkuName(variant?.name || '')
    opt1Name = options[0]?.name || 'Color'
    opt1Val = parsed.opt1 || variant?.name || ''
    if (parsed.opt2) {
      opt2Name = options[1]?.name || 'Specification'
      opt2Val = parsed.opt2
    } else if (hasQuantityStyle) {
      opt2Name = options[1]?.name || 'Specification'
      opt2Val = '1 Count'
    }
    return { opt1Name, opt1Val, opt2Name, opt2Val, opt1Linked, opt2Linked }
  }

  if (options.length > 0) {
    opt1Name = options[0]?.name || ''
    opt1Val = options[0]?.value || ''
    opt2Name = options[1]?.name || ''
    opt2Val = options[1]?.value || ''
    return { opt1Name, opt1Val, opt2Name, opt2Val, opt1Linked, opt2Linked }
  }

  return { opt1Name, opt1Val, opt2Name, opt2Val, opt1Linked, opt2Linked }
}

function generateRow(product, variant, mainImageUrl, variantImageUrl, isFirstRow, descriptionImageUrls = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : []
  const hasMultipleVariants = variants.length > 1
  const exportTitle = product.shopifyContent?.title || product.title || ''
  const blocksDescriptionHtml = renderDescriptionBlocksHtml(product, descriptionImageUrls)
  const exportDescriptionHtml = blocksDescriptionHtml || String(product.description || '').replace(/\n/g, '<br>')
  const productHandle = toHandle(exportTitle || product.title)

  const title = isFirstRow ? exportTitle : ''
  const handle = hasMultipleVariants ? productHandle : (isFirstRow ? productHandle : '')
  const description = isFirstRow ? exportDescriptionHtml : ''
  const vendor = isFirstRow ? '' : ''
  const tags = isFirstRow ? '' : ''
  const status = 'Active'
  const published = isFirstRow ? 'TRUE' : ''

  let skuVal = variant?.sku || ''
  if (!skuVal && variant?.name) {
    const parsed = parseSkuName(variant.name)
    const opt1short = (parsed.opt1 || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    const opt2short = (parsed.opt2 || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    skuVal = `${opt1short}-${opt2short}`.toUpperCase()
  }

  const price = variant?.price || product.price || ''
  const compareAt = variant?.compareAtPrice || product.compareAtPrice || ''

  const { opt1Name, opt1Val, opt2Name, opt2Val, opt1Linked, opt2Linked } = buildOptionFields(product, variant)

  const imageUrl = isFirstRow ? (mainImageUrl || '') : ''
  const imagePos = isFirstRow ? '1' : ''
  const imageAlt = isFirstRow ? (product.title || '') : ''
  const variantImg = variantImageUrl || ''

  const inventoryTracker = 'shopify'
  const inventoryQuantity = '100'
  const continueSellingWhenOutOfStock = 'DENY'

  const row = [
    title, handle, description, vendor, '', '', tags, published, status,
    skuVal, '',
    opt1Name, opt1Val, opt1Linked,
    opt2Name, opt2Val, opt2Linked,
    '', '', '',
    price, compareAt, '', 'TRUE', '',
    '', '', '', '',
    inventoryTracker, inventoryQuantity, continueSellingWhenOutOfStock,
    '', 'g', 'TRUE', 'manual',
    imageUrl, imagePos, imageAlt, variantImg, 'FALSE', '', '',
    '', '', '', '', '',
    '', '', '', '', ''
  ]

  return row.map(escapeCSV).join(',')
}

function generateCSV(product, hostedMainImages, variantUrls, descriptionImageUrls = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : []
  const rows = [CSV_HEADERS.join(',')]
  const firstMainImageUrl = hostedMainImages[0]?.url || ''

  if (variants.length === 0) {
    rows.push(generateRow(product, null, firstMainImageUrl, '', true, descriptionImageUrls))
    return rows
  }

  const firstVariant = variants[0]
  const firstVariantImageUrl = buildVariantImageUrl(firstVariant, variantUrls, firstMainImageUrl)
  rows.push(generateRow(product, firstVariant, firstMainImageUrl, firstVariantImageUrl, true, descriptionImageUrls))

  for (let i = 1; i < variants.length; i++) {
    const variant = variants[i]
    const fallbackUrl = hostedMainImages[i]?.url || firstMainImageUrl || ''
    const variantImageUrl = buildVariantImageUrl(variant, variantUrls, fallbackUrl)
    rows.push(generateRow(product, variant, firstMainImageUrl, variantImageUrl, false, descriptionImageUrls))
  }

  return rows
}

async function main() {
  const args = process.argv.slice(2)
  let folder = ''
  let storeQuery = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store' && args[i + 1]) {
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

  const productDir = path.join(TK_OUTPUT_DIR, folder)
  const productJsonPath = path.join(productDir, 'product.json')
  if (!fs.existsSync(productJsonPath)) {
    console.error(`❌ product.json 不存在: ${folder}`)
    process.exit(1)
  }

  const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'))
  const variants = Array.isArray(product.variants) ? product.variants : []
  const openclawEnv = loadOpenClawEnv()
  const imgbbApiKey = process.env.IMGBB_API_KEY || openclawEnv.IMGBB_API_KEY || ''

  log(`📦 商品: ${product.title}`)
  log(`   目录: ${folder}`)
  log(`   店铺: ${store.name}`)

  const hosted = await prepareHostedImages(productDir, product, imgbbApiKey)
  const rows = generateCSV(product, hosted.mainImages, hosted.variantUrls, hosted.descriptionImageUrls)
  const csv = rows.join('\n')

  const csvPath = path.join(productDir, 'product.csv')
  fs.writeFileSync(csvPath, csv, 'utf8')

  const imageCount = hosted.mainImages.length + Object.keys(hosted.variantUrls).length

  log(`✅ CSV 已生成: ${csvPath}`)
  log(`   大小: ${(Buffer.byteLength(csv, 'utf8') / 1024).toFixed(1)} KB`)
  log(`   变体: ${variants.length}个`)
  log(`   图片链接: ${imageCount}个`)
  log(`   CSV 行数: ${rows.length - 1}行（不含标题）`)
}

main().catch(err => {
  console.error('❌ 错误:', err.message)
  process.exit(1)
})
