#!/usr/bin/env node
/**
 * Shopify CSV 批量导入脚本（一体化版本）
 * 1. 读取 CSV，将本地图片上传到 imgbb
 * 2. 通过 AdsPower 浏览器自动完成 Shopify 导入
 *
 * 用法：
 *   node import-csv-onestop.js <商品目录> --store <店铺ID>
 *   node import-csv-onestop.js 2026-03-23/023 --store vellin1122
 *
 * 配置：config/stores.json
 */
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ==================== 配置加载 ====================
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json');
const OPENCLAW_CONFIG_FILE = '/root/.openclaw/openclaw.json';
const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

function loadOpenClawEnv() {
  try {
    const data = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_FILE, 'utf8'));
    return data.env || {};
  } catch (e) {
    return {};
  }
}

const OPENCLAW_ENV = loadOpenClawEnv();
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || OPENCLAW_ENV.IMGBB_API_KEY || '';

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

function loadStores() {
  try {
    const data = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
    return data.stores || [];
  } catch (e) {
    log(`❌ 读取 stores.json 失败: ${e.message}`);
    return [];
  }
}

function findStore(query) {
  const stores = loadStores();
  if (!query) {
    if (stores.length === 1) return stores[0];
    throw new Error(`未指定店铺，且 stores.json 中有 ${stores.length} 个店铺，请用 --store <ID> 指定`);
  }
  const store = stores.find(s => s.storeId === query || s.name === query);
  if (!store) throw new Error(`未找到店铺: ${query}，可用: ${stores.map(s => s.storeId).join(', ')}`);
  return store;
}

// CLI 参数解析
const args = process.argv.slice(2);
let productDir = '';
let storeQuery = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--store' && args[i + 1]) storeQuery = args[++i];
  else if (args[i].startsWith('/') || args[i].includes('/')) productDir = args[i];
}
if (!productDir) throw new Error('用法: node import-csv-onestop.js <商品目录> --store <店铺ID>');

const store = findStore(storeQuery);
const PROFILE_NO = String(store.profileNo);
const SHOPIFY_SLUG = String(store.shopifySlug || store.storeId || store.name || '').trim();
if (!SHOPIFY_SLUG) throw new Error('店铺缺少 shopifySlug/storeId/name，无法定位 Shopify 后台');

// CSV 路径
const CSV_ORIGINAL = path.join('/root/.openclaw/TKdown', productDir, 'product.csv');
const CSV_OUTPUT = path.join('/root/.openclaw/TKdown', productDir, 'product-imgbb.csv');

