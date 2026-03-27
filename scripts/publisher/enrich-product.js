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

function stripEmoji(text) {
  return String(text || '')
    .replace(/[\u{1F300}-\u{1FAD6}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE0F}]/gu, '')
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cleanShopifySentence(text) {
  let cleaned = stripEmoji(text)
  cleaned = normalizeWhitespace(cleaned)
    .replace(/[【】]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()

  return cleaned
}

function normalizeShopifyTitle(product) {
  const sourceTitle = normalizeWhitespace(product?.title || '')
  if (!sourceTitle) return ''

  const cleaned = stripEmoji(sourceTitle)
    .replace(/#GLOBAL PICKS/gi, '')
    .replace(/\b(?:2024|2025|2026|2027)\b/gi, '')
    .replace(/\b(?:new|hot sale|best seller|flash sale)\b/gi, '')
    .replace(/\b(?:body care products?|daily use|diy manicure)\b/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim()

  const base = cleaned || sourceTitle
  const lowerBase = base.toLowerCase()
  const bits = base
    .split(',')
    .map(part => normalizeWhitespace(part))
    .filter(Boolean)

  const uniqueBits = []
  for (const bit of bits) {
    const key = bit.toLowerCase()
    if (!uniqueBits.some(item => item.toLowerCase() === key)) {
      uniqueBits.push(bit)
    }
  }

  if (/(turmeric|ginger)/i.test(lowerBase) && /(patch|patches)/i.test(lowerBase)) {
    const packMatch = base.match(/\b(\d+\s*(?:pack|pcs?|pieces?))\b/i)
    const packText = packMatch ? normalizeWhitespace(packMatch[1]).replace(/\bpack\b/i, 'Pack') : '24 Pack'
    return normalizeWhitespace(`${packText} Turmeric & Ginger Foot Patches for Overnight Foot Care`)
  }

  if (/(foot patch|foot patches)/i.test(lowerBase)) {
    const packMatch = base.match(/\b(\d+\s*(?:pack|pcs?|pieces?))\b/i)
    const packText = packMatch ? normalizeWhitespace(packMatch[1]).replace(/\bpack\b/i, 'Pack') : ''
    return normalizeWhitespace(`${packText ? `${packText} ` : ''}Detox Foot Patches for Overnight Foot Care`)
  }

  const head = uniqueBits[0] || base
  const lower = head.toLowerCase()
  const hasCallusRemover = /callus remover/.test(lower) || /dead skin remover/.test(lowerBase)
  const hasRechargeable = /rechargeable/.test(lowerBase)
  const hasFoot = /foot/.test(lowerBase)
  const hasLed = uniqueBits.some(bit => /(?:led light|& light|with light|light\b)/i.test(bit))
  const hasWashable = uniqueBits.some(bit => /washable/i.test(bit))
  const hasAdjustable = uniqueBits.some(bit => /(2 adjustable levels|2 speeds|adjustable)/i.test(bit))

  if (hasFoot || hasCallusRemover) {
    const titleParts = []
    if (hasRechargeable) titleParts.push('Rechargeable')
    if (hasFoot && !hasCallusRemover) titleParts.push('Electric Foot Care Tool')
    else titleParts.push('Electric Foot Callus Remover')
    if (hasAdjustable) titleParts.push('with 2 Speeds')

    const extras = []
    if (hasWashable) extras.push('Washable Grinding Head')
    if (hasLed) extras.push('LED Light')

    let result = titleParts.join(' ')
    if (extras.length) result += `, ${extras.join(' and ')}`
    result += ' for At-Home Pedicure Care'

    return normalizeWhitespace(result.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' '))
  }

  return normalizeWhitespace(base)
}

function lightRewriteTextBlock(text) {
  const cleaned = cleanShopifySentence(text)
  if (!cleaned) return ''

  let body = cleaned
    .replace(/^([A-Za-z][A-Za-z &/-]{1,40}):\s*/i, '')
    .replace(/^·\s*/, '')
    .trim()

  if (!body) return ''

  if (/500mAh battery/i.test(body) || /recharge/i.test(body)) {
    return 'Powered by a 500mAh rechargeable battery, this electric foot callus remover is designed for convenient cordless use and easy recharging between treatments.'
  }

  if (/2 adjustable levels|different sensitivities|customizable/i.test(body)) {
    return 'Two adjustable speed levels let you choose the setting that feels right for different areas and levels of rough, dry skin.'
  }

  if (/washable|hygienic/i.test(body)) {
    return 'The washable grinding head makes regular cleaning simple, helping you keep your foot care routine more hygienic after each use.'
  }

  if (/led light|illuminates|visibility/i.test(body)) {
    return 'A built-in LED light helps brighten the treatment area, making it easier to see details while working on hard-to-reach spots.'
  }

  if (/abs material|durable|frequent use|daily foot care regime/i.test(body)) {
    return 'Made from durable ABS material, this pedicure tool is built for repeated use and everyday at-home foot care.'
  }

  body = body
    .replace(/\bideal for\b/gi, 'suited for')
    .replace(/\bperfect for\b/gi, 'great for')

  if (!/[.!?]$/.test(body)) body += '.'
  return body
}

function truncateReview(text, maxLen = 100) {
  const clean = normalizeWhitespace(text)
  if (clean.length <= maxLen) return clean
  return clean.slice(0, maxLen - 1).trimEnd() + '…'
}

function buildTemplateReviews(product, shopifyTitle = '') {
  const names = ['Emily', 'Jason', 'Mia']
  const title = normalizeWhitespace(shopifyTitle || product?.shopifyContent?.title || normalizeShopifyTitle(product) || product?.title || '')
  const titleLower = title.toLowerCase()
  const shortTitle = titleLower || 'item'
  const base = [
    `Really happy with this ${shortTitle}. It feels practical and matches the listing well.`,
    `Good quality and easy to use. The ${shortTitle} worked well for what I needed.`,
    `Nice details, simple setup, and exactly as described. I would buy this again.`
  ]

  return names.map((name, index) => ({
    name,
    content: truncateReview(base[index] || base[0], 100),
  }))
}

function buildShopifyDescriptionFromBlocks(product) {
  const blocks = Array.isArray(product?.descriptionBlocks) ? product.descriptionBlocks : []
  if (!blocks.length) return { html: '', text: '' }

  const htmlParts = []
  const textParts = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue

    if (block.type === 'text') {
      const text = lightRewriteTextBlock(block.text || '')
      if (!text) continue
      htmlParts.push(`<p>${escapeHtml(text)}</p>`)
      textParts.push(text)
      continue
    }

    if (block.type === 'image') {
      const src = String(block.src || '').trim()
      if (!src) continue
      htmlParts.push(`<img src="${escapeHtml(src)}" alt="" style="max-width:100%;height:auto;display:block;">`)
    }
  }

  return {
    html: htmlParts.join('\n'),
    text: textParts.join('\n\n').trim(),
  }
}

function buildShopifyDescriptionFromPlainText(product) {
  const source = normalizeWhitespace(stripEmoji(product?.description || ''))
  if (!source) return { html: '', text: '' }

  const paragraphs = source
    .split(/\n+/)
    .map(part => lightRewriteTextBlock(part))
    .filter(Boolean)

  return {
    html: paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('\n'),
    text: paragraphs.join('\n\n').trim(),
  }
}

function buildShopifyDescription(product) {
  const fromBlocks = buildShopifyDescriptionFromBlocks(product)
  if (fromBlocks.html) return fromBlocks
  return buildShopifyDescriptionFromPlainText(product)
}

function enrichProduct(product) {
  const shopifyTitle = normalizeShopifyTitle(product) || (product.title || '')
  const description = buildShopifyDescription(product)

  let reviews = []
  try {
    reviews = buildTemplateReviews(product, shopifyTitle)
  } catch (e) {
    log(`⚠️ 评论生成失败，写空数组: ${e.message}`)
    reviews = []
  }

  product.shopifyContent = {
    ...(product.shopifyContent || {}),
    title: shopifyTitle,
    descriptionHtml: description.html,
    descriptionText: description.text,
  }

  product.templateAssets = {
    ...(product.templateAssets || {}),
    reviews,
  }

  product.contentMeta = {
    ...(product.contentMeta || {}),
    version: 'v2',
    descriptionMode: description.html ? 'direct_rewrite' : 'disabled',
    reviewsGenerated: Array.isArray(reviews) && reviews.length === 3,
    updatedAt: new Date().toISOString(),
  }

  return {
    product,
    shopifyTitle,
    descriptionMode: product.contentMeta.descriptionMode,
    reviewsCount: reviews.length,
  }
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
  const result = enrichProduct(product)

  writeJson(productJsonPath, result.product)
  log(`✅ 已增强: ${productJsonPath}`)
  log(`   标题: ${result.shopifyTitle}`)
  log(`   描述增强: ${result.descriptionMode}`)
  log(`   评论数: ${result.reviewsCount}`)
}

if (require.main === module) {
  main()
}

module.exports = {
  normalizeWhitespace,
  normalizeShopifyTitle,
  stripEmoji,
  cleanShopifySentence,
  lightRewriteTextBlock,
  buildShopifyDescriptionFromBlocks,
  buildShopifyDescriptionFromPlainText,
  buildShopifyDescription,
  enrichProduct,
}
