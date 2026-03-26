const assert = require('assert')
const {
  getPreferredDescriptionHtml,
  generateRow,
} = require('../to-csv')

function testPreferEnrichedHtml() {
  const product = {
    shopifyContent: {
      descriptionHtml: '<p>Shopify HTML</p>'
    },
    descriptionBlocks: [
      { type: 'text', text: 'Original block text' }
    ],
    description: 'Fallback description'
  }
  const result = getPreferredDescriptionHtml(product, {})
  assert.strictEqual(result, '<p>Shopify HTML</p>')
}

function testFallbackToBlocks() {
  const product = {
    descriptionBlocks: [
      { type: 'text', text: 'Original block text' },
      { type: 'image', src: 'https://example.com/a.jpg' }
    ],
    description: 'Fallback description'
  }
  const result = getPreferredDescriptionHtml(product, {})
  assert(result.includes('<p>Original block text</p>'))
  assert(result.includes('<img src="https://example.com/a.jpg"'))
}

function testFallbackToDescription() {
  const product = {
    description: 'Line 1\nLine 2'
  }
  const result = getPreferredDescriptionHtml(product, {})
  assert.strictEqual(result, 'Line 1<br>Line 2')
}

function testImageAltUsesShopifyTitle() {
  const product = {
    title: 'Old raw title',
    shopifyContent: {
      title: 'New Shopify Title',
      descriptionHtml: '<p>Shopify HTML</p>'
    },
    variants: [{ sku: 'SKU-1', price: '5.99' }],
    options: []
  }
  const row = generateRow(product, product.variants[0], 'https://example.com/main.jpg', '', true, {})
  assert(row.includes('New Shopify Title'))
  assert(!row.includes('Old raw title'))
}

function run() {
  testPreferEnrichedHtml()
  testFallbackToBlocks()
  testFallbackToDescription()
  testImageAltUsesShopifyTitle()
  console.log('PASS to-csv tests')
}

run()
