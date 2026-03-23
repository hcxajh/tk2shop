#!/usr/bin/env node
/**
 * Shopify Product Uploader
 * 
 * Usage: node upload-product.js <product-folder>
 * Example: node upload-product.js 2026-03-19/001
 * 
 * Product folder structure:
 * products/
 * ├── 0001/
 * │   ├── product.json          # Product data
 * │   └── images/              # Product images
 * │       ├── 1.webp          # Main image
 * │       └── 2.webp          # Additional images
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Default AdsPower CDP URL (use env or argument to override)
const CDP_URL = process.env.CDP_URL || 'ws://127.0.0.1:37173/devtools/browser/852e47dd-a4a0-417c-a530-551257e38087';

// 从配置文件读取 outputDir
const CONFIG_FILE = path.join(__dirname, '..', '..', 'config', 'profile-pool.json');
let PRODUCTS_DIR = '/root/.openclaw/TKdown';
try {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (config.outputDir) PRODUCTS_DIR = config.outputDir;
} catch (e) {}


async function uploadProduct(folderName) {
  const folderPath = path.join(PRODUCTS_DIR, folderName);
  
  // Validate folder exists
  if (!fs.existsSync(folderPath)) {
    console.error(`❌ Folder not found: ${folderPath}`);
    console.log('Available dates (in TKdown/):');
    const dirs = fs.readdirSync(PRODUCTS_DIR).filter(f => {
      return fs.statSync(path.join(PRODUCTS_DIR, f)).isDirectory();
    });
    dirs.forEach(d => {
      const seqs = fs.readdirSync(path.join(PRODUCTS_DIR, d)).filter(f => {
        return fs.statSync(path.join(PRODUCTS_DIR, d, f)).isDirectory();
      });
      seqs.forEach(s => console.log(`  - ${d}/${s}`));
    });
    console.log('\nUsage: node upload-product.js <date/seq>');
    console.log('Example: node upload-product.js 2026-03-19/001');
    process.exit(1);
  }
  
  // Read product.json
  const productJsonPath = path.join(folderPath, 'product.json');
  if (!fs.existsSync(productJsonPath)) {
    console.error(`❌ product.json not found in ${folderName}`);
    process.exit(1);
  }
  
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
  } catch (e) {
    console.error(`❌ Failed to parse product.json: ${e.message}`);
    process.exit(1);
  }
  
  // Validate required fields
  const required = ['title'];
  for (const field of required) {
    if (!product[field]) {
      console.error(`❌ Missing required field: ${field}`);
      process.exit(1);
    }
  }
  
  console.log(`\n📦 Uploading product: ${product.title}`);
  console.log(`   Folder: ${folderName}`);
  console.log(`   Price: $${product.price || 'N/A'}`);
  
  // Collect images for product gallery
  const imagesDir = path.join(folderPath, 'images');
  let images = [];
  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir)
      .filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
      .sort();
    images = files.map(f => path.join(imagesDir, f));
  }
  console.log(`   Gallery images: ${images.length}`);
  
  // Collect images for description (local files in desc-images/ subfolder)
  const descImagesDir = path.join(folderPath, 'desc-images');
  let descLocalImages = [];
  if (fs.existsSync(descImagesDir)) {
    const files = fs.readdirSync(descImagesDir)
      .filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
      .sort();
    descLocalImages = files.map(f => path.join(descImagesDir, f));
  }
  
  // Build description images array from product.json
  const descImages = [];
  if (product.descriptionImages && Array.isArray(product.descriptionImages)) {
    for (const item of product.descriptionImages) {
      if (typeof item === 'string') {
        descImages.push({ src: item, alt: 'Product image' });
      } else if (item.src) {
        descImages.push({ src: item.src, alt: item.alt || 'Product image', width: item.width });
      }
    }
  }
  // Add local desc images (will be uploaded to Shopify media first)
  for (const localPath of descLocalImages) {
    descImages.push({ src: localPath, alt: 'Product image', isLocal: true });
  }
  console.log(`   Description images: ${descImages.length}`);
  
  // Connect to AdsPower browser
  console.log('\n🔌 Connecting to AdsPower browser...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (e) {
    console.error(`❌ Failed to connect to AdsPower browser at ${CDP_URL}`);
    console.log('Make sure AdsPower browser is running. You can specify CDP_URL env variable.');
    process.exit(1);
  }
  
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const shopifyPage = pages.find(p => p.url().includes('admin.shopify.com')) || pages[pages.length - 1];
  
  // Navigate to new product page
  console.log('🚀 Opening Shopify product editor...');
  const storeMatch = shopifyPage.url().match(/store\/([^/]+)/);
  const storeName = storeMatch ? storeMatch[1] : 'vellin1122';
  
  await shopifyPage.goto(`https://admin.shopify.com/store/${storeName}/products/new`, {
    timeout: 40000,
    waitUntil: 'networkidle'
  });
  
  console.log('   Page loaded:', shopifyPage.url());
  
  // Step 1: Upload images FIRST (blocking, wait for completion)
  if (images.length > 0) {
    console.log('\n📸 Uploading images...');
    try {
      const fileInput = shopifyPage.locator('input[type="file"]').first();
      await fileInput.setInputFiles(images);
      console.log(`   ✓ Uploaded ${images.length} image(s)`);
      
      // Wait for upload modal to disappear (media uploading in progress)
      try {
        await shopifyPage.waitForSelector('[aria-label="媒体文件上传中"]', { state: 'hidden', timeout: 30000 });
        console.log('   ✓ Image upload completed');
      } catch (e) {
        console.log('   ⚠ Upload still in progress, waiting extra 3s...');
        await shopifyPage.waitForTimeout(3000);
      }
    } catch (e) {
      console.log(`   ⚠ Image upload failed: ${e.message}`);
    }
  }
  
  // Step 2: Fill form fields
  console.log('\n✍️  Filling product details...');
  
  // Fill title - use keyboard input to trigger React onChange
  const titleInput = shopifyPage.locator('input[name="title"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10000 });
  await titleInput.click();
  await shopifyPage.keyboard.press('Control+A');
  await shopifyPage.keyboard.type(product.title);
  console.log('   ✓ Title filled');
  
  // Build description HTML
  // 支持两种格式：
  // 1. descriptionBlocks (图文块结构，优先)
  // 2. description + descriptionImages[] (传统格式，兜底)
  function buildDescriptionHtml() {
    // 优先用 descriptionBlocks
    if (product.descriptionBlocks && Array.isArray(product.descriptionBlocks) && product.descriptionBlocks.length > 0) {
      let html = '';
      for (const block of product.descriptionBlocks) {
        if (block.type === 'text' || block.type === 'paragraph') {
          const text = block.content || block.text || block.value || '';
          if (text.trim()) {
            html += `<p>${text.replace(/\n/g, '<br>')}</p>`;
          }
        } else if (block.type === 'image' || block.type === 'img') {
          const src = block.src || block.url || block.image || '';
          const alt = block.alt || block.title || 'Product image';
          if (src) {
            const style = ' style="max-width:100%;"';
            html += `<img src="${src}" alt="${alt}"${style} />`;
          }
        } else if (block.type === 'divider') {
          html += '<hr />';
        }
      }
      return { html, source: 'blocks' };
    }

    // 兜底：description + descriptionImages[]
    if (!product.description) return null;
    let descHTML = '';
    if (product.description.includes('<p>') || product.description.includes('<br')) {
      descHTML = product.description;
    } else {
      descHTML = '<p>' + product.description.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    }
    // Append images to description HTML
    for (const img of descImages) {
      if (!img.isLocal) {
        const style = img.width ? ` style="max-width:${img.width}px;"` : ' style="max-width:100%;"';
        descHTML += `<p><img src="${img.src}" alt="${img.alt}"${style} /></p>`;
      }
    }
    const imgCount = descImages.filter(i => !i.isLocal).length;
    return { html: descHTML, source: 'legacy', imgCount };
  }

  const descData = buildDescriptionHtml();
  if (descData) {
    try {
      const descLabel = shopifyPage.locator('label[for="product-description-rn"]');
      await descLabel.click({ timeout: 5000 });
      await shopifyPage.waitForTimeout(1000);

      const filled = await shopifyPage.evaluate((html) => {
        const editor = window.tinymce.get('product-description-rn');
        if (!editor || !editor.initialized) return false;
        editor.setContent(html);
        editor.fire('change');
        return true;
      }, descData.html);

      if (filled) {
        if (descData.source === 'blocks') {
          const blockCount = (product.descriptionBlocks || []).length;
          const imgBlocks = (product.descriptionBlocks || []).filter(b => b.type === 'image' || b.type === 'img').length;
          const textBlocks = blockCount - imgBlocks;
          console.log(`   ✓ Description filled (${blockCount} blocks: ${textBlocks} text + ${imgBlocks} image)`);
        } else {
          console.log(`   ✓ Description filled${descData.imgCount > 0 ? ' (' + descData.imgCount + ' image(s))' : ''}`);
        }
      } else {
        console.log('   ⚠ TinyMCE editor not ready, skipping description');
      }
    } catch (e) {
      console.log('   ⚠ Description field error: ' + e.message.substring(0, 50));
    }
  }
  
  // Upload local description images to Shopify media, then insert into TinyMCE
  const localDescImages = descImages.filter(i => i.isLocal);
  if (localDescImages.length > 0) {
    console.log('\n🖼️  Uploading description images to media...');
    try {
      // Focus description field
      await shopifyPage.locator('label[for="product-description-rn"]').click({ timeout: 5000 });
      await shopifyPage.waitForTimeout(1000);
      
      for (const localImg of localDescImages) {
        // Set up response listener for CDN URL
        let cdnUrl = null;
        const responsePromise = shopifyPage.waitForResponse(
          r => r.url().includes('admin.shopify.com') && r.request().method() !== 'GET',
          { timeout: 15000 }
        ).catch(() => null);
        
        // Trigger upload via file input
        const fileInput = shopifyPage.locator('input[type="file"]').first();
        await fileInput.setInputFiles(localImg.src);
        
        // Wait for upload to complete
        try {
          await shopifyPage.waitForSelector('[aria-label="媒体文件上传中"]', { state: 'hidden', timeout: 30000 });
        } catch(e) {}
        await shopifyPage.waitForTimeout(2000);
        
        // Try to extract CDN URL from the page state
        cdnUrl = await shopifyPage.evaluate((localPath) => {
          // Look for image URLs in various places
          const allImgs = document.querySelectorAll('img[src*="cdn.shopify.com"], img[src*="/s/files/"]');
          for (const img of allImgs) {
            const src = img.src;
            // Skip Shopify UI icons
            if (!src.includes('vite/') && !src.includes('shopifycloud/web/') && !src.includes('favicon') && !src.includes('logo')) {
              // Check if this looks like a recently uploaded product image
              if (src.match(/\.(webp|png|jpg|jpeg|gif)(\?|$)/)) {
                return src;
              }
            }
          }
          
          // Try reading from hidden form fields
          const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
          for (const inp of hiddenInputs) {
            const val = inp.value || '';
            if (val.includes('cdn.shopify.com') && val.match(/\.(webp|png|jpg|jpeg|gif)/)) {
              return val;
            }
          }
          return null;
        }, localImg.src);
        
        if (cdnUrl) {
          // Insert image into TinyMCE
          await shopifyPage.evaluate((imgData) => {
            const editor = window.tinymce?.get('product-description-rn');
            if (!editor || !editor.initialized) return false;
            const html = `<img src="${imgData.src}" alt="${imgData.alt}" style="max-width:100%;" />`;
            editor.insertContent(html);
            return true;
          }, { src: cdnUrl, alt: localImg.alt });
          console.log(`   ✓ Description image uploaded: ${cdnUrl.substring(0, 60)}...`);
        } else {
          console.log(`   ⚠ Could not get CDN URL for: ${path.basename(localImg.src)}`);
        }
      }
    } catch (e) {
      console.log('   ⚠ Description image upload error: ' + e.message.substring(0, 50));
    }
  }
  
  // Fill price - use keyboard input to trigger React onChange
  if (product.price) {
    try {
      const priceInput = shopifyPage.locator('input[name="price"]').first();
      await priceInput.click();
      await shopifyPage.keyboard.press('Control+A');
      await shopifyPage.keyboard.type(product.price.toString());
      console.log('   ✓ Price filled: $' + product.price);
    } catch (e) {
      console.log('   ⚠ Price field not found, skipping');
    }
  }
  
  // Fill compare at price
  if (product.compareAtPrice) {
    try {
      const compareInput = shopifyPage.locator('input[name="compareAtPrice"]').first();
      if (await compareInput.isVisible()) {
        await compareInput.fill(product.compareAtPrice.toString());
        console.log('   ✓ Compare at price filled: $' + product.compareAtPrice);
      }
    } catch (e) {
      // Ignore
    }
  }

  
  // Set inventory SKU
  if (product.sku) {
    try {
      // Click inventory section
      const invBtn = shopifyPage.locator('button:has-text("库存"), button:has-text("Inventory")').first();
      if (await invBtn.isVisible()) {
        await invBtn.click();
        await shopifyPage.waitForTimeout(500);
      }
      
      const skuInput = shopifyPage.locator('input[name="sku"], input[placeholder*="SKU"]').first();
      if (await skuInput.isVisible()) {
        await skuInput.fill(product.sku);
        console.log('   ✓ SKU filled: ' + product.sku);
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Set status
  if (product.status === 'active') {
    try {
      // Find and click the status dropdown
      const statusBtn = shopifyPage.locator('button:has-text("草稿"), button:has-text("Draft"), button[aria-haspopup="listbox"]').first();
      if (await statusBtn.isVisible()) {
        await statusBtn.click();
        await shopifyPage.waitForTimeout(500);
        const activeOption = shopifyPage.locator('[role="option"]:has-text("已发布"), [role="option"]:has-text("Active")').first();
        if (await activeOption.isVisible()) {
          await activeOption.click();
          console.log('   ✓ Status set to active');
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Save
  console.log('\n💾 Saving product...');
  try {
    const saveBtn = shopifyPage.locator('button:has-text("保存"), button:has-text("Save")').first();
    await saveBtn.waitFor({ state: 'visible', timeout: 5000 });
    
    // Wait until button is enabled (not disabled)
    await shopifyPage.waitForFunction(() => {
      const btn = document.querySelector('button[aria-label="保存"]');
      return btn && !btn.disabled && !btn.getAttribute('aria-disabled');
    }, { timeout: 5000 }).catch(() => {});
    
    await saveBtn.click({ force: true });
    
    // Wait for navigation to product page (URL changes from /new to /ID)
    try {
      await shopifyPage.waitForFunction(() => 
        window.location.href.match(/\/products\/\d+/) && !window.location.href.includes('/products/new'),
        { timeout: 20000 }
      );
    } catch (e) {
      // If URL doesn't change, try waiting for a success indicator
      await shopifyPage.waitForTimeout(3000);
    }
    
    await shopifyPage.waitForTimeout(2000);
    
    const finalUrl = shopifyPage.url();
    const productId = finalUrl.match(/\/products\/(\d+)/);
    
    console.log('\n✅ Product uploaded successfully!');
    console.log(`   URL: ${finalUrl}`);
    if (productId) {
      console.log(`   ID: ${productId[1]}`);
    }
    
    // Take screenshot
    const screenshotPath = path.join(folderPath, `uploaded-${Date.now()}.png`);
    await shopifyPage.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`   Screenshot: ${screenshotPath}`);
    
  } catch (e) {
    console.error(`❌ Failed to save product: ${e.message}`);
    await shopifyPage.screenshot({ path: path.join(folderPath, 'error.png'), fullPage: true });
    console.log('   Screenshot saved to error.png');
  }
  
  await browser.close();
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Shopify Product Uploader
Usage: node upload-product.js <product-folder> [cdp-url]

Arguments:
  product-folder    Product folder name (e.g. 2026-03-19/001)
  cdp-url          Optional CDP WebSocket URL (default: ${CDP_URL})

Environment:
  CDP_URL          Default CDP WebSocket URL

Example:
  node upload-product.js 0001
  CDP_URL=ws://127.0.0.1:40539/devtools/browser/xxx node upload-product.js 0002
`);
  process.exit(0);
}

const folder = args[0];
const cdpUrl = args[1] || process.env.CDP_URL;
if (cdpUrl) {
  process.env.CDP_URL = cdpUrl;
}

uploadProduct(folder).catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
