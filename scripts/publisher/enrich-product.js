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
  }

  if (product.shopifyContent && Object.prototype.hasOwnProperty.call(product.shopifyContent, 'descriptionHtml')) {
    delete product.shopifyContent.descriptionHtml
  }

  product.templateAssets = {
    ...(product.templateAssets || {}),
    reviews,
  }

  product.contentMeta = {
    ...(product.contentMeta || {}),
    version: 'v1',
    descriptionMode: 'disabled',
    reviewsGenerated: Array.isArray(reviews) && reviews.length === 3,
    updatedAt: new Date().toISOString(),
  }

  writeJson(productJsonPath, product)
  log(`✅ 已增强: ${productJsonPath}`)
  log(`   标题: ${shopifyTitle}`)
  log(`   描述增强: 已关闭`)
  log(`   评论数: ${reviews.length}`)
}

main()
