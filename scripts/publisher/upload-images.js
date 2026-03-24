#!/usr/bin/env node
/**
 * upload-images.js - 上传本地图片到 Shopify Media，获取 CDN URL
 * 
 * 流程：
 * 1. 连接 AdsPower 浏览器（已打开状态）
 * 2. 进入 Shopify 新建商品页
 * 3. 逐个上传图片到 Media
 * 4. 提取 CDN URL 并写入 CSV
 * 
 * 用法: node upload-images.js <商品目录> [--store <店铺名>]
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown';
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json');

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ============================================================
// AdsPower 控制
// ============================================================
function openBrowser(profileNo) {
  const { execSync } = require('child_process');
  try {
    const out = execSync(`npx --yes adspower-browser open-browser '{"profileNo":"${profileNo}"}' 2>&`, {encoding:'utf8', timeout:90000});
    const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
    if (match) return match[1];
  } catch (e) {}
  return null;
}

function getCDPUrl(profileNo) {
  const { execSync } = require('child_process');
  try {
    const out = execSync(`npx --yes adspower-browser get-browser-active '{"profileNo":"${profileNo}"}' 2>&`, {encoding:'utf8', timeout:15000});
    const match = out.match(/"puppeteer":\s*"(ws:\/\/[^"]+)"/);
    if (match) return match[1];
  } catch (e) {}
  return null;
}

// ============================================================
// 上传图片到 Shopify Media
// ============================================================
async function uploadImages(cdpUrl, imagePaths, shopSlug) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const ctx = browser.contexts()[0];
  const pg = await ctx.newPage();
  
  const results = [];
  
  try {
    // 进入产品列表页
    log('🌐 打开产品列表页...');
    await pg.goto(`https://admin.shopify.com/store/${shopSlug}/products`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    });
    await pg.waitForTimeout(3000);
    
    // 点击 Add product
    log('🖱️ 点击添加产品...');
    try {
      await pg.click('a:has-text("添加产品"), a[href*="/products/new"]');
    } catch (e) {
      log('点击添加产品失败，尝试直接导航...');
      await pg.goto(`https://admin.shopify.com/store/${shopSlug}/products/new`, {
        waitUntil: 'domcontentloaded', timeout: 20000
      });
      await pg.waitForTimeout(8000);
    }
    await pg.waitForTimeout(5000);
    
    // 等待 Media 上传区域出现
    log('⏳ 等待页面上传区域...');
    try {
      await pg.waitForSelector('input#\\:r1f', { timeout: 15000 });
    } catch (e) {
      log('未找到上传 input，保存截图...');
      await pg.screenshot({ path: '/tmp/shopify_upload_debug.png' });
      throw e;
    }
    
    log('📤 开始上传图片...');
    
    for (let i = 0; i < imagePaths.length; i++) {
      const imgPath = imagePaths[i];
      const filename = path.basename(imgPath);
      log(`  [${i+1}/${imagePaths.length}] ${filename}`);
      
      try {
        // 使用 setInputFiles 上传
        await pg.waitForSelector('input#\\:r1f', { timeout: 5000 });
        await pg.locator('input#\\:r1f').setInputFiles(imgPath);
        
        // 等待上传完成（等待网络请求 or 等待图片出现在 DOM）
        await pg.waitForTimeout(3000);
        
        // 从页面提取最新的 CDN URL
        const cdnUrl = await extractLatestImageUrl(pg);
        
        if (cdnUrl) {
          results.push({ path: imgPath, url: cdnUrl, index: i + 1 });
          log(`    ✅ ${cdnUrl.slice(0, 80)}...`);
        } else {
          results.push({ path: imgPath, url: null, index: i + 1 });
          log(`    ⚠️ 未获取到 URL`);
        }
      } catch (e) {
        results.push({ path: imgPath, url: null, index: i + 1 });
        log(`    ❌ ${e.message.slice(0, 60)}`);
      }
      
      // 每张图间隔 1 秒，避免太快
      if (i < imagePaths.length - 1) await pg.waitForTimeout(1000);
    }
    
  } finally {
    await browser.close();
  }
  
  return results;
}

// ============================================================
// 从页面提取最新上传的图片 CDN URL
// ============================================================
async function extractLatestImageUrl(pg) {
  try {
    // 方法1: 从 DOM 提取 cdn.shopify.com 图片
    const imgs = await pg.evaluate(() => {
      const els = document.querySelectorAll('img[src*="cdn.shopify.com"], img[src*="product-images"]');
      return Array.from(els).map(el => {
        const src = el.src || el.getAttribute('src') || '';
        // 只取静态图片 URL
        if (src.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)) {
          return src.split('?')[0];
        }
        return '';
      }).filter(Boolean);
    });
    
    if (imgs.length > 0) {
      // 返回最后一张（最新上传的）
      return imgs[imgs.length - 1];
    }
    
    // 方法2: 从 CSS 变量或 data 属性提取
    const bgImgs = await pg.evaluate(() => {
      const styleMatch = document.body.innerHTML.match(/url\(['"]?(https:\/\/cdn\.shopify\.com[^'")]+)/gi);
      if (styleMatch) {
        return styleMatch.map(m => m.replace(/url\(['"]?/, '').replace(/['"]?$/, '').split('?')[0]);
      }
      return [];
    });
    
    if (bgImgs.length > 0) return bgImgs[bgImgs.length - 1];
    
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  let folder = '', storeQuery = '';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store' && args[i+1]) storeQuery = args[++i];
    else if (args[i].includes('/')) folder = args[i];
  }
  
  if (!folder) {
    console.error('❌ 请指定商品目录');
    console.log('用法: node upload-images.js <目录> [--store <店铺名>]');
    console.log('示例: node upload-images.js 2026-03-23/023 --store default');
    process.exit(1);
  }
  
  // 加载店铺配置
  let stores = [];
  try { stores = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')).stores || []; }
  catch (e) { log('未找到 stores.json，使用默认值'); }
  
  const store = stores.find(s =>
    storeQuery && (String(s.profileNo) === storeQuery || (s.name||'').toLowerCase().includes(storeQuery.toLowerCase()))
  ) || stores[0];
  
  if (!store) { console.error('❌ 未找到店铺'); process.exit(1); }
  
  log(`🏪 店铺: ${store.name || store.storeId} (profileNo: ${store.profileNo})`);
  log(`📁 商品目录: ${folder}`);
  
  // 获取图片列表
  const imagesDir = path.join(TK_OUTPUT_DIR, folder, 'images');
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ 图片目录不存在: ${imagesDir}`);
    process.exit(1);
  }
  
  const imageFiles = fs.readdirSync(imagesDir)
    .filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
    .sort()
    .map(f => path.join(imagesDir, f));
  
  log(`📷 图片数量: ${imageFiles.length} 张`);
  
  if (imageFiles.length === 0) {
    console.error('❌ 没有找到图片');
    process.exit(1);
  }
  
  // 获取 CDP URL
  log('🔌 获取 CDP URL...');
  let cdpUrl = getCDPUrl(store.profileNo);
  if (!cdpUrl) {
    log('浏览器未运行，打开新浏览器...');
    const newCdp = openBrowser(store.profileNo);
    if (!newCdp) { console.error('❌ 无法打开浏览器'); process.exit(1); }
    // 等待浏览器完全启动
    await new Promise(r => setTimeout(r, 5000));
    cdpUrl = getCDPUrl(store.profileNo);
    if (!cdpUrl) { console.error('❌ 无法获取 CDP URL'); process.exit(1); }
  }
  
  log(`✅ CDP: ${cdpUrl}`);
  
  const shopSlug = store.shopifySlug || store.storeId || 'vellin1122';
  
  // 上传图片
  const results = await uploadImages(finalCdpUrl, imageFiles, shopSlug);
  
  // 输出结果
  log('\n=== 上传结果 ===');
  results.forEach(r => {
    const status = r.url ? '✅' : '❌';
    log(`${status} ${path.basename(r.path)} → ${r.url || '失败'}`);
  });
  
  // 统计
  const success = results.filter(r => r.url).length;
  log(`\n📊 成功: ${success}/${results.length}`);
  
  // 保存 URL 映射
  const urlPath = path.join(TK_OUTPUT_DIR, folder, 'image_urls.json');
  fs.writeFileSync(urlPath, JSON.stringify(results, null, 2));
  log(`💾 URL 映射已保存: ${urlPath}`);
  
  return results;
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
