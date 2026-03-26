#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ \u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeShopifyTitle(product) {
  const sourceTitle = normalizeWhitespace(product?.title || '')
  if (!sourceTitle) return ''

  let title = sourceTitle
    .replace(/#GLOBAL PICKS/gi, '')
    .replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '')
    .replace(/\b(?:2024|2025|2026|2027)\b/gi, '')
    .replace(/\b(?:new|hot sale|best seller|flash sale)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim()

  return title || sourceTitle
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanupSentence(text) {
  let s = normalizeWhitespace(text)
  s = s.replace(/[【】]/g, '')
  s = s.replace(/\s*[:：]\s*/g, ': ')
  s = s.replace(/\s+([,.!?;:])/g, '$1')
  s = s.replace(/([,.!?])([A-Za-z])/g, '$1 $2')
  return s.trim()
}

function extractProductDescriptionLines(description) {
  const text = normalizeWhitespace(description)
  if (!text) return []

  const aboutIndex = text.indexOf('About this product')
  if (aboutIndex === -1) return []

  let slice = text.slice(aboutIndex)
  const endMarkers = [
    'View more',
    'Sold by ',
    'Shipping & returns',
    'About this shop',
    'Videos for this product',
    'Explore more from ',
    'You may also like',
    'People also searched for',
  ]

  let end = slice.length
  for (const marker of endMarkers) {
    const idx = slice.indexOf(marker)
    if (idx > 0 && idx < end) end = idx
  }
  slice = slice.slice(0, end)

  const lines = slice
    .split(/\n+/)
    .map(line => cleanupSentence(line))
    .filter(Boolean)

  const filtered = []
  const noisePatterns = [
    /^About this product$/i,
    /^Details$/i,
    /^Product description$/i,
    /^Sort by$/i,
    /^Filter by$/i,
    /^Recommended$/i,
    /^Reset filters$/i,
    /^Verified purchase$/i,
    /^US$/i,
    /^Item:$/i,
    /^Previous$/i,
    /^Next$/i,
    /^Recommended$/i,
    /^All$/i,
    /^Includes visuals$/i,
    /^Displaying \d+ of \d+ reviews$/i,
    /^\d+(?:\.\d+)?$/,
    /^\$?\d+[\d.,]*$/,
    /^-\d+%$/,
    /^Log in$/i,
    /^Login$/i,
    /^Home Improvement$/i,
    /^Garden Supplies$/i,
    /^Garden Pots & Planters$/i,
  ]

  for (const line of lines) {
    if (noisePatterns.some(re => re.test(line))) continue
    if (/^\d{4}-\d{2}-\d{2}$/.test(line)) continue
    if (/^\(?\d+(?:\.\d+)?\)?$/.test(line)) continue
    filtered.push(line)
  }

  return filtered
}

function buildDescriptionHtmlFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return ''

  const detailMap = []
  const bullets = []

  for (const line of lines) {
    if (/^[A-Za-z][A-Za-z\s\/]+:\s+.+$/.test(line) && !/^https?:/i.test(line)) {
      const [label, ...rest] = line.split(':')
      const value = rest.join(':').trim()
      if (label && value) {
        detailMap.push({ label: label.trim(), value })
        continue
      }
    }

    if (/^[\-•*]/.test(line)) {
      bullets.push(line.replace(/^[\-•*]\s*/, '').trim())
      continue
    }

    if (/^(Full Spectrum LEDs|Humidity Control Dome|Height Adjustable Lid|Complete Germination Kit|Mini Greenhouse Setup)\s*:/i.test(line)) {
      bullets.push(line)
      continue
    }

    bullets.push(line)
  }

  const html = []
  html.push('<div>')

  if (detailMap.length > 0) {
    html.push('<ul>')
    for (const item of detailMap) {
      html.push(`<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`)
    }
    html.push('</ul>')
  }

  if (bullets.length > 0) {
    html.push('<ul>')
    for (const item of bullets) {
      html.push(`<li>${escapeHtml(item)}</li>`)
    }
    html.push('</ul>')
  }

  html.push('</div>')
  return html.join('')
}

function refineDescriptionPreservingLayout(product) {
  const original = normalizeWhitespace(product?.description || '')
  if (!original) return ''

  const lines = extractProductDescriptionLines(original)
  if (lines.length === 0) {
    const safeText = cleanupSentence(original).slice(0, 2000)
    return safeText ? `<div><p>${escapeHtml(safeText)}</p></div>` : ''
  }

  return buildDescriptionHtmlFromLines(lines)
}

function truncateReview(text, maxLen = 100) {
  const clean = normalizeWhitespace(text)
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen - 1).trimEnd() + '…'
}

function buildTemplateReviews(product) {
  const names = ['Emily', 'Jason', 'Mia']
  const title = normalizeShopifyTitle(product)
  const base = [
    `Really happy with this ${title.toLowerCase()}. It feels practical and matches the listing well.`,
    `Good quality and easy to use. The ${title.toLowerCase()} worked well for what I needed.`,
    `Nice details, simple setup, and exactly as described. I would buy this again.`
  ]

  return names.map((name, index) => ({
    name,
    content: truncateReview(base[index] || base[0], 100),
  }))
}

function main() {
  const targetPath = process.argv[2]
  if (!targetPath) {
    console.error('❌ 用法: node enrich-product.js <商品目录或product.json路径>')
    process.exit(1)
  }

  const resolved = path.resolve(targetPath)
  const productJsonPath = resolved.endsWith('.json') ? resolved : path.join(resolved, 'product.json')

  if (!fs.existsSync(productJsonPath)) {
    console.error(`❌ product.json 不存在: ${productJsonPath}`)
    process.exit(1)
  }

  const product = readJson(productJsonPath)

  const shopifyTitle = normalizeShopifyTitle(product) || (product.title || '')
  let descriptionHtml = ''
  try {
    descriptionHtml = refineDescriptionPreservingLayout(product)
  } catch (e) {
    log(`⚠️ 描述处理失败，回退原始描述: ${e.message}`)
    descriptionHtml = product.description ? `<div><p>${escapeHtml(normalizeWhitespace(product.description))}</p></div>` : ''
  }

  let reviews = []
  try {
    reviews = buildTemplateReviews(product)
  } catch (e) {
    log(`⚠️ 评论生成失败，写空数组: ${e.message}`)
    reviews = []
  }

  product.shopifyContent = {
    ...(product.shopifyContent || {}),
    title: shopifyTitle,
    descriptionHtml,
  }

  product.templateAssets = {
    ...(product.templateAssets || {}),
    reviews,
  }

  product.contentMeta = {
    ...(product.contentMeta || {}),
    version: 'v1',
    descriptionMode: 'preserve-layout',
    reviewsGenerated: Array.isArray(reviews) && reviews.length === 3,
    updatedAt: new Date().toISOString(),
  }

  writeJson(productJsonPath, product)
  log(`✅ 已增强: ${productJsonPath}`)
  log(`   标题: ${shopifyTitle}`)
  log(`   描述长度: ${descriptionHtml.length}`)
  log(`   评论数: ${reviews.length}`)
}

main()
