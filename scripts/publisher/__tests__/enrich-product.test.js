const assert = require('assert')
const {
  stripEmoji,
  normalizeShopifyTitle,
  lightRewriteTextBlock,
  buildShopifyDescriptionFromBlocks,
  buildShopifyDescriptionFromPlainText,
  enrichProduct,
} = require('../enrich-product')

function testStripEmoji() {
  const input = '🎁 Perfect gift ✨ for home 🐄'
  const output = stripEmoji(input)
  assert(!output.includes('🎁'))
  assert(!output.includes('✨'))
  assert(!output.includes('🐄'))
}

function testNormalizeShopifyTitle() {
  const product = {
    title: 'Rechargeable Electric Foot Callus Remover, 2 Adjustable Levels Foot File with Washable Grinding Head & Light, Cordless Nail File, Professional Pedicure Tool for Daily Use, Body Care Products, Foot Dead Skin Remover, Foot Callus Remover, DIY Manicure',
  }
  const output = normalizeShopifyTitle(product)
  assert.strictEqual(
    output,
    'Rechargeable Electric Foot Callus Remover with 2 Speeds, Washable Grinding Head and LED Light for At-Home Pedicure Care'
  )
}

function testLightRewriteTextBlock() {
  const input = '【Rechargeable Convenience】: Featuring a 500mAh battery, this electric foot callus remover ensures long-lasting usage and recharges easily, offering uninterrupted care for your feet.'
  const output = lightRewriteTextBlock(input)
  assert(/500mAh rechargeable battery/i.test(output))
  assert(/cordless use/i.test(output))
  assert(!/【|】/.test(output))
}

function testBuildShopifyDescriptionFromBlocks() {
  const product = {
    descriptionBlocks: [
      { type: 'text', text: '【Rechargeable Convenience】: Featuring a 500mAh battery, this electric foot callus remover ensures long-lasting usage and recharges easily, offering uninterrupted care for your feet.' },
      { type: 'image', src: 'https://example.com/1.jpg' },
      { type: 'text', text: '【Enhanced Visibility】: Equipped with an LED light, this pedicure tool illuminates the treatment area, ensuring no spot is missed during your foot care routine.' },
    ],
  }
  const result = buildShopifyDescriptionFromBlocks(product)
  assert(result.html.includes('<p>Powered by a 500mAh rechargeable battery'))
  assert(result.html.includes('<img src="https://example.com/1.jpg"'))
  assert(result.html.includes('<p>A built-in LED light helps brighten the treatment area'))
}

function testBuildShopifyDescriptionFromPlainText() {
  const product = {
    description: '【Hygienic & Washable】: The grinding head is easily washable, promoting a hygienic approach to foot care by allowing you to clean it thoroughly after each use.\n【Durable Material】: Constructed from high-quality ABS material, this foot callus remover is built to withstand frequent use, making it a reliable addition to your daily foot care regime.'
  }
  const result = buildShopifyDescriptionFromPlainText(product)
  assert(result.html.includes('<p>The washable grinding head makes regular cleaning simple'))
  assert(result.html.includes('<p>Made from durable ABS material'))
}

function testEnrichProduct() {
  const product = {
    title: 'Rechargeable Electric Foot Callus Remover, 2 Adjustable Levels Foot File with Washable Grinding Head & Light, Cordless Nail File, Professional Pedicure Tool for Daily Use, Body Care Products, Foot Dead Skin Remover, Foot Callus Remover, DIY Manicure',
    descriptionBlocks: [
      { type: 'text', text: '【Rechargeable Convenience】: Featuring a 500mAh battery, this electric foot callus remover ensures long-lasting usage and recharges easily, offering uninterrupted care for your feet.' },
      { type: 'image', src: 'https://example.com/1.jpg' },
      { type: 'text', text: '【Durable Material】: Constructed from high-quality ABS material, this foot callus remover is built to withstand frequent use, making it a reliable addition to your daily foot care regime.' },
    ],
  }
  const result = enrichProduct(product)
  assert.strictEqual(result.product.shopifyContent.title, 'Rechargeable Electric Foot Callus Remover with 2 Speeds, Washable Grinding Head and LED Light for At-Home Pedicure Care')
  assert(result.product.shopifyContent.descriptionHtml.includes('<img src="https://example.com/1.jpg"'))
  assert(result.product.shopifyContent.descriptionHtml.includes('Powered by a 500mAh rechargeable battery'))
  assert(result.product.shopifyContent.descriptionHtml.includes('Made from durable ABS material'))
  assert.strictEqual(result.product.contentMeta.descriptionMode, 'direct_rewrite')
  assert(result.product.templateAssets.reviews[0].content.includes('rechargeable electric foot callus remover with 2 speeds'))
  assert(!result.product.templateAssets.reviews[0].content.includes('2 adjustable levels foot file'))
}

function run() {
  testStripEmoji()
  testNormalizeShopifyTitle()
  testLightRewriteTextBlock()
  testBuildShopifyDescriptionFromBlocks()
  testBuildShopifyDescriptionFromPlainText()
  testEnrichProduct()
  console.log('PASS enrich-product tests')
}

run()
