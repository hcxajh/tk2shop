#!/usr/bin/env node
/**
 * TikTok Shop 商品详情页采集
 * 
 * 采集流程：
 * 1. 滚动页面触发商品数据渲染
 * 2. 提取商品主图 + SKU 变体
 * 3. 点击 Description 展开，获取图文混排的描述内容（HTML含<img>标签）
 * 4. 下载所有图片（主图+SKU缩略图+描述图）
 * 5. 生成 product.json，description 为含本地图片的 HTML
 * 6. 自动生成 Shopify SEO 标题（shopifyTitle 字段）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CDP_URL = process.env.TK_CDP_URL || 'ws://127.0.0.1:44035/devtools/browser/dc10fec1-c52f-446b-a7d6-c769cf12f0a0';
const OUTPUT_DIR = '/root/.openclaw/TKdown';

/**
 * 从原始标题和描述生成 Shopify SEO 友好标题
 * @param {string} originalTitle - 原始标题
 * @param {string} description - 商品描述文字
 * @returns {string} SEO友好标题
 */
function generateShopifyTitle(originalTitle, description) {
  if (!originalTitle) return '';
  
  // 1. 提取品牌（通常是第一个词）
  const firstWord = originalTitle.trim().split(/\s+/)[0];
  const isBrand = firstWord.length > 1 && /^[A-Z][a-zA-Z0-9]*$/.test(firstWord);
  const brand = isBrand ? firstWord : '';
  
  // 2. 从标题和描述中提取产品核心词
  const lowerTitle = originalTitle.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  
  // 定义要查找的卖点关键词（按优先级排序）
  const featurePatterns = [
    // 射程/亮度
    { key: '1000m', label: '1000m Beam', pattern: /1000\s*m(eters?)?\s*(beam|range|throw)/i },
    { key: 'rechargeable', label: 'Rechargeable', pattern: /rechargeable/i },
    { key: 'tactical', label: 'Tactical', pattern: /\btactical\b/i },
    { key: 'zoomable', label: 'Zoomable', pattern: /\bzoom(able)?\b/i },
    { key: 'waterproof', label: 'Waterproof', pattern: /\bwater\ ?proof\b/i },
    { key: '6 modes', label: '6 Modes', pattern: /\b6\s*mode/i },
    { key: '5 modes', label: '5 Modes', pattern: /\b5\s*mode/i },
    // 电池
    { key: '5000mah', label: '5000mAh Battery', pattern: /5000\s*mah/i },
    { key: 'battery', label: 'Battery', pattern: /\bmah\b/i },
    // 用途
    { key: 'camping', label: 'Camping', pattern: /\bcamping\b/i },
    { key: 'outdoor', label: 'Outdoor', pattern: /\boutdoor\b/i },
    { key: 'emergency', label: 'Emergency', pattern: /\bemergency\b/i },
    // LED/亮度
    { key: 'led', label: 'LED', pattern: /\bled\b/i },
    { key: 'ultrabright', label: 'Ultra-Bright', pattern: /\bultra[\s-]?bright\b/i },
    { key: 'high lumen', label: 'High Lumen', pattern: /\bhigh\s*lumen\b/i },
  ];
  
  // 从描述中提取射程（特殊处理，因为这个卖点很强）
  let beamDistance = '';
  const beamMatch = lowerDesc.match(/(\d+)\s*m(eters?)?\s*(beam|range|throw|distance)/i);
  if (beamMatch) {
    beamDistance = beamMatch[1] + 'm Beam';
  }
  
  // 按优先级收集卖点
  const features = new Set();
  
  for (const feat of featurePatterns) {
    if (feat.key === '1000m') {
      if (beamDistance) features.add(beamDistance);
    } else {
      if (feat.pattern.test(lowerTitle) || feat.pattern.test(lowerDesc)) {
        features.add(feat.label);
      }
    }
  }
  
  // 3. 移除冗余的"电池"描述（如果已经有具体mAh数字）
  if (features.has('5000mAh Battery') && features.has('Battery')) {
    features.delete('Battery');
  }
  
  // 4. 构建SEO标题
  // 格式: 品牌 + 产品核心 + 核心卖点 + 用途
  const productCore = 'LED Flashlight';
  
  // 核心卖点列表（保留最多5个，避免太长）
  const topFeatures = [];
  const priorityOrder = ['1000m Beam', 'Rechargeable', 'Tactical', '6 Modes', '5 Modes', 
                        'Zoomable', 'Waterproof', '5000mAh Battery', 'LED', 'Ultra-Bright',
                        'High Lumen', 'Camping', 'Outdoor', 'Emergency', 'Battery'];
  
  for (const feat of priorityOrder) {
    if (features.has(feat) && topFeatures.length < 5) {
      topFeatures.push(feat);
    }
  }
  
  // 用途（最多2个）
  const usageTags = [];
  for (const feat of ['Camping', 'Outdoor', 'Emergency', 'Tactical']) {
    if (features.has(feat) && usageTags.length < 2) {
      usageTags.push(feat);
    }
  }
  
  // 组装标题
  let seoTitle = brand ? brand + ' ' + productCore : productCore;
  
  if (topFeatures.length > 0) {
    seoTitle += ' - ' + topFeatures.join(', ');
  }
  
  if (usageTags.length > 0 && !seoTitle.includes(usageTags[0])) {
    seoTitle += ' for ' + usageTags.join(', ');
  }
  
  // 清理多余的逗号和空格
  seoTitle = seoTitle.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
  
  return seoTitle;
}

