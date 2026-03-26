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

function isUsableProductPage(state) {
  if (!state) return false;
  if (state.hasCaptcha) return false;
  return Boolean(
    state.hasOgTitle ||
    state.productHints.length > 0 ||
    state.imageCount >= 3 ||
    state.bodyTextLen > 1000
  );
}

async function openProductPage(page, tiktokUrl) {
  try {
    await page.goto(tiktokUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!/Timeout 30000ms exceeded/.test(msg)) throw err;
    log('⚠️ domcontentloaded 超时，改为检查页面是否已可采...');
    await page.waitForTimeout(5000);
  }

  const pageState = await inspectPageState(page);
  if (isUsableProductPage(pageState)) {
    log(`✅ 页面已可用: title=${pageState.title || '空'} text=${pageState.bodyTextLen} img=${pageState.imageCount} hints=${pageState.productHints.join(',') || '无'}`);
    return pageState;
  }

  throw new Error(`页面未就绪: title=${pageState.title || '空'} ready=${pageState.readyState} text=${pageState.bodyTextLen} img=${pageState.imageCount} hints=${pageState.productHints.join(',') || '无'}`);
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

    const recovered = isUsableProductPage(state);

    if (recovered) {
      log(`✅ 页面已恢复，重新检查商品页状态...`);
      return await openProductPage(page, tiktokUrl);
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
  let pageState = await openProductPage(page, tiktokUrl);

  // 检测验证码/风控页
  if (pageState.hasCaptcha) {
    log(`⚠️ 检测到验证码，请手动在浏览器中完成验证...`);
    pageState = await waitForPageRecovery(page, tiktokUrl, '检测到验证码或风控页');
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
          const segments = text.split('\n').map(l => l.trim()).filter(l => l);
          let result = '';
          const prices = [];

          for (const seg of segments) {
            if (/^\$[\d.]+$/.test(seg)) {
              if (result) prices.push(result);
              result = seg;
            } else if (seg === '$') {
              if (result) prices.push(result);
              result = '$';
            } else if (/^[\d.]+$/.test(seg)) {
              result += seg;
            }
          }
          if (result) prices.push(result);

          if (prices.length >= 2) {
            currentPrice = prices[0].replace('$', '');
            compareAtPrice = prices[1].replace('$', '');
          } else if (prices.length === 1) {
            currentPrice = prices[0].replace('$', '');
          }
          break;
        }
      }

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

  // 4b. 提取当前已选规格（用于单变体商品补全）
  const selectedOptions = await page.evaluate(() => {
    const bodyText = (document.body?.innerText || '').replace(/\r/g, '');
    const lines = bodyText.split('\n').map(s => s.trim()).filter(Boolean);
    const stopWords = new Set(['Quantity:', 'Buy now', 'Add to cart', 'Coupon center', 'Shipping & returns']);
    const optionNames = ['Color', 'Specification', 'Size', 'Style', 'Model', 'Material', 'Capacity', 'Pack', 'Type'];
    const results = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/[:：]$/, '');
      if (!optionNames.includes(line)) continue;

      const values = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
        const next = lines[j].trim();
        if (!next || stopWords.has(next) || optionNames.includes(next.replace(/[:：]$/, ''))) break;
        if (next === line) continue;
        if (!values.includes(next)) values.push(next);
      }

      if (values.length > 0) {
        results.push({ name: line, value: values[0], values });
      }
    }

    return results;
  });
  if (selectedOptions.length > 0) {
    log(`🧩 规格: ${selectedOptions.map(o => `${o.name}=${o.value}`).join(' | ')}`);
  }

  // 5. 描述图文
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.waitForTimeout(1000);
  const descBtnClicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('span,button,div'));
    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (!text) continue;
      if (text.includes('Description') || text.includes('Details') || text.includes('About this product')) {
        el.click();
        return true;
      }
    }
    return false;
  });
  await page.waitForTimeout(1500);

  const moreBtnClicked = await page.evaluate(() => {
    const hasTargetClass = (el) => {
      const cn = el.className || '';
      return cn.includes('Headline-Semibold') &&
        cn.includes('text-color-UIText1') &&
        cn.includes('background-color-UIShapeNeutral4') &&
        cn.includes('px-24') &&
        cn.includes('py-13');
    };

    const candidates = Array.from(document.querySelectorAll('span,button,div,a'));

    // 优先匹配：文案 + 样式
    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (!text) continue;
      if ((text.includes('查看更多') || text.includes('See more') || text.includes('Show more')) && hasTargetClass(el)) {
        el.click();
        return 'style+text';
      }
    }

    // 兜底1：只看文案
    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (!text) continue;
      if (text.includes('查看更多') || text.includes('See more') || text.includes('Show more')) {
        el.click();
        return 'text';
      }
    }

    // 兜底2：只看样式
    for (const el of candidates) {
      if (hasTargetClass(el)) {
        const text = (el.innerText || '').trim();
        if (!text || text.length <= 20) {
          el.click();
          return 'style';
        }
      }
    }

    return '';
  });
  await page.waitForTimeout(1500);
  log(`📝 描述展开: ${descBtnClicked ? '✅' : '⚠️'}`);
  log(`📝 查看更多: ${moreBtnClicked ? '✅ ' + moreBtnClicked : '⚠️'}`);

  const descResult = await page.evaluate(() => {
    const result = { text: '', images: [], blocks: [], debug: { headers: [], candidates: [], selected: null } };
    const stopKeys = [
      'View more', 'See more', 'Videos for this product', 'About this shop', 'Shop review',
      'You may also like', 'People also searched for', 'Shipping & returns', 'Shipping & delivery',
      'Returns made easy', 'TikTok Shop protections', 'Secure payments', 'Data privacy',
      'Money-back guarantee', 'Delivery guarantee', '24/7 in-app support', 'Easy returns and refunds'
    ];
    const dirtyKeys = [
      'Log in', 'Coupon Center', 'Get app', 'Verified purchase', 'global reviews',
      'Ships within', 'Positive feedback', 'Visit', 'Creator earns commission',
      'Explore more from', 'You may also like', 'People also searched for',
      'Shipping & returns', 'About this shop', 'Shop review'
    ];
    const specKeys = /^(Plug Type|Region Of Origin|Pack Type|Net Weight|Quantity Per Pack|Makeup Tool Type|Material|Style|Size|Model|Applicable Age Group|Major Material|Power Supply|Battery Properties|Brand|Origin|Item ID)\b/i;
    const descTitleRe = /^(Product description|Description|About this product)$/i;
    const detailTitleRe = /^Details$/i;

    const normalizeLines = (text) => (text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const previewText = (text, max = 160) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

    const isDirtyBlock = (text) => {
      if (!text) return true;
      const hitCount = dirtyKeys.filter(k => text.includes(k)).length;
      if (hitCount >= 2) return true;
      if (text.length > 5000) return true;
      return false;
    };

    const sanitizeText = (text, mode = 'desc') => {
      const lines = normalizeLines(text);
      if (lines.length === 0) return '';

      let start = 0;
      const titleIdx = lines.findIndex(line => descTitleRe.test(line) || detailTitleRe.test(line));
      if (titleIdx >= 0) start = titleIdx + 1;

      const kept = [];
      for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        if (stopKeys.some(k => line.includes(k))) break;
        if (dirtyKeys.some(k => line.includes(k))) break;
        if (descTitleRe.test(line) || detailTitleRe.test(line)) continue;
        if (/^\d+(\.\d+)?$/.test(line)) continue;
        if (/^\$?\d+[\d.,]*$/.test(line)) continue;
        if (line === 'Previous' || line === 'Next') continue;
        if (line.length <= 1) continue;

        if (mode === 'desc' && specKeys.test(line)) {
          if (kept.length === 0) continue;
          break;
        }

        if (mode === 'desc' && /^Sensitive Goods Type\b/i.test(line)) {
          if (kept.length === 0) continue;
          break;
        }

        kept.push(line);
      }

      const joined = kept.join('\n').trim();
      if (!joined || isDirtyBlock(joined)) return '';
      return joined;
    };

    const normalizeImageUrl = (src) => src || '';

    const isUsefulImage = (img, src) => {
      if (!src || !src.includes('ttcdn')) return false;
      if (src.includes('favicon') || src.includes('logo') || src.includes('tts_logo')) return false;
      const rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : { width: 0, height: 0 };
      const width = Number(img.naturalWidth || img.width || rect.width || 0);
      const height = Number(img.naturalHeight || img.height || rect.height || 0);
      if (width > 0 && height > 0 && width < 40 && height < 40) return false;
      return true;
    };

    const collectImages = (targetDiv) => {
      const images = [];
      if (!targetDiv) return images;
      const imgs = targetDiv.querySelectorAll('img');
      for (const img of imgs) {
        const src = normalizeImageUrl(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'));
        if (isUsefulImage(img, src)) images.push(src);
      }
      return [...new Set(images)];
    };

    const extractBlocksFromContainer = (container) => {
      if (!container) return [];
      const blocks = [];
      const seenImages = new Set();
      const seenTexts = new Set();

      const pushText = (text) => {
        const cleaned = sanitizeText(text, 'desc');
        if (!cleaned) return;
        const key = cleaned.replace(/\s+/g, ' ').trim();
        if (!key || seenTexts.has(key)) return;
        seenTexts.add(key);
        blocks.push({ type: 'text', text: cleaned });
      };

      const pushImage = (img) => {
        const src = normalizeImageUrl(img.currentSrc || img.src || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'));
        if (!isUsefulImage(img, src)) return;
        if (seenImages.has(src)) return;
        seenImages.add(src);
        blocks.push({ type: 'image', src });
      };

      const isLeafLikeTextNode = (node) => {
        const children = Array.from(node.children || []);
        if (children.length === 0) return true;
        const hasBlockChildren = children.some(child => {
          const tag = (child.tagName || '').toLowerCase();
          return ['div', 'section', 'article', 'ul', 'ol', 'li', 'p'].includes(tag);
        });
        return !hasBlockChildren;
      };

      const walk = (node, depth = 0) => {
        if (!node || node.nodeType !== 1) return;
        const el = node;
        const tag = (el.tagName || '').toLowerCase();
        const nodeText = (el.innerText || '').trim();

        if (tag === 'img') {
          pushImage(el);
          return;
        }

        if (['script', 'style', 'svg'].includes(tag)) return;
        if (descTitleRe.test(nodeText) || detailTitleRe.test(nodeText)) return;
        if (isDirtyBlock(nodeText) && !el.querySelector('img')) return;

        const directChildren = Array.from(el.children || []);
        if (directChildren.length === 0) {
          pushText(nodeText);
          return;
        }

        if (depth <= 2) {
          const directSequence = [];
          for (const child of directChildren) {
            const childTag = (child.tagName || '').toLowerCase();
            const childText = (child.innerText || '').trim();
            if (childTag === 'img') {
              const src = normalizeImageUrl(child.currentSrc || child.src || child.getAttribute('src') || child.getAttribute('data-src') || child.getAttribute('data-lazy-src'));
              if (isUsefulImage(child, src)) directSequence.push({ type: 'image', src });
              continue;
            }
            const cleanedChildText = sanitizeText(childText, 'desc');
            if (cleanedChildText) directSequence.push({ type: 'text', text: cleanedChildText });
          }

          const hasMixedSequence = directSequence.some(x => x.type === 'text') && directSequence.some(x => x.type === 'image');
          if (hasMixedSequence) {
            for (const item of directSequence) {
              if (item.type === 'image') {
                if (!seenImages.has(item.src)) {
                  seenImages.add(item.src);
                  blocks.push(item);
                }
              } else {
                const key = item.text.replace(/\s+/g, ' ').trim();
                if (key && !seenTexts.has(key)) {
                  seenTexts.add(key);
                  blocks.push(item);
                }
              }
            }
            return;
          }
        }

        if (tag === 'p' || tag === 'li' || isLeafLikeTextNode(el)) {
          const hasUsefulImgChild = directChildren.some(child => (child.tagName || '').toLowerCase() === 'img');
          if (!hasUsefulImgChild) {
            pushText(nodeText);
            return;
          }
        }

        for (const child of directChildren) {
          walk(child, depth + 1);
        }

        const childTextConcat = directChildren.map(child => (child.innerText || '').trim()).filter(Boolean).join('\n');
        const ownText = nodeText && childTextConcat ? nodeText.replace(childTextConcat, '').trim() : nodeText;
        if (ownText && ownText.length > 1 && !descTitleRe.test(ownText) && !detailTitleRe.test(ownText)) {
          pushText(ownText);
        }
      };

      walk(container, 0);
      return blocks;
    };

    const describeNode = (el, label) => {
      if (!el) return null;
      const rawText = (el.innerText || '').trim();
      const cleaned = sanitizeText(rawText, 'desc');
      const images = collectImages(el);
      const blocks = extractBlocksFromContainer(el);
      const dirtyHitCount = dirtyKeys.filter(k => rawText.includes(k)).length;
      return {
        label,
        tag: (el.tagName || '').toLowerCase(),
        className: String(el.className || '').slice(0, 200),
        textLen: rawText.length,
        cleanedLen: cleaned.length,
        imageCount: images.length,
        childCount: el.children ? el.children.length : 0,
        dirtyHitCount,
        preview: previewText(rawText),
        blocksPreview: blocks.slice(0, 8).map(b => b.type === 'text'
          ? { type: 'text', text: previewText(b.text, 120) }
          : { type: 'image', src: previewText(b.src, 120) }),
        images,
        cleaned,
        blocks,
      };
    };

    const sectionCandidates = [];
    const headerNodes = Array.from(document.querySelectorAll('div,span,button')).filter(el => {
      const cn = el.className || '';
      const text = (el.innerText || '').trim();
      return cn.includes('sectionHeader-mTOhOt') && cn.includes('clickable-Q3abyt') && text;
    });

    for (const header of headerNodes) {
      const headerText = (header.innerText || '').trim();
      const mode = descTitleRe.test(headerText) ? 'desc' : (detailTitleRe.test(headerText) ? 'detail' : 'other');
      if (mode === 'other') continue;

      const headerInfo = {
        text: headerText,
        mode,
        preview: previewText(headerText),
        candidates: []
      };

      const candidates = [
        ['next', header.nextElementSibling],
        ['parent-next', header.parentElement?.nextElementSibling],
        ['parent-last-child', header.parentElement?.querySelector(':scope > div:last-child')],
        ['parent', header.parentElement],
        ['parent-parent-next', header.parentElement?.parentElement?.nextElementSibling],
        ['parent-parent', header.parentElement?.parentElement],
      ].filter(([, el]) => Boolean(el));

      for (const [label, el] of candidates) {
        const info = describeNode(el, label);
        if (!info) continue;
        headerInfo.candidates.push({
          label: info.label,
          textLen: info.textLen,
          cleanedLen: info.cleanedLen,
          imageCount: info.imageCount,
          childCount: info.childCount,
          dirtyHitCount: info.dirtyHitCount,
          preview: info.preview,
          blocksPreview: info.blocksPreview,
        });

        if (!info.cleaned || isDirtyBlock((el.innerText || '').trim())) continue;
        const penalty = (
          (label.includes('parent-parent') ? 220 : 0) +
          (mode === 'desc' && /^Details\b/i.test(info.preview) ? 260 : 0) +
          (mode === 'desc' && /Plug Type|Quantity Per Pack|Sensitive Goods Type|Product Contain Wooden Materials/i.test(info.preview) ? 320 : 0)
        );
        sectionCandidates.push({
          mode,
          label,
          text: info.cleaned,
          images: info.images,
          blocks: info.blocks,
          score: info.cleaned.length + info.images.length * 200 + info.blocks.length * 20 - penalty,
          preview: info.preview,
        });
      }

      result.debug.headers.push(headerInfo);
    }

    const descOnly = sectionCandidates.filter(x => x.mode === 'desc' && x.text && x.text.length >= 20 && x.text.length < 2500);
    if (descOnly.length > 0) {
      descOnly.sort((a, b) => b.score - a.score);
      result.text = descOnly[0].text;
      result.images = descOnly[0].images;
      result.blocks = descOnly[0].blocks || [];
      result.debug.selected = {
        source: 'descOnly',
        label: descOnly[0].label,
        score: descOnly[0].score,
        preview: descOnly[0].preview,
        textLen: descOnly[0].text.length,
        imageCount: descOnly[0].images.length,
        blockCount: (descOnly[0].blocks || []).length,
      };
      result.debug.candidates = descOnly.slice(0, 8).map(x => ({
        label: x.label,
        score: x.score,
        textLen: x.text.length,
        imageCount: x.images.length,
        blockCount: (x.blocks || []).length,
        preview: x.preview,
      }));
      return result;
    }

    const narrowFallbackCandidates = [];
    for (const header of Array.from(document.querySelectorAll('div,span,button'))) {
      const headerText = (header.innerText || '').trim();
      if (!descTitleRe.test(headerText)) continue;

      const nearby = [
        ['next', header.nextElementSibling],
        ['parent-next', header.parentElement?.nextElementSibling],
        ['parent-parent-next', header.parentElement?.parentElement?.nextElementSibling],
      ].filter(([, el]) => Boolean(el));

      for (const [label, el] of nearby) {
        const info = describeNode(el, `fallback-${label}`);
        if (!info || !info.cleaned) continue;
        narrowFallbackCandidates.push({
          label: info.label,
          text: info.cleaned,
          images: info.images,
          blocks: info.blocks,
          score: info.cleaned.length + info.images.length * 200 + info.blocks.length * 20,
          preview: info.preview,
        });
      }
    }

    if (narrowFallbackCandidates.length > 0) {
      narrowFallbackCandidates.sort((a, b) => b.score - a.score);
      result.text = narrowFallbackCandidates[0].text;
      result.images = narrowFallbackCandidates[0].images;
      result.blocks = narrowFallbackCandidates[0].blocks || [];
      result.debug.selected = {
        source: 'fallback',
        label: narrowFallbackCandidates[0].label,
        score: narrowFallbackCandidates[0].score,
        preview: narrowFallbackCandidates[0].preview,
        textLen: narrowFallbackCandidates[0].text.length,
        imageCount: narrowFallbackCandidates[0].images.length,
        blockCount: (narrowFallbackCandidates[0].blocks || []).length,
      };
      result.debug.candidates = narrowFallbackCandidates.slice(0, 8).map(x => ({
        label: x.label,
        score: x.score,
        textLen: x.text.length,
        imageCount: x.images.length,
        blockCount: (x.blocks || []).length,
        preview: x.preview,
      }));
    }

    return result;
  });
  log(`📝 描述文字: ${descResult.text.length} 字符`);
  log(`📝 描述图片: ${descResult.images.length} 张`);

  const data = { title, mainImages, skuDetails, descResult, selectedOptions };
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
    const normalizedVariants = (data.skuDetails.length > 0 ? data.skuDetails : [{
      name: (data.selectedOptions || []).map(o => o.value).filter(Boolean).join(' / ') || 'Default',
      thumbnail: '',
      price: '',
      compareAtPrice: '',
      detail: ''
    }]).map((s, idx) => ({
      name: s.name,
      sku: `TK-${productId}-${String(idx + 1).padStart(2, '0')}`,
      price: s.price,
      compareAtPrice: s.compareAtPrice,
      image: s.thumbnailFile || '',
      thumbnail: s.thumbnailFile || '',
      detail: s.detail || ''
    }));

    const product = {
      title: data.title,
      description: data.descResult.text,
      price: data.skuDetails[0]?.price || '',
      compareAtPrice: data.skuDetails[0]?.compareAtPrice || '',
      sku: 'TK-' + productId,
      status: 'active',
      images: allImages,
      descriptionImages: descImages,
      descriptionBlocks: data.descResult.blocks || [],
      options: data.selectedOptions || [],
      variants: normalizedVariants,
      _meta: {
        productId,
        seq: seqStr,
        sourceUrl: tiktokUrl,
        source: 'tiktok-shop-detail',
        extractedAt: new Date().toISOString()
      }
    };
    fs.writeFileSync(path.join(outDir, 'product.json'), JSON.stringify(product, null, 2));

    // 8b. 自动增强 Shopify 内容（失败不阻断主采集链路）
    try {
      const enrichScript = path.join(__dirname, '..', 'publisher', 'enrich-product.js');
      execSync(`node "${enrichScript}" "${outDir}"`, { stdio: 'inherit', timeout: 30000 });
      log('✨ 已自动完成内容增强');
    } catch (e) {
      log(`⚠️ 自动内容增强失败（已跳过，不影响采集结果）: ${e.message}`);
    }

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