// ==================== imgbb 上传 ====================
function uploadToImgbb(filePath) {
  return new Promise((resolve, reject) => {
    if (!IMGBB_API_KEY) {
      reject(new Error('未提供 IMGBB_API_KEY'));
      return;
    }
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const boundary = '----FormBoundary' + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${IMGBB_API_KEY}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    const urlObj = new URL(IMGBB_API_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + '?key=' + IMGBB_API_KEY,
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success) resolve(json.data.url);
          else reject(new Error(JSON.stringify(json)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ==================== CSV 解析 ====================
function parseCSV(content) {
  const rowsRaw = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      current += ch;
      if (inQuotes && next === '"') {
        current += next;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      if (current.trim() !== '') rowsRaw.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim() !== '') rowsRaw.push(current);
  if (rowsRaw.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(rowsRaw[0]);
  const rows = [];
  for (let i = 1; i < rowsRaw.length; i++) {
    const values = parseCSVLine(rowsRaw[i]);
    if (values.length === 1 && !values[0]) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function toCSVLine(fields) {
  return fields.map(f => {
    if (f == null) return '';
    const s = String(f);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',');
}

// ==================== CDP 浏览器管理（与 upload-product.js 一致） ====================
function isProfileActive(profileNo) {
  try {
    const out = execSync(
      `npx --yes adspower-browser get-browser-active '{"profileNo":"${profileNo}"}' 2>/dev/null`,
      {encoding:'utf8', timeout:15000}
    );
    return out.includes('"status": "Active"');
  } catch (e) {
    return false;
  }
}

/**
 * 打开或连接浏览器
 * @returns {{ cdpUrl: string, isNew: boolean }}
 */
/**
 * 打开AdsPower浏览器（同步版，用spawn）
 */
function openBrowser(profileNo) {
  return new Promise((resolve, reject) => {
    log(`🔓 打开 AdsPower 浏览器 (profileNo: ${profileNo})...`);
    const { spawn } = require('child_process');
    const jsonArg = JSON.stringify({ profileNo: profileNo });
    const p = spawn('npx', ['--yes', 'adspower-browser', 'open-browser', jsonArg], { timeout: 90000 });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => out += d);
    p.on('close', code => {
      if (code !== 0) {
        reject(new Error('open-browser 失败: ' + out.slice(0, 200)));
        return;
      }
      const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
      if (!match) {
        reject(new Error('无法获取CDP URL: ' + out.slice(0,200)));
        return;
      }
      log(`🔌 CDP: ${match[1]}`);
      resolve({ cdpUrl: match[1], isNew: true });
    });
    p.on('error', reject);
  });
}

function closeBrowser(profileNo) {
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      const jsonArg = JSON.stringify({ profileNo: profileNo });
      const p = spawn('npx', ['--yes', 'adspower-browser', 'close-browser', jsonArg], { timeout: 30000 });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    } catch (e) { resolve(); }
  });
}

// ==================== 浏览器导入 ====================
async function importToShopify(csvPath) {
  let browser = null;
  let cdpResult = null;
  let pg = null;

  try {
    cdpResult = await openBrowser(PROFILE_NO);
    log(`🔌 CDP: ${cdpResult.cdpUrl}`);
    browser = await chromium.connectOverCDP(cdpResult.cdpUrl);
    const ctx = browser.contexts()[0];

    const logLocatorText = async (label, locator) => {
      try {
        const count = await locator.count();
        const texts = [];
        for (let i = 0; i < Math.min(count, 8); i++) {
          const text = (await locator.nth(i).innerText().catch(() => '')).trim();
          if (text) texts.push(text.replace(/\s+/g, ' ').slice(0, 400));
        }
        if (texts.length > 0) {
          log(`📋 ${label}:`);
          texts.forEach((t, idx) => log(`   [${idx + 1}] ${t}`));
        }
      } catch (e) {}
    };

    const logPageSummary = async (stage) => {
      try {
        const bodyText = (await pg.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1500);
        if (bodyText) log(`🧾 ${stage} 页面摘要: ${bodyText}`);
      } catch (e) {}
    };

    // 先关闭已有 Tab，只留新建的一个
    const existingPages = ctx.pages();
    if (existingPages.length > 1) {
      for (const p of existingPages) {
        if (!p.isClosed()) await p.close().catch(() => {});
      }
    }
    pg = await ctx.newPage();

    // 1. 打开 Products 页面
    log(`🚀 打开 Shopify Products 页面...`);
    const productsUrl = `https://admin.shopify.com/store/${SHOPIFY_SLUG}/products`;
    log(`   目标店铺URL: ${productsUrl}`);
    await pg.goto(productsUrl, {
      timeout: 40000,
      waitUntil: 'domcontentloaded'
    });
    await pg.waitForTimeout(15000);

    // 检查是否跳登录页
    const curUrl = pg.url();
    if (curUrl.includes('accounts.shopify.com')) {
      log(`❌ Session 已过期，需要重新登录`);
      throw new Error('Session已过期');
    }
    log(`   当前URL: ${curUrl}`);

    // 2. 找"导入"按钮
    log(`🔍 查找 Import 按钮...`);
    const importSelectors = [
      'button:has-text("导入")',
      'a:has-text("导入")',
      'button:has-text("Import")',
    ];
    let importBtn = null;
    for (const sel of importSelectors) {
      const el = pg.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        importBtn = el;
        log(`   ✅ 找到: ${sel}`);
        break;
      }
    }
    if (!importBtn) throw new Error('找不到 Import 按钮');

    await importBtn.click({ force: true });
    await pg.waitForTimeout(5000);
    log(`✅ Import 弹窗已打开`);

    const modal = pg.locator('.Polaris-Modal-Dialog__Container');

    // 3. 兼容新版/旧版导入弹窗
    log(`🔘 检查导入弹窗结构...`);
    await logLocatorText('导入弹窗初始文本', modal.locator('*'));

    const addFileBtn = modal.locator('button:has-text("Add file"), button:has-text("添加文件")').first();
    const directUploadBtn = modal.locator('button:has-text("Upload and preview"), button:has-text("上传并预览")').first();
    const legacyNextBtn = modal.locator('button:has-text("下一步"), button:has-text("Next")').first();

    const hasDirectUploadFlow = await addFileBtn.isVisible({ timeout: 2000 }).catch(() => false)
      || await directUploadBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (!hasDirectUploadFlow) {
      log(`   识别为旧版弹窗，尝试选择 CSV 模式...`);
      const csvText = pg.locator('text=上传 Shopify 格式的 CSV 文件, text="Upload Shopify formatted CSV file"').first();
      if (await csvText.isVisible({ timeout: 5000 }).catch(() => false)) {
        await csvText.click({ force: true });
        log(`   ✅ 已点击 CSV 模式文字`);
        await pg.waitForTimeout(3000);
      } else {
        log(`   ⚠️ 未找到 CSV 模式文字，尝试 radio...`);
        const csvRadio = modal.locator('input[name="importMethodOptions"][value="csv"]').first();
        if (await csvRadio.isVisible({ timeout: 3000 }).catch(() => false)) {
          await csvRadio.click({ force: true });
          log(`   ✅ 已选择 CSV radio`);
        }
      }

      log(`➡️ 点击下一步...`);
      if (await legacyNextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await legacyNextBtn.click({ force: true });
        log(`   ✅ 已点击下一步`);
        await pg.waitForTimeout(3000);
      } else {
        log(`   ⚠️ 未找到下一步按钮，继续尝试直接上传`);
      }
    } else {
      log(`   ✅ 识别为新版直传弹窗`);
    }

    // 4. 上传 CSV
    log(`📁 上传 CSV: ${csvPath}`);
    let uploaded = false;

    for (let i = 0; i < 5 && !uploaded; i++) {
      const count = await modal.locator('input[type="file"]').count();
      if (count > 0) {
        await modal.locator('input[type="file"]').first().setInputFiles(csvPath, { force: true });
        uploaded = true;
        log(`   ✅ 通过 file input 直接选择文件`);
        break;
      }
      await pg.waitForTimeout(1000);
    }

    if (!uploaded && await addFileBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      log(`   尝试通过 Add file 按钮触发文件选择器...`);
      const chooserPromise = pg.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
      await addFileBtn.click({ force: true }).catch(() => {});
      const chooser = await chooserPromise;
      if (chooser) {
        await chooser.setFiles(csvPath);
        uploaded = true;
        log(`   ✅ 已通过文件选择器上传`);
      }
    }

    if (!uploaded) throw new Error('找不到可用的 CSV 上传入口');

    await pg.waitForTimeout(3000);
    await logLocatorText('上传后弹窗文本', modal.locator('*'));

    // 5. 点上传并预览
    log(`🔍 查找上传并预览按钮...`);
    const confirmBtn = modal.locator('button:has-text("上传并预览"), button:has-text("Upload and preview")').first();
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.click({ force: true });
      log(`   ✅ 已点击上传并预览`);
    } else {
      log(`   ⚠️ 未找到上传并预览按钮`);
    }

    // 6. 等待预览画面（最多20秒）
    log(`🔍 等待预览画面...`);
    let previewFound = false;
    for (let i = 0; i < 20; i++) {
      const previewBtn = pg.locator('button:has-text("导入产品"), button:has-text("Import products")').first();
      if (await previewBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        log(`   ✅ 找到导入产品按钮（第${i+1}次）`);
        await logLocatorText('预览页关键信息', modal.locator('*'));
        await previewBtn.click({ force: true });
        previewFound = true;
        break;
      }
      await pg.waitForTimeout(1000);
    }
    if (!previewFound) {
      await logLocatorText('未出现导入按钮时的弹窗文本', modal.locator('*'));
      log(`⚠️ 未找到预览按钮，跳过点击`);
    }

    // 8. 等待处理完成
    log(`⏳ 等待导入处理（30s）...`);
    await pg.waitForTimeout(30000);

    // 9. 检查回执
    await logLocatorText('页面横幅', pg.locator('[role="alert"], .Polaris-Banner, .Polaris-Toast, [data-polaris-toast]'));
    await logLocatorText('弹窗残留文本', modal.locator('*'));
    await logPageSummary('导入后');

    const modalText = await modal.textContent().catch(() => '') || '';
    if (/There was an error importing your CSV file/i.test(modalText)) {
      throw new Error(modalText.replace(/\s+/g, ' ').trim().slice(0, 500));
    }

    const errorEls = ['.Polaris-Banner--variantCritical', '.Polaris-Banner--variantWarning'];
    for (const sel of errorEls) {
      const el = pg.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = await el.textContent();
        log(`   ❌ 错误: ${text.slice(0, 200)}`);
      }
    }

    const finalUrl = pg.url();
    log(`   当前URL: ${finalUrl}`);
    log(`✅ 导入完成`);

  } catch (e) {
    log(`❌ 导入失败: ${e.message}`);
    if (pg) await pg.screenshot({ path: `/root/.openclaw/workspace_shop/csv-import-error-${Date.now()}.png`, fullPage: true }).catch(() => {});
    throw e;
  } finally {
    if (pg) {
      try { await pg.close(); log('🔚 已关闭新建的Tab'); } catch (e) {}
    }
    if (cdpResult && cdpResult.isNew) {
      if (browser) {
        log('🔓 关闭浏览器 (新建CDP连接)');
        try { await browser.close(); } catch (e) {}
      }
      await closeBrowser(PROFILE_NO);
    } else if (browser) {
      log('🔗 断开CDP连接 (复用已有浏览器)');
      try { await browser.disconnect(); } catch (e) {}
    }
  }
}

// ==================== 主流程 ====================
async function main() {
  log(`📦 导入商品: ${productDir}`);
  log(`   店铺: ${store.name} (${store.profileNo})`);
  log(`   Profile: ${PROFILE_NO}`);

  // Step 1: 处理 CSV（图片上传 + 路径替换）
  log(`📋 读取 CSV: ${CSV_ORIGINAL}`);
  const content = fs.readFileSync(CSV_ORIGINAL, 'utf8');
  const { headers, rows } = parseCSV(content);
  log(`   商品数量: ${rows.length}`);

  const imageCol = 'Product image URL';
  const variantImageCol = 'Variant image URL';
  let csvToImport = CSV_ORIGINAL;

  // 收集图片
  log(`🖼️  收集本地图片...`);
  const toUpload = new Map();
  for (const row of rows) {
    for (const col of [imageCol, variantImageCol]) {
      const val = row[col];
      if (val && (val.startsWith('./') || val.startsWith('/'))) {
        const localPath = val.startsWith('./')
          ? path.join('/root/.openclaw/TKdown', productDir, val.replace(/^\.\//, ''))
          : val;
        if (fs.existsSync(localPath) && !toUpload.has(localPath)) {
          toUpload.set(localPath, null);
        }
      }
    }
  }

  if (toUpload.size === 0) {
    log(`   无本地图片需要上传，使用原始CSV`);
  } else {
    log(`   共 ${toUpload.size} 张图片`);

    // 上传到 imgbb
    log(`☁️  上传到 imgbb...`);
    let idx = 0;
    for (const [localPath] of toUpload) {
      idx++;
      try {
        const url = await uploadToImgbb(localPath);
        toUpload.set(localPath, url);
        log(`   [${idx}/${toUpload.size}] ✅ ${path.basename(localPath)}`);
      } catch (e) {
        log(`   [${idx}/${toUpload.size}] ❌ ${path.basename(localPath)}: ${e.message}`);
      }
    }

    // 替换 CSV 中的图片路径
    log(`✏️  替换 CSV 图片路径...`);
    for (const row of rows) {
      for (const col of [imageCol, variantImageCol]) {
        const val = row[col];
        if (val && (val.startsWith('./') || val.startsWith('/'))) {
          const localPath = val.startsWith('./')
            ? path.join('/root/.openclaw/TKdown', productDir, val.replace(/^\.\//, ''))
            : val;
          const newUrl = toUpload.get(localPath);
          if (newUrl) row[col] = newUrl;
        }
      }
    }

    // 保存 product-imgbb.csv
    const newLines = [toCSVLine(headers)];
    for (const row of rows) {
      newLines.push(toCSVLine(headers.map(h => row[h])));
    }
    fs.writeFileSync(CSV_OUTPUT, newLines.join('\n'), 'utf8');
    csvToImport = CSV_OUTPUT;
    log(`   已保存到: ${CSV_OUTPUT}`);
  }

  const totalImages = toUpload.size;
  const successImages = Array.from(toUpload.values()).filter(v => v !== null).length;
  if (totalImages > 0) log(`📊 图片上传: ${successImages}/${totalImages} 成功`);

  // Step 2: 浏览器导入
  log(`📤 本次导入文件: ${csvToImport}`);
  await importToShopify(csvToImport);
}

main().catch(e => { console.error(`❌ 错误: ${e.message}`); process.exit(1); });
