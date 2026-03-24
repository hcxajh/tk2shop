#!/usr/bin/env node
/**
 * TikTok Shop 采集子代理 - 运行器
 * 
 * 用法：
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
const PROFILE_POOL_FILE = path.join(__dirname, '..', '..', 'config', 'profile-pool.json');

// 从配置文件读取所有配置
let OUTPUT_DIR = process.env.TK_OUTPUT_DIR || null;
let PROFILE_POOL = [];
try {
  if (fs.existsSync(PROFILE_POOL_FILE)) {
    const config = JSON.parse(fs.readFileSync(PROFILE_POOL_FILE, 'utf8'));
    if (!OUTPUT_DIR && config.outputDir) {
      OUTPUT_DIR = config.outputDir;
    }
    if (config.profiles && Array.isArray(config.profiles) && config.profiles.length > 0) {
      PROFILE_POOL = config.profiles;
    }
  }
} catch (e) {
  // ignore
}
if (!OUTPUT_DIR) {
  console.error('❌ 未配置 outputDir，请检查 profile-pool.json');
  process.exit(1);
}
if (PROFILE_POOL.length === 0) {
  console.error('❌ 未配置 profiles，请检查 profile-pool.json');
  process.exit(1);
}
log(`📋 配置已加载`);

// ============================================================
// 工具函数
// ============================================================

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
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
  // 优先找空闲的 profile
  for (const profileNo of PROFILE_POOL) {
    if (!isProfileActive(profileNo)) {
      log(`   配置文件 ${profileNo} 空闲`);
      return profileNo;
    }
    log(`   配置文件 ${profileNo} 忙碌`);
  }
  // 所有 profile 都忙碌 — 返回第一个，让 openBrowser 尝试复用
  log('⚠️ 所有配置文件均在使用中，将尝试复用第一个');
  return PROFILE_POOL[0];
}

/**
 * 打开或复用 AdsPower 浏览器，获取 Playwright CDP URL
 *
 * 三段式逻辑：
 * 1. profile 已 active → 尝试从 list 获取已有 CDP URL 复用（isNew=false）
 * 2. 复用失败 → 显式关闭旧浏览器，再打开新的（isNew=true）
 * 3. profile 未 active → 直接打开新浏览器（isNew=true）
 *
 * @returns {{ cdpUrl: string, isNew: boolean }}
 */