// 获取当前日期目录下的最大序号
function getNextSeq(dateDir) {
  const entries = fs.readdirSync(dateDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => parseInt(e.name, 10))
    .filter(n => !isNaN(n));
  return entries.length > 0 ? Math.max(...entries) + 1 : 1;
}

function cleanUrl(url) {
  if (!url) return '';
  return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
}

async function downloadImg(url, dest, retries = 3) {
  if (!url || !url.startsWith('http')) throw new Error('Invalid URL');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
          headers: { Referer: 'https://shop.tiktok.com/', 'User-Agent': 'Mozilla/5.0' }
        }, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            file.close();
            downloadImg(res.headers.location, dest, 1).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode !== 200) { file.close(); reject(new Error('HTTP ' + res.statusCode)); return; }
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(dest); });
        });
        req.on('error', e => { file.close(); reject(e); });
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch (e) {
      if (attempt < retries) {
        console.log(`  ⚠️ 下载失败，重试中 (${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      } else throw e;
    }
  }
}

function extractPriceFromPage(page) {
  return page.evaluate(() => {
    const titleEl = document.querySelector('h2.H2-Semibold, h2[class*="H2-Semibold"]');
    if (!titleEl) return { salePrice: '', originalPrice: '' };
    let container = titleEl;
    for (let j = 0; j < 5; j++) {
      container = container.parentElement;
      if (!container) break;
      const prices = [];
      container.querySelectorAll('*').forEach(el => {
        const t = el.textContent ? el.textContent.trim() : '';
        if (/^\$\d+\.\d{2}$/.test(t)) prices.push(t);
      });
      if (prices.length >= 1) {
        const nums = prices.map(p => parseFloat(p.replace(/[$,]/g, ''))).sort((a, b) => a - b);
        return {
          salePrice: nums[0].toFixed(2),
          originalPrice: nums.length > 1 && nums[nums.length - 1] > nums[0] ? nums[nums.length - 1].toFixed(2) : ''
        };
      }
    }
    return { salePrice: '', originalPrice: '' };
  });
}

async function main() {
  console.log('🔌 连接浏览器...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = browser.contexts()[0].pages()[browser.contexts()[0].pages().length - 1];
  const pageUrl = page.url();
  console.log('🌐', pageUrl);

  // 滚动加载商品数据
  await page.evaluate(() => { window.scrollTo(0, 300); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 800); });
  await page.waitForTimeout(2000);

  // 1. 提取标题
  const title = await page.evaluate(() => {
    return document.querySelector('meta[property="og:title"]')
      ? document.querySelector('meta[property="og:title"]').content.replace(/\s*-\s*TikTok\s*Shop\s*$/, '').trim()
      : '';
  });
  console.log('标题:', title.substring(0, 60));

  // 2. 提取商品主图
  const allImages = await page.evaluate(() => {
    function cleanUrl(url) {
      if (!url) return '';
      return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
    }
    const containers = document.querySelectorAll('[class*="items-center"][class*="gap-12"][class*="overflow-visible"]');
    let galleryEl = null;
    for (const el of containers) {
      if (el.className.includes('flex-row')) { galleryEl = el; break; }
    }
    if (!galleryEl) return [];
    const imgs = galleryEl.querySelectorAll('picture img, img');
    const urls = [];
    for (const img of imgs) {
      const src = img.src || (img.getAttribute('srcset') || '').split(',')[0].split(' ')[0] || '';
      if (src.includes('ttcdn') && !src.includes('logo') && !src.includes('icon')) {
        const clean = cleanUrl(src);
        if (clean.match(/\.(webp|jpg|png)/i) && !urls.includes(clean)) urls.push(clean);
      }
    }
    return urls;
  });
  console.log('主图数:', allImages.length);

  // 3. 提取 SKU 变体
  const skuVariants = await page.evaluate(() => {
    function cleanUrl(url) {
      if (!url) return '';
      return url.replace(/~tplv[^\/]+\//, '').split('?')[0];
    }
    const container = document.querySelector('[class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]');
    if (!container) return [];
    const children = [...container.children];
    return children.map((child, idx) => {
      const text = child.innerText ? child.innerText.trim() : '';
      const img = child.querySelector('img');
      const imgSrc = img ? (img.src || (img.getAttribute('srcset') || '').split(',')[0].split(' ')[0] || '') : '';
      const cleanImg = imgSrc.includes('ttcdn') ? cleanUrl(imgSrc) : '';
      return { index: idx, name: text || 'SKU ' + (idx + 1), thumbnail: cleanImg };
    });
  });
  console.log('SKU 变体:', skuVariants.map(s => s.name).join(', '));

  // 4. 点击每个 SKU，获取价格
  console.log('💡 点击每个 SKU 并提取价格...');
  const skuDetails = [];

  for (let i = 0; i < skuVariants.length; i++) {
    const clicked = await page.evaluate((idx) => {
      const container = document.querySelector('[class*="flex-row"][class*="overflow-x-auto"][class*="gap-12"][class*="flex-wrap"]');
      if (!container) return false;
      const children = [...container.children];
      if (!children[idx]) return false;
      children[idx].click();
      return true;
    }, i);
    await page.waitForTimeout(800);

    const priceData = await extractPriceFromPage(page);
    skuDetails.push({
      sku: skuVariants[i].name,
      thumbnail: skuVariants[i].thumbnail,
      price: priceData.salePrice,
      compareAtPrice: priceData.originalPrice,
      detail: '',
      inventoryQuantity: 100
    });
    console.log('  ' + skuVariants[i].name + ': $' + priceData.salePrice + (priceData.originalPrice ? ' → $' + priceData.originalPrice : ''));
  }

  // 5. ★ 提取图文混排的描述内容 ★
  console.log('\n📝 提取图文混排描述内容...');
  
  // 回到顶部，点击 Description 展开
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  
  const descBtnClicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.innerText.includes('Description') || span.innerText.includes('Details')) {
        span.click();
        return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(1500);
  
  if (!descBtnClicked) {
    console.log('⚠️ 未找到 Description 按钮，尝试备用方式...');
  }

  // 获取图文混排描述 HTML 和图片列表
  const descResult = await page.evaluate(() => {
    const results = { html: '', images: [], text: '' };
    
    // 找到 overflow-hidden + transition-all 的 div
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const cn = div.className || '';
      if (cn.includes('overflow-hidden') && cn.includes('transition-all')) {
        // 获取纯文本
        results.text = div.innerText || '';
        
        // 获取所有图片
        const imgs = div.querySelectorAll('img');
        for (const img of imgs) {
          const src = img.src || img.getAttribute('data-src') || '';
          if (src && !src.includes('favicon') && !src.includes('logo') && !src.includes('tts_logo') && img.naturalWidth > 50) {
            // 转为原始分辨率 URL
            let origUrl = src
              .replace(/~tplv-fhlh96nyum-crop-webp:\d+:\d+\.webp/, '~tplv-fhlh96nyum-origin-webp.webp')
              .replace(/~tplv-fhlh96nyum-crop-webp:\d+:\d+\.jpeg/, '~tplv-fhlh96nyum-origin-jpeg.jpeg')
              .replace(/~tplv-fhlh96nyum-resize-png:\d+:\d+\.png/, '~tplv-fhlh96nyum-origin-png.png');
            results.images.push(origUrl);
          }
        }
        
        // 获取内部 HTML，替换图片 src 为占位符（后续替换为本地文件名）
        results.html = div.innerHTML || '';
        break;
      }
    }
    
    return results;
  });
  
  console.log('描述文字长度:', descResult.text.length, '字符');
  console.log('描述图片数:', descResult.images.length);
  
  // 6. 生成目录
  const today = new Date().toISOString().split('T')[0];
  const productId = pageUrl.match(/\/(\d+)\?/) ? pageUrl.match(/\/(\d+)\?/)[1] : Date.now().toString();
  const dateDir = path.join(OUTPUT_DIR, today);
  fs.mkdirSync(dateDir, { recursive: true });
  const nextSeq = getNextSeq(dateDir);
  const seqStr = String(nextSeq).padStart(3, '0');
  const outDir = path.join(dateDir, seqStr);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'desc-images'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'sku'), { recursive: true });
  console.log('\n📁 输出目录:', outDir);

  // 7. 下载主图
  console.log('\n📥 下载主图...');
  const downloaded = [];
  for (let i = 0; i < allImages.length; i++) {
    const ext = allImages[i].match(/\.(webp|png|jpg)(\?|$)/i)
      ? allImages[i].match(/\.(webp|png|jpg)/i)[1]
      : 'jpg';
    const filename = String(i + 1).padStart(3, '0') + '.' + ext;
    try {
      await downloadImg(allImages[i], path.join(outDir, 'images', filename));
      downloaded.push(filename);
      console.log('  ✅ ' + filename);
    } catch (e) {
      console.log('  ❌ ' + filename + ' 失败: ' + e.message);
    }
  }

  // 下载 SKU 缩略图
  for (let i = 0; i < skuDetails.length; i++) {
    if (skuDetails[i].thumbnail) {
      const ext = skuDetails[i].thumbnail.match(/\.(webp|png|jpg)(\?|$)/i)
        ? skuDetails[i].thumbnail.match(/\.(webp|png|jpg)/i)[1]
        : 'jpg';
      const filename = 'sku_' + String(i + 1).padStart(2, '0') + '_' + skuDetails[i].sku.replace(/[^a-zA-Z0-9]/g, '_') + '.' + ext;
      try {
        await downloadImg(skuDetails[i].thumbnail, path.join(outDir, 'sku', filename));
        skuDetails[i].thumbnailFile = filename;
        console.log('  ✅ SKU缩略图: ' + filename);
      } catch (e) {
        console.log('  ⚠️ SKU缩略图: ' + filename + ' 失败');
      }
    }
  }

  // 下载描述图片，替换 HTML 中的图片 URL 为本地文件名
  console.log('\n📥 下载描述图片...');
  let descHtmlModified = descResult.html;
  const descImages = [];
  
  // 从 HTML 中直接提取真实存在的图片 URL（带尺寸参数的原版 URL）
  const htmlImgUrls = [];
  const imgSrcSet = {};
  
  // 用正则从 HTML 中提取所有 img 标签的 src 和 srcset
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(descResult.html)) !== null) {
    const fullTag = match[0];
    const src = match[1];
    
    // 提取 srcset 如果有
    const srcsetMatch = fullTag.match(/srcset=["']([^"']+)["']/i);
    let hiResUrl = src;
    
    if (srcsetMatch) {
      // srcset 格式: url size, url size, ...
      const parts = srcsetMatch[1].split(',').map(p => p.trim());
      // 找最大尺寸的 URL
      let maxSize = 0;
      for (const part of parts) {
        const urlPart = part.split(' ')[0];
        const sizeMatch = part.match(/(\d+)w/);
        const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
        if (size >= maxSize && urlPart.includes('ttcdn')) {
          maxSize = size;
          hiResUrl = urlPart;
        }
      }
    }
    
    if (src && !src.includes('favicon') && !src.includes('logo') && !src.includes('tts_logo')) {
      // 去重（同一个 URL 可能出现多次）
      if (!imgSrcSet[src]) {
        imgSrcSet[src] = hiResUrl !== src ? hiResUrl : src;
      }
    }
  }
  
  // 遍历去重后的 URL，下载并记录映射
  const downloadedUrls = [];
  for (const [origUrl, hiResUrl] of Object.entries(imgSrcSet)) {
    if (downloadedUrls.includes(origUrl)) continue;
    downloadedUrls.push(origUrl);
    
    // 优先用高分辨率版本
    const downloadUrl = hiResUrl && hiResUrl !== origUrl && hiResUrl.startsWith('http') ? hiResUrl : origUrl;
    const ext = downloadUrl.match(/\.(jpeg|jpg|png|webp)(\?|$)/i)
      ? downloadUrl.match(/\.(jpeg|jpg|png|webp)/i)[1]
      : 'jpg';
    const filename = 'desc_' + String(descImages.length + 1).padStart(3, '0') + '.' + ext;
    
    try {
      await downloadImg(downloadUrl, path.join(outDir, 'desc-images', filename));
      descImages.push('desc-images/' + filename);
      console.log('  ✅ desc-images/' + filename + ' (' + origUrl.substring(0, 50) + '...)');
      
      // 替换 HTML 中的这个 URL（原始尺寸 URL）为本地文件名
      // 同时处理 src 和 srcset
      const escapedSrc = origUrl.replace(/[.?*+^$|\\[\]{}()]/g, '\\$&');
      descHtmlModified = descHtmlModified.replace(new RegExp(escapedSrc, 'g'), 'desc-images/' + filename);
      
      // srcset 中的 URL 也替换
      if (hiResUrl && hiResUrl !== origUrl) {
        const escapedHiRes = hiResUrl.replace(/[.?*+^$|\\[\]{}()]/g, '\\$&');
        descHtmlModified = descHtmlModified.replace(new RegExp(escapedHiRes, 'g'), 'desc-images/' + filename);
      }
    } catch (e) {
      console.log('  ❌ ' + filename + ' 失败: ' + e.message);
    }
  }
  
  // 清理 HTML：移除 TikTok 内部标签、样式、脚本
  let cleanDescHtml = descHtmlModified
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/class="[^"]*"/g, '')
    .replace(/data-[a-z-]+="[^"]*"/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 8. 生成 product.json
  const defaultPrice = skuDetails.length > 0 && skuDetails[0].price ? skuDetails[0].price : '';
  const defaultCompareAt = skuDetails.length > 0 && skuDetails[0].compareAtPrice ? skuDetails[0].compareAtPrice : '';

  // 9. 生成 Shopify SEO 标题
  const shopifyTitle = generateShopifyTitle(title, descResult.text);

  const productJson = {
    title: title,                        // 原始标题
    shopifyTitle: shopifyTitle,          // ★ Shopify SEO 优化标题
    descriptionHtml: cleanDescHtml,       // ★ 图文混排 HTML 版本
    price: defaultPrice,
    compareAtPrice: defaultCompareAt,
    sku: 'TK-' + productId,
    status: 'active',
    images: downloaded,
    descriptionImages: descImages,         // ★ 描述图片文件名列表
    _meta: {
      productId: productId,
      seq: seqStr,
      sourceUrl: pageUrl,
      source: 'tiktok-shop-detail',
      extractedAt: new Date().toISOString(),
      skus: skuDetails.map(s => ({
        name: s.sku,
        thumbnail: s.thumbnailFile || '',
        price: s.price,
        compareAtPrice: s.compareAtPrice,
        inventoryQuantity: s.inventoryQuantity
      }))
    }
  };

  fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(productJson, null, 2));

  console.log('\n✅ 完成！');
  console.log('📁 ' + outDir);
  console.log('🏷️ 原始标题: ' + title.substring(0, 60));
  console.log('🏷️ Shopify标题: ' + shopifyTitle.substring(0, 70));
  console.log('💰 $' + defaultPrice + (defaultCompareAt ? ' → $' + defaultCompareAt : ''));
  console.log('🖼️  主图: ' + downloaded.length + ' 张 | 描述图: ' + descImages.length + ' 张');
  console.log('📦 SKU: ' + skuDetails.length + ' 个');
  console.log('📝 描述文字: ' + descResult.text.length + ' 字符');
  browser.close();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
