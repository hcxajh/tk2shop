#!/usr/bin/env node
/**
 * TikTok Shop 采集子代理 - 运行器
 * 
 * 用法：
 *   node runner.js '{"tiktokUrl": "https://shop.tiktok.com/..."}'
 *   TK_TIKTOK_URL="..." node runner.js
 * 
 * 流程：
 * 1. 解析参数（TikTok URL）
 * 2. 从 AdsPower 获取可用浏览器配置
 * 3. 打开浏览器，获取 CDP URL
 * 4. 导航到商品页，执行采集
 * 5. 保存结果
 * 6. 关闭浏览器
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================
// 配置
// ============================================================
const ADSPOWER_API_KEY = process.env.TK_ADSPOWER_API_KEY || '517b8a7eddc3e977182ae37d19430b8b003dbc5f7b8ec1e2';
const OUTPUT_DIR = process.env.TK_OUTPUT_DIR || '/root/.openclaw/TKdown';

// 从本地配置文件读取可用配置文件池
const PROFILE_POOL_FILE = path.join(__dirname, 'profile-pool.json');
let PROFILE_POOL = [1896381, 1896382, 1896383, 1896384, 1896385,
                    1896386, 1896387, 1896388, 1896389, 1896390]; // 默认值
try {
  if (fs.existsSync(PROFILE_POOL_FILE)) {
    const config = JSON.parse(fs.readFileSync(PROFILE_POOL_FILE, 'utf8'));
    if (config.profiles && Array.isArray(config.profiles) && config.profiles.length > 0) {
      PROFILE_POOL = config.profiles;
      log(`📋 已加载配置文件池: ${PROFILE_POOL.join(', ')}`);
    }
  }
} catch (e) {
  log(`⚠️ 读取配置文件池失败，使用默认值: ${e.message}`);
}

// ============================================================
// 工具函数
// ============================================================

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
}

// 文件锁：确保同一时刻只有一个进程使用某个 profile
const LOCK_DIR = '/tmp/tk2shop-locks';
function acquireLock(profileNo) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const lockFile = path.join(LOCK_DIR, `profile-${profileNo}.lock`);
  const maxWait = 60000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      return lockFile;
    } catch (e) {
      if (e.code === 'EEXIST') {
        // 锁被占用，检查持有者进程是否还活着
        let holderPid = null;
        try {
          holderPid = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
        } catch (readErr) {
          // 读不到锁文件，说明刚被删了，重试
          continue;
        }
        try {
          process.kill(holderPid, 0);
        } catch {
          // 进程已死，删除旧锁重试
          try { fs.unlinkSync(lockFile); } catch {}
          continue;
        }
        // 进程还活着，等2秒
        const waitUntil = Date.now() + 2000;
        while (Date.now() < waitUntil) {}
        continue;
      }
      throw e;
    }
  }
  throw new Error(`获取 profile ${profileNo} 锁超时`);
}

function releaseLock(lockFile) {
  try { fs.unlinkSync(lockFile); } catch {}
}

function isProfileActive(profileNo) {
  try {
    const out = execSync(
      `npx --yes adspower-browser get-browser-active '${JSON.stringify(String(profileNo))}' 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    );
    return out.includes('"status": "Active"');
  } catch (e) {
    return false;
  }
}

function findAvailableProfile() {
  // 用 get-browser-active 逐个检查配置文件是否空闲
  for (const profileNo of PROFILE_POOL) {
    if (!isProfileActive(profileNo)) {
      log(`   配置文件 ${profileNo} 空闲`);
      return profileNo;
    }
    log(`   配置文件 ${profileNo} 忙碌，跳过`);
  }
  // 如果都满了，返回第一个（让它排队）
  log('⚠️ 所有配置文件均在使用中，复用第一个');
  return PROFILE_POOL[0];
}

function openBrowser(profileNo) {
  log(`🔓 打开 AdsPower 浏览器 (profileNo: ${profileNo})...`);
  // 构造正确的 JSON: {"profileNo": "1896381"}
  const jsonArg = `{"profileNo":"${profileNo}"}`;
  const out = execSync(
    `npx --yes adspower-browser open-browser '${jsonArg}' 2>&1`,
    { encoding: 'utf8', timeout: 60000 }
  );
  log('   ' + out.trim().split('\n').slice(-2).join(' '));
  
  // 解析CDP URL
  const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
  if (!match) throw new Error('无法获取 CDP URL: ' + out);
  return match[1];
}

function closeBrowser(profileNo) {
  try {
    log(`🔒 关闭浏览器 (profileNo: ${profileNo})...`);
    const jsonArg = `{"profileNo":"${profileNo}"}`;
    execSync(`npx --yes adspower-browser close-browser '${jsonArg}' 2>&1`, { timeout: 30000 });
  } catch (e) {
    log('   关闭浏览器时出错（可忽略）: ' + e.message.slice(0, 80));
  }
}

function downloadImg(url, dest, retries = 2) {
  if (!url || !url.startsWith('http')) return false;
  try {
    execSync(`curl -sL -o "${dest}" -m 20 "${url}"`, { timeout: 25000 });
    const sz = fs.statSync(dest).size;
    return sz > 1000; // 小于1KB视为无效
  } catch (e) {
    return false;
  }
}

function cleanDescImgUrl(url) {
  if (!url) return '';
  return url
    .replace(/~tplv-([a-z0-9]+)-crop-webp:(\d+):(\d+)\.webp/gi, '~tplv-$1-origin.webp')
    .replace(/~tplv-([a-z0-9]+)-crop-jpeg:(\d+):(\d+)\.jpeg/gi, '~tplv-$1-origin.jpeg')
    .replace(/~tplv-([a-z0-9]+)-crop-jpg:(\d+):(\d+)\.jpg/gi, '~tplv-$1-origin.jpg')
    .replace(/~tplv-([a-z0-9]+)-resize-png:(\d+):(\d+)\.png/gi, '~tplv-$1-origin.png');
}

function getNextSeq(dateDir) {
  if (!fs.existsSync(dateDir)) return 1;
  const entries = fs.readdirSync(dateDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => parseInt(e.name, 10))
    .filter(n => !isNaN(n));
  return entries.length > 0 ? Math.max(...entries) + 1 : 1;
}

// ============================================================
// 采集主流程
// ============================================================
async function extract(cdpUrl, tiktokUrl) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();

  log(`🌐 导航到: ${tiktokUrl}`);
  await page.goto(tiktokUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 300); });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.scrollTo(0, 800); });
  await page.waitForTimeout(2000);

  // 1. 标题
  const title = await page.evaluate(() => {
    const el = document.querySelector('meta[property="og:title"]');
    return el ? el.content.replace(/\s*-\s*TikTok\s*Shop\s*$/, '').trim() : '';
  });
  log(`📝 标题: ${title.slice(0, 60)}`);

  // 2. 主图
  const mainImages = await page.evaluate(() => {
    const container = document.querySelector('[class*="items-center"][class*="gap-12"]');
    if (!container) return [];
    const imgs = container.querySelectorAll('img');
    const urls = [];
    for (const img of imgs) {
      const src = img.currentSrc || img.src;
      if (src && src.includes('ttcdn') && !src.includes('logo') && !src.includes('icon') && img.naturalWidth > 100) {
        const clean = src.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg');
        if (!urls.includes(clean)) urls.push(clean);
      }
    }
    return urls;
  });
  log(`🖼️  主图: ${mainImages.length} 张`);

  // 3. SKU
  const skuVariants = await page.evaluate(() => {
    const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
    if (!container) return [];
    return [...container.children].map((child, idx) => {
      const text = child.innerText ? child.innerText.split('\n')[0].trim() : '';
      const img = child.querySelector('img');
      const imgSrc = img ? (img.currentSrc || img.src || '') : '';
      const cleanImg = imgSrc.includes('ttcdn')
        ? imgSrc.replace(/~tplv-[^/]+\/([^/]+)~.*$/, '~tplv-$1/origin.jpeg') : '';
      return { index: idx, name: text || 'SKU ' + (idx + 1), thumbnail: cleanImg };
    }).filter(v => v.name && v.name.length < 100);
  });
  log(`📦 SKU: ${skuVariants.length} 个`);
  skuVariants.forEach(v => log(`   - ${v.name}`));

  // 4. SKU价格和划线价
  const skuDetails = [];
  for (let i = 0; i < skuVariants.length; i++) {
    await page.evaluate((idx) => {
      const container = document.querySelector('[class*="flex-row"][class*="flex-wrap"]');
      if (!container) return;
      const children = [...container.children];
      if (children[idx]) children[idx].click();
    }, i);
    await page.waitForTimeout(1000);
    // 滚动到价格区域确保可见
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const priceData = await page.evaluate(() => {
      let currentPrice = '';
      let compareAtPrice = '';

      // 从 items-baseline 容器提取价格
      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        const cn = div.className || '';
        if (cn.includes('items-baseline')) {
          const text = div.innerText || '';
          // innerText如: "-47%\n$\n15\n.80\n$29.99"
          // 分段拼接：把所有数字/小数点/$拼成完整价格
          const segments = text.split('\n').map(l => l.trim()).filter(l => l);
          let result = '';
          const prices = [];

          for (const seg of segments) {
            if (/^\$[\d.]+$/.test(seg)) {
              // 完整价格：先结算之前的，再记录新的
              if (result) prices.push(result);
              result = seg;
            } else if (seg === '$') {
              if (result) prices.push(result);
              result = '$';
            } else if (/^[\d.]+$/.test(seg)) {
              result += seg;
            }
          }
          if (result) prices.push(result); // 别忘了最后一个

          // prices如 ['$15.80', '$29.99']
          if (prices.length >= 2) {
            currentPrice = prices[0].replace('$', '');
            compareAtPrice = prices[1].replace('$', '');
          } else if (prices.length === 1) {
            currentPrice = prices[0].replace('$', '');
          }
          break;
        }
      }

      // 兜底：扫所有span找价格
      if (!currentPrice) {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
          const t = s.innerText.trim();
          if (/^\$[\d.]+$/.test(t)) {
            currentPrice = t.replace('$', '');
            break;
          }
        }
      }

      return { currentPrice, compareAtPrice };
    });
    skuDetails.push({
      name: skuVariants[i].name,
      thumbnail: skuVariants[i].thumbnail,
      price: priceData.currentPrice,
      compareAtPrice: priceData.compareAtPrice,
      detail: ''
    });
    console.log(`   💰 ${skuVariants[i].name}: 现价$${priceData.currentPrice} 划线价$${priceData.compareAtPrice}`);
  }

  // 5. 描述图文
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  const descBtnClicked = await page.evaluate(() => {
    const spans = document.querySelectorAll('span');
    for (const span of spans) {
      if (span.innerText.includes('Description') || span.innerText.includes('Details')) {
        span.click(); return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(1500);
  log(`📝 描述展开: ${descBtnClicked ? '✅' : '⚠️'}`);

  const descResult = await page.evaluate(() => {
    const result = { text: '', images: [] };
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const cn = div.className || '';
      if (cn.includes('overflow-hidden') && cn.includes('transition-all')) {
        result.text = div.innerText || '';
        const imgs = div.querySelectorAll('img');
        for (const img of imgs) {
          if (img.naturalWidth < 50) continue;
          const src = img.currentSrc || img.src;
          if (src && !src.includes('favicon') && !src.includes('logo') && !src.includes('tts_logo') && src.includes('ttcdn')) {
            result.images.push(src);
          }
        }
        break;
      }
    }
    return result;
  });
  log(`📝 描述文字: ${descResult.text.length} 字符`);
  log(`📝 描述图片: ${descResult.images.length} 张`);

  await browser.close();
  return { title, mainImages, skuDetails, descResult };
}

// ============================================================
// 主程序
// ============================================================
async function main() {
  // 解析参数
  let tiktokUrl = process.env.TK_TIKTOK_URL || '';
  if (process.argv[2]) {
    try {
      const args = JSON.parse(process.argv[2]);
      tiktokUrl = args.tiktokUrl || args.url || args.link || '';
    } catch (e) {
      tiktokUrl = process.argv[2];
    }
  }
  
  if (!tiktokUrl || !tiktokUrl.includes('/pdp/')) {
    console.error('❌ 缺少 TikTok 商品链接参数');
    console.error('用法: node runner.js \'{"tiktokUrl": "https://shop.tiktok.com/..."}\'');
    process.exit(1);
  }

  log(`🎯 开始采集: ${tiktokUrl}`);

  // 1. 找可用配置文件
  const profileNo = process.env.TK_ADSPOWER_PROFILE 
    ? parseInt(process.env.TK_ADSPOWER_PROFILE) 
    : findAvailableProfile();
  log(`🖥️  使用配置文件: ${profileNo}`);

  let cdpUrl = '';
  let lockFile = '';
  try {
    // 获取文件锁，防止多进程抢同一 profile
    lockFile = acquireLock(profileNo);
    log(`🔒 锁定 profile ${profileNo}`);

    // 2. 打开浏览器
    cdpUrl = openBrowser(profileNo);
    log(`🔌 CDP: ${cdpUrl}`);

    // 3. 执行采集
    const data = await extract(cdpUrl, tiktokUrl);

    // 4. 创建输出目录
    const today = new Date().toISOString().split('T')[0];
    const productId = tiktokUrl.match(/\/(\d+)(?:\?.*)?$/)
      ? tiktokUrl.match(/\/(\d+)(?:\?.*)?$/)[1]
      : Date.now().toString();
    const dateDir = path.join(OUTPUT_DIR, today);
    fs.mkdirSync(dateDir, { recursive: true });
    const seq = getNextSeq(dateDir);
    const seqStr = String(seq).padStart(3, '0');
    const outDir = path.join(dateDir, seqStr);
    fs.mkdirSync(path.join(outDir, 'images'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'sku'), { recursive: true });
    log(`📁 输出目录: ${outDir}`);

    // 5. 下载主图
    const downloadedMain = [];
    for (let i = 0; i < data.mainImages.length; i++) {
      const ext = data.mainImages[i].includes('.png') ? 'png' : 'jpg';
      const filename = String(i + 1).padStart(3, '0') + '.' + ext;
      const ok = downloadImg(data.mainImages[i], path.join(outDir, 'images', filename));
      if (ok) {
        downloadedMain.push(filename);
        log(`   ✅ 主图 ${filename}`);
      } else {
        log(`   ❌ 主图 ${filename} 失败`);
      }
    }

    // 6. 下载SKU缩略图
    for (let i = 0; i < data.skuDetails.length; i++) {
      if (data.skuDetails[i].thumbnail) {
        const safeName = data.skuDetails[i].name.replace(/[\/\\:*?"<>|]/g, '_');
        const filename = `sku_${String(i + 1).padStart(2, '0')}_${safeName}.jpg`;
        const ok = downloadImg(data.skuDetails[i].thumbnail, path.join(outDir, 'sku', filename));
        if (ok) {
          data.skuDetails[i].thumbnailFile = filename;
          log(`   ✅ SKU ${filename}`);
        }
      }
    }

    // 7. 下载描述图
    const descImages = [];
    for (let i = 0; i < data.descResult.images.length; i++) {
      const rawUrl = data.descResult.images[i];
      const cleanUrl = cleanDescImgUrl(rawUrl);
      const ext = cleanUrl.includes('.png') ? 'png' : 'jpeg';
      const filename = `desc_${String(i + 1).padStart(3, '0')}.${ext}`;
      const dest = path.join(outDir, 'images', filename);
      let ok = downloadImg(cleanUrl, dest);
      if (!ok) ok = downloadImg(rawUrl, dest); // fallback原始URL
      if (ok && fs.statSync(dest).size > 1000) {
        descImages.push(filename);
        log(`   ✅ 描述图 ${filename} (${fs.statSync(dest).size}B)`);
      } else {
        log(`   ❌ 描述图 ${i+1} 失败`);
      }
    }

    // 8. 生成 product.json
    const allImages = [...downloadedMain, ...descImages];
    const product = {
      title: data.title,
      description: data.descResult.text,
      price: data.skuDetails[0]?.price || '',
      compareAtPrice: data.skuDetails[0]?.compareAtPrice || '',
      sku: 'TK-' + productId,
      status: 'active',
      images: allImages,
      descriptionImages: descImages,
      _meta: {
        productId,
        seq: seqStr,
        sourceUrl: tiktokUrl,
        source: 'tiktok-shop-detail',
        extractedAt: new Date().toISOString(),
        skus: data.skuDetails.map(s => ({
          name: s.name,
          thumbnail: s.thumbnailFile || '',
          price: s.price,
          compareAtPrice: s.compareAtPrice,
          detail: s.detail
        }))
      }
    };
    fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(product, null, 2));

    // 9. 关闭浏览器
    closeBrowser(profileNo);

    // 10. 输出结果
    const result = {
      success: true,
      outputDir: outDir,
      productId,
      title: data.title,
      images: allImages.length,
      mainImages: downloadedMain.length,
      descImages: descImages.length,
      skus: data.skuDetails.length,
      price: data.skuDetails[0]?.price || '',
      message: '采集完成'
    };
    console.log('\n' + JSON.stringify(result, null, 2));
    releaseLock(lockFile);
    process.exit(0);

  } catch (err) {
    log(`❌ 错误: ${err.message}`);
    try { closeBrowser(profileNo); } catch (e) {}
    releaseLock(lockFile);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 未捕获错误:', err.message);
  process.exit(1);
});