function openBrowser(profileNo) {
  if (isProfileActive(profileNo)) {
    // ---- 阶段1：尝试复用已有浏览器 ----
    log(`🔁 检测到 profile ${profileNo} 已有浏览器运行，尝试复用...`);
    try {
      const listOut = execSync(
        `npx --yes adspower-browser list 2>/dev/null`,
        { encoding: 'utf8', timeout: 15000 }
      );
      const data = JSON.parse(listOut);
      const browserInfo = (data.data || []).find(b => b.user_id === String(profileNo));
      if (browserInfo && browserInfo.webdriver && browserInfo.webdriver.startsWith('ws')) {
        log(`🔌 复用已有 CDP: ${browserInfo.webdriver}`);
        return { cdpUrl: browserInfo.webdriver, isNew: false };
      }
      log(`   list 未返回有效 webdriver URL`);
    } catch (e) {
      log(`   列表查询失败: ${e.message}`);
    }

    // ---- 阶段2：复用失败，显式关旧再开新 ----
    log(`   复用失败，先关闭旧浏览器再打开新的...`);
    closeBrowser(profileNo);
    execSync('sleep 2', { encoding: 'utf8', timeout: 5000 });
  }

  // ---- 阶段3：打开新浏览器 ----
  log(`🔓 打开 AdsPower 浏览器 (profileNo: ${profileNo})...`);
  const jsonArg = `{"profileNo":"${profileNo}"}`;
  const out = execSync(
    `npx --yes adspower-browser open-browser '${jsonArg}' 2>&1`,
    { encoding: 'utf8', timeout: 60000 }
  );
  log('   ' + out.trim().split('\n').slice(-2).join(' '));

  const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
  if (!match) throw new Error('无法获取 CDP URL: ' + out);
  log(`🔌 CDP: ${match[1]} (新建连接)`);

  // 等待 Chrome 完全启动（避免连接失败）
  log(`   等待Chrome启动...`);
  execSync(`sleep 3`, { encoding: 'utf8', timeout: 10000 });

  return { cdpUrl: match[1], isNew: true };
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

function hasMeaningfulProductData(data) {
  return !!(
    (data.title && data.title.trim()) ||
    (data.mainImages && data.mainImages.length > 0) ||
    (data.skuDetails && data.skuDetails.length > 0) ||
    (data.descResult && ((data.descResult.text && data.descResult.text.trim()) || (data.descResult.images && data.descResult.images.length > 0)))
  );
}

async function inspectPageState(page) {
  return await page.evaluate(() => {
    const text = (document.body?.innerText || '').trim();
    const title = (document.title || '').trim();
    const bodyHtml = document.body?.innerHTML || '';
    const hasCaptcha = [
      'Verify to continue',
      'Drag the puzzle',
      'captcha',
      'Security check',
      'Please verify',
      'Slide to complete the puzzle',
      'Maximum number of attempts reached'
    ].some(k => text.includes(k) || bodyHtml.includes(k));
    const productHints = [
      'About this product',
      'Product description',
      'Sold by',
      'Reviews',
      'Description',
      'Details'
    ].filter(k => text.includes(k));
    return {
      url: location.href,
      title,
      bodyTextLen: text.length,
      bodyTextStart: text.slice(0, 800),
      hasCaptcha,
      productHints,
      hasOgTitle: !!document.querySelector('meta[property="og:title"]'),
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      imageCount: document.images.length,
      readyState: document.readyState
    };
  });
}

async function waitForPageRecovery(page, tiktokUrl, reason) {
  log(`⚠️ ${reason}，等待页面恢复或人工处理（最多10分钟）...`);
  for (let i = 0; i < 120; i++) {
    try {
      await page.waitForTimeout(5000);
    } catch (e) {
      log(`❌ 浏览器已关闭，采集中止`);
      throw new Error('浏览器被关闭，采集中止');
    }

    let state;
    try {
      state = await inspectPageState(page);
    } catch (e) {
      log(`❌ 页面已关闭，采集中止`);
      throw new Error('页面已关闭，采集中止');
    }

    const recovered = !state.hasCaptcha && (
      state.hasOgTitle ||
      state.productHints.length > 0 ||
      state.imageCount >= 3 ||
      state.bodyTextLen > 1000
    );

    if (recovered) {
      log(`✅ 页面已恢复，重新加载页面...`);
      await page.goto(tiktokUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
      return;
    }

    if (i % 12 === 0) {
      log(`⏳ 等待页面恢复... (${Math.floor((i + 1) * 5 / 60)}分钟)`);
      log(`   当前页面: title=${state.title || '空'} text=${state.bodyTextLen} img=${state.imageCount} hints=${state.productHints.join(',') || '无'}`);
    }
  }
  throw new Error(`等待页面恢复超时: ${reason}`);
}

// ============================================================
// 采集主流程
// ============================================================
async function extract(browser, page, tiktokUrl) {
  log(`🌐 导航到: ${tiktokUrl}`);
  await page.goto(tiktokUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 检测验证码/风控页
  let pageState = await inspectPageState(page);
  if (pageState.hasCaptcha) {
    log(`⚠️ 检测到验证码，请手动在浏览器中完成验证...`);
    await waitForPageRecovery(page, tiktokUrl, '检测到验证码或风控页');
  }

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
    const container = document.querySelector('[class*="items-center"][class*="gap-12"][class*="overflow-x-scroll"]');
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
    const container = document.querySelector('[class*="overflow-x-auto"][class*="flex-wrap"]');
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
      const container = document.querySelector('[class*="overflow-x-auto"][class*="flex-wrap"]');
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
    // 优先用师父给的选择器：div.flex.flex-col.mt-40.w-full
    let targetDiv = document.querySelector('[class*="flex-col"][class*="mt-40"][class*="w-full"]');
    if (!targetDiv) {
      // 备用：用旧逻辑找
      const divs = document.querySelectorAll('div');
      for (const div of divs) {
        const cn = div.className || '';
        if (cn.includes('overflow-hidden') && cn.includes('transition-all')) {
          targetDiv = div; break;
        }
      }
    }
    if (targetDiv) {
      result.text = targetDiv.innerText || '';
      const imgs = targetDiv.querySelectorAll('img');
      for (const img of imgs) {
        if (img.naturalWidth < 50) continue;
        const src = img.currentSrc || img.src;
        if (src && !src.includes('favicon') && !src.includes('logo') && !src.includes('tts_logo') && src.includes('ttcdn')) {
          result.images.push(src);
        }
      }
    }
    return result;
  });
  log(`📝 描述文字: ${descResult.text.length} 字符`);
  log(`📝 描述图片: ${descResult.images.length} 张`);

  const data = { title, mainImages, skuDetails, descResult };
  if (!hasMeaningfulProductData(data)) {
    pageState = await inspectPageState(page);
    if (pageState.hasCaptcha || pageState.bodyTextLen < 200 || pageState.productHints.length === 0) {
      await waitForPageRecovery(page, tiktokUrl, '页面未加载出商品内容');
      return await extract(browser, page, tiktokUrl);
    }
    throw new Error(`未采集到商品内容，当前页面异常: title=${pageState.title || '空'} text=${pageState.bodyTextLen} hints=${pageState.productHints.join(',') || '无'} snippet=${pageState.bodyTextStart.slice(0, 120)}`);
  }

  return data;
}

// ============================================================
// 主程序
// ============================================================
async function main() {
  // 解析参数
  let tiktokUrl = process.env.TK_TIKTOK_URL || '';
  let hold = false;
  if (process.argv[2]) {
    try {
      const args = JSON.parse(process.argv[2]);
      tiktokUrl = args.tiktokUrl || args.url || args.link || '';
      hold = args.hold || false;
    } catch (e) {
      tiktokUrl = process.argv[2];
    }
  }
  
  if (!tiktokUrl || !tiktokUrl.includes('/pdp/')) {
    console.error('❌ 缺少 TikTok 商品链接参数');
    console.error('用法: node runner.js \'{"tiktokUrl": "https://shop.tiktok.com/..."}\' [--hold]');
    process.exit(1);
  }

  log(`🎯 开始采集: ${tiktokUrl}`);

  // 1. 找可用配置文件
  const profileNo = process.env.TK_ADSPOWER_PROFILE 
    ? parseInt(process.env.TK_ADSPOWER_PROFILE) 
    : findAvailableProfile();
  log(`🖥️  使用配置文件: ${profileNo}`);

  let cdpResult = null;
  let browser = null;
  let pg = null;
  try {
    // 2. 打开浏览器
    cdpResult = openBrowser(profileNo);
    log(`🔌 CDP: ${cdpResult.cdpUrl}`);

    // 3. 连接CDP
    browser = await chromium.connectOverCDP(cdpResult.cdpUrl);
    const ctx = browser.contexts()[0];

    // 只新建本次任务的 Tab，不动已有 Tab
    pg = await ctx.newPage();

    // 4. 执行采集
    const data = await extract(browser, pg, tiktokUrl);

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
      variants: data.skuDetails.map((s, idx) => ({
        name: s.name,
        sku: `TK-${productId}-${String(idx + 1).padStart(2, '0')}`,
        price: s.price,
        compareAtPrice: s.compareAtPrice,
        image: s.thumbnailFile || '',
        thumbnail: s.thumbnailFile || '',
        detail: s.detail || ''
      })),
      _meta: {
        productId,
        seq: seqStr,
        sourceUrl: tiktokUrl,
        source: 'tiktok-shop-detail',
        extractedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(product, null, 2));

    // 9. 关闭新建的Tab
    await pg.close().catch(() => {});

    // 9b. 如果有 --hold，写文件等待用户确认后再关浏览器
    if (hold) {
      const readyFile = `/tmp/tk2shop-hold-${process.pid}.ready`;
      fs.writeFileSync(readyFile, 'ready');
      console.log('\n⏸️  采集完成，浏览器保持开着。');
      console.log(`   验证完成后运行以下命令继续关闭:`);
      console.log(`   echo done > ${readyFile}`);
      // 等待文件内容变成 "done"，或浏览器被外部关闭
      while (true) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          // 检测文件信号
          const content = fs.readFileSync(readyFile, 'utf8').trim();
          if (content === 'done') {
            fs.unlinkSync(readyFile);
            console.log('   收到 done 信号，退出等待');
            break;
          }
          // 检测浏览器窗口是否还存在
          const pages = await ctx.pages();
          if (pages.length === 0) {
            console.log('   检测到浏览器窗口已关闭，自动退出等待');
            break;
          }
        } catch (e) {
          // 文件被删或CDP断开，自动退出
          console.log('   检测到异常，自动退出等待');
          break;
        }
      }
      console.log('   收到信号，继续关闭...');
    }

    // 10. 关闭本次浏览器，释放 AdsPower 占用
    if (browser) {
      await browser.close().catch(() => {});
    }
    closeBrowser(profileNo);

    // 11. 输出结果
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
    process.exit(0);

  } catch (err) {
    log(`❌ 错误: ${err.message}`);
    // 错误时也关闭本次新建的Tab和浏览器，释放 AdsPower 占用
    if (pg && !pg.isClosed()) await pg.close().catch(() => {});
    if (browser) {
      await browser.close().catch(() => {});
    }
    closeBrowser(profileNo);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 未捕获错误:', err.message);
  process.exit(1);
});
