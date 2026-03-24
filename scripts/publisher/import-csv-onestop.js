#!/usr/bin/env node
/**
 * Shopify CSV 批量导入脚本（一体化版本）
 * 1. 读取 CSV，将本地图片上传到 imgbb
 * 2. 通过 AdsPower 浏览器自动完成 Shopify 导入
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

const PROFILE_NO = '1896325';
const SHOP = 'vellin1122';
const IMGBB_API_KEY = '45a4978299f821f5743e361bc1f3472a';

const CSV_DIR = '/root/.openclaw/TKdown/2026-03-23/023';
const CSV_ORIGINAL = path.join(CSV_DIR, 'product.csv');
const CSV_OUTPUT = path.join(CSV_DIR, 'product-imgbb.csv');
const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ==================== imgbb 上传 ====================
function uploadToImgbb(filePath) {
  return new Promise((resolve, reject) => {
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

// 解析 CSV
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
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

async function processCSV() {
  log(`📋 读取 CSV: ${CSV_ORIGINAL}`);
  const content = fs.readFileSync(CSV_ORIGINAL, 'utf8');
  const { headers, rows } = parseCSV(content);
  log(`   商品数量: ${rows.length}`);

  const imageCol = 'Product image URL';
  const variantImageCol = 'Variant image URL';

  // 收集图片
  log(`🖼️  收集本地图片...`);
  const toUpload = new Map();
  for (const row of rows) {
    for (const col of [imageCol, variantImageCol]) {
      const val = row[col];
      if (val && val.startsWith('./')) {
        const localPath = path.join(CSV_DIR, val.replace(/^\.\//, ''));
        if (fs.existsSync(localPath) && !toUpload.has(localPath)) {
          toUpload.set(localPath, null);
        }
      }
    }
  }
  if (toUpload.size === 0) {
    log(`   无本地图片需要上传`);
    return { headers, rows, uploaded: new Map() };
  }
  log(`   共 ${toUpload.size} 张图片`);

  // 上传
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

  // 替换
  log(`✏️  替换 CSV 图片路径...`);
  for (const row of rows) {
    for (const col of [imageCol, variantImageCol]) {
      const val = row[col];
      if (val && val.startsWith('./')) {
        const localPath = path.join(CSV_DIR, val.replace(/^\.\//, ''));
        const newUrl = toUpload.get(localPath);
        if (newUrl) {
          row[col] = newUrl;
        }
      }
    }
  }

  // 保存
  const newLines = [toCSVLine(headers)];
  for (const row of rows) {
    newLines.push(toCSVLine(headers.map(h => row[h])));
  }
  fs.writeFileSync(CSV_OUTPUT, newLines.join('\n'), 'utf8');
  log(`   已保存到: ${CSV_OUTPUT}`);
  return { headers, rows, uploaded: toUpload };
}

// ==================== 浏览器导入 ====================
function getCdpUrl(profileNo) {
  // 每次都开新浏览器，不复用已有浏览器，避免旧 Tab 累积
  return openNewBrowser(profileNo);
}

function openNewBrowser(profileNo) {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = ['--yes', 'adspower-browser', 'open-browser', JSON.stringify({profileNo})];
    log(`   执行: npx ${args.join(' ')}`);
    const p = spawn('npx', args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: path.join(__dirname, '..', '..') });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { process.stderr.write(d.toString()); });
    p.on('close', code => {
      if (code !== 0) { reject(new Error(`npx exit ${code}`)); return; }
      const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
      if (match) resolve(match[1]);
      else reject(new Error('无法获取CDP: ' + out.slice(0, 200)));
    });
  });
}

async function importToShopify(csvPath) {
  log(`🔌 获取 CDP URL (profile ${PROFILE_NO})...`);
  const cdpUrl = await getCdpUrl(PROFILE_NO);
  log(`   CDP: ${cdpUrl}`);

  const browser = await chromium.connectOverCDP(cdpUrl);
  const ctx = browser.contexts()[0];
  const pg = await ctx.newPage();

  try {
    // 1. 打开 Products 页面
    log(`🚀 打开 Shopify Products 页面...`);
    await pg.goto(`https://admin.shopify.com/store/${SHOP}/products`, {
      timeout: 40000,
      waitUntil: 'domcontentloaded'
    });
    await pg.waitForTimeout(15000); // 等 Cloudflare 验证 + 骨架屏

    // 检查是否跳登录页
    const curUrl = pg.url();
    if (curUrl.includes('accounts.shopify.com')) {
      log(`❌ Session 已过期，需要重新登录`);
      await browser.close();
      process.exit(1);
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

    // 3. 选择 CSV 模式
    log(`🔘 选择 CSV 导入方式...`);
    const csvRadio = modal.locator('input[name="importMethodOptions"][value="csv"]').first();
    if (await csvRadio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await csvRadio.click({ force: true });
      log(`   ✅ 已选择 CSV`);
    }

    // 4. 点"下一步"
    log(`➡️ 点击"下一步"...`);
    const nextBtn = modal.locator('button:has-text("下一步")').first();
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.click({ force: true });
      log(`   ✅ 已点击`);
      await pg.waitForTimeout(3000);
    } else {
      log(`   ⚠️ 未找到"下一步"按钮，等待后重试...`);
      await pg.waitForTimeout(3000);
      if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextBtn.click({ force: true });
        log(`   ✅ 重试成功`);
        await pg.waitForTimeout(3000);
      }
    }

    // 5. 上传 CSV
    log(`📁 上传 CSV: ${csvPath}`);
    let uploaded = false;
    for (let i = 0; i < 8; i++) {
      const count = await modal.locator('input[type="file"]').count();
      if (count > 0) {
        await modal.locator('input[type="file"]').first().setInputFiles(csvPath, { force: true });
        uploaded = true;
        log(`   ✅ 文件已选择`);
        break;
      }
      await pg.waitForTimeout(1000);
    }
    if (!uploaded) throw new Error('找不到 file input 上传CSV');

    await pg.waitForTimeout(1000);

    // 6. 点"上传并预览"
    log(`🔍 查找"上传并预览"按钮...`);
    const confirmBtn = modal.locator('button:has-text("上传并预览")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click({ force: true });
      log(`   ✅ 已点击`);
    }

    // 7. 等待预览画面（最多20秒）
    log(`🔍 等待预览画面...`);
    let previewFound = false;
    for (let i = 0; i < 20; i++) {
      const previewBtn = pg.locator('button:has-text("导入产品")').first();
      if (await previewBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        log(`   ✅ 找到"导入产品"按钮（第${i+1}次）`);
        await previewBtn.click({ force: true });
        previewFound = true;
        break;
      }
      await pg.waitForTimeout(1000);
    }
    if (!previewFound) {
      log(`⚠️ 未找到预览按钮，跳过点击`);
    }

    // 8. 等待处理完成
    log(`⏳ 等待导入处理（30s）...`);
    await pg.waitForTimeout(30000);

    // 9. 检查错误
    const errorEls = [
      '.Polaris-Banner--variantCritical',
      '.Polaris-Banner--variantWarning',
    ];
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
    await pg.screenshot({ path: `/root/.openclaw/workspace_shop/csv-import-final-${Date.now()}.png`, fullPage: true });

  } finally {
    await pg.close().catch(() => {});
    try { await browser.kill(); } catch {}
  }
}

// ==================== 主流程 ====================
async function main() {
  // Step 1: 处理 CSV（图片上传 + 路径替换）
  const { headers, rows, uploaded } = await processCSV();

  const totalImages = uploaded.size;
  const successImages = Array.from(uploaded.values()).filter(v => v !== null).length;
  log(`📊 图片上传: ${successImages}/${totalImages} 成功`);

  // Step 2: 浏览器导入
  await importToShopify(CSV_OUTPUT);
}

main().catch(e => { console.error(`❌ 错误: ${e.message}`); process.exit(1); });
