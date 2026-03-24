#!/usr/bin/env node
/**
 * Shopify 商品发布脚本 v2 - 模拟人工操作
 * 
 * 已验证可用的选择器：
 * - 标题: input[name="title"] (id动态变化用name稳定定位)
 * - 价格: input[name="price"]
 * - Product Options: 
 *   - 按钮: button:has-text("添加尺寸或颜色等选项")
 *   - 选项名: input[name="optionName[0]"]
 *   - 选项值: input[name="optionValue[0][0]"]
 *   - 添加选项: button:has-text("添加其他选项")
 *   - 完成: button:has-text("完成")
 * - 变体价格: input.variant-price-input
 * - 变体SKU: input.variant-sku-input
 * - 保存: button:has-text("保存")
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json');
const LOCK_DIR = '/tmp/tk2shop-locks';
const TK_OUTPUT_DIR = '/root/.openclaw/TKdown';

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

function loadStores() {
  try { return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')).stores || []; }
  catch (e) { return []; }
}

function findStore(query) {
  const stores = loadStores();
  if (!query) return stores[0] || null;
  const q = query.toLowerCase();
  for (const s of stores) {
    if (s.profileNo === parseInt(query)) return s;
    if ((s.storeId||'').toLowerCase().includes(q) || (s.name||'').toLowerCase().includes(q)) return s;
  }
  return null;
}

// ====== 锁机制 ======
function mkdirp(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
}

function acquireLock(profileNo, timeoutMs = 30000) {
  mkdirp(LOCK_DIR);
  const lockFile = path.join(LOCK_DIR, `profile-${profileNo}.lock`);
  const start = Date.now();
  while (true) {
    if (!fs.existsSync(lockFile)) {
      fs.writeFileSync(lockFile, String(process.pid), 'utf8');
      return lockFile;
    }
    // 锁文件存在，检查是否过期（超过2分钟视为孤儿锁）
    const age = Date.now() - fs.statSync(lockFile).mtimeMs;
    if (age > 120000) {
      log(`⚠️ 清除过期锁文件 (age=${Math.round(age/1000)}s): ${lockFile}`);
      fs.unlinkSync(lockFile);
      fs.writeFileSync(lockFile, String(process.pid), 'utf8');
      return lockFile;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`获取 profile ${profileNo} 锁超时（等待${Math.round(timeoutMs/1000)}s），可能有其他进程正在使用`);
    }
    const waited = Math.round((Date.now() - start) / 1000);
    log(`   等待锁释放... (已等${waited}s)`);
    sleepSync(2);
  }
}

function sleepSync(seconds) {
  execSync(`sleep ${seconds}`, {stdio:'ignore', timeout: seconds + 5});
}

function releaseLock(lockFile) {
  try { if (lockFile && fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch(e) {}
}

// ====== 浏览器状态检测 ======
function isProfileActive(profileNo) {
  try {
    const out = execSync(
      `npx --yes adspower-browser get-browser-active '{"profileNo":"${profileNo}"}' 2>/dev/null`,
      {encoding:'utf8', timeout:15000}
    );
    // 输出格式: "Browser active info: {\n  "status": "Active"\n}"
    return out.includes('"status": "Active"');
  } catch (e) {
    return false;
  }
}

/**
 * 打开或连接浏览器
 * @returns {{ cdpUrl: string, isNew: boolean }}
 *   - isNew=true: 本次新建的CDP连接，需要用完关闭浏览器
 *   - isNew=false: 复用的已有连接，用完只关Tab不关浏览器
 */
function openBrowser(profileNo) {
  // 先检查是否已有浏览器运行
  if (isProfileActive(profileNo)) {
    log(`🔁 检测到 profile ${profileNo} 已有浏览器运行，尝试连接...`);
    try {
      const out = execSync(
        `npx --yes adspower-browser list 2>/dev/null`,
        {encoding:'utf8', timeout:15000}
      );
      const data = JSON.parse(out);
      const browser = (data.data || []).find(b => b.user_id === String(profileNo));
      if (browser && browser.webdriver && browser.webdriver.startsWith('ws')) {
        log(`🔌 复用已有 CDP: ${browser.webdriver}`);
        return { cdpUrl: browser.webdriver, isNew: false };
      }
    } catch (e) {
      log(`   列表查询失败，将重新打开: ${e.message}`);
    }
    throw new Error(`profile ${profileNo} 的浏览器已被其他进程占用，请先关闭后再试`);
  }

  log(`🔓 打开 AdsPower 浏览器 (profileNo: ${profileNo})...`);
  const out = execSync(`npx --yes adspower-browser open-browser '{"profileNo":"${profileNo}"}' 2>&`, {encoding:'utf8', timeout:90000});
  const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
  if (!match) throw new Error('无法获取CDP URL: ' + out.slice(0,200));
  log(`🔌 CDP: ${match[1]} (新建连接)`);
  return { cdpUrl: match[1], isNew: true };
}

function closeBrowser(profileNo) {
  try { execSync(`npx --yes adspower-browser close-browser '{"profileNo":"${profileNo}"}' 2>&`, {encoding:'utf8', timeout:30000}); }
  catch (e) {}
}

async function uploadProduct(folderPath, store) {
  const productJsonPath = path.join(TK_OUTPUT_DIR, folderPath, 'product.json');
  if (!fs.existsSync(productJsonPath)) { console.error(`❌ product.json 不存在: ${folderPath}`); process.exit(1); }

  const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
  const meta = product._meta || {};
  const skus = meta.skus || [];
  log(`📦 发布商品: ${product.title}`);
  log(`   目录: ${folderPath}`);
  log(`   店铺: ${store.name} (profile: ${store.profileNo})`);
  log(`   SKU变体: ${skus.length}个`);

  // 收集图片
  const imagesDir = path.join(TK_OUTPUT_DIR, folderPath, 'images');
  const mainImages = [], descImages = [];
  if (fs.existsSync(imagesDir)) {
    for (const f of fs.readdirSync(imagesDir).filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f)).sort()) {
      if (f.startsWith('desc_')) descImages.push(path.join(imagesDir, f));
      else mainImages.push(path.join(imagesDir, f));
    }
  }
  log(`📷 主图: ${mainImages.length}张, 描述图: ${descImages.length}张`);

  // 获取锁，防止多进程同时使用同一 profile
  let lockFile;
  try {
    lockFile = acquireLock(store.profileNo);
    log(`🔒 已锁定 profile ${store.profileNo}`);
  } catch (e) {
    console.error(`❌ 获取锁失败: ${e.message}`);
    process.exit(1);
  }

  let browser;
  let cdpResult;
  try {
    cdpResult = openBrowser(store.profileNo);
    browser = await chromium.connectOverCDP(cdpResult.cdpUrl);
  } catch (e) {
    console.error(`❌ 打开浏览器失败: ${e.message}`);
    // 让异常传播到 finally 清理（finally 会根据 cdpResult.isNew 决定是否关浏览器）
    throw e;
  }

  const ctx = browser.contexts()[0];
  // 先关闭所有已存在的 tabs，只保留新创建的一个
  const existingPages = ctx.pages();
  if (existingPages.length > 1) {
    for (const p of existingPages) {
      if (!p.isClosed()) await p.close().catch(() => {});
    }
  }
  const pg = await ctx.newPage();  // 新建Tab

  try {
    const slug = store.shopifySlug || 'vellin1122';
    log(`🚀 打开 Shopify 新建商品页`);
    await pg.goto(`https://admin.shopify.com/store/${slug}/products/new`, {timeout:40000, waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(12000); // 等待React完全渲染

    // ========== 1. 填标题 ==========
    log(`✍️ 填写标题...`);
    const titleInput = pg.locator('input[name="title"]').first();
    await titleInput.waitFor({state:'visible', timeout:10000});
    await titleInput.click();
    await titleInput.fill('');
    await titleInput.type(product.title);
    log(`   ✅ 标题已填写`);

    // ========== 2. 填价格（主价格 = 最低价） ==========
    if (skus.length > 0) {
      const prices = skus.map(s => parseFloat(s.price)).filter(p => !isNaN(p));
      const minPrice = Math.min(...prices).toFixed(2);
      const maxCompare = Math.max(...skus.map(s => parseFloat(s.compareAtPrice)).filter(p => !isNaN(p))).toFixed(2);
      const priceInput = pg.locator('input[name="price"]');
      if (await priceInput.isVisible({timeout:3000}).catch(()=>false)) {
        await priceInput.click();
        await priceInput.fill(minPrice);
        log(`   ✅ 现价: $${minPrice}`);
      }
      if (maxCompare && maxCompare !== 'NaN') {
        const compareInput = pg.locator('input[name="compareAtPrice"]');
        if (await compareInput.isVisible({timeout:2000}).catch(()=>false)) {
          await compareInput.fill(maxCompare);
          log(`   ✅ 划线价: $${maxCompare}`);
        }
      }
    }

        // ========== 3. 上传图片（主图+描述图，一次上传） ==========
    const allImages = [...mainImages, ...descImages];
    if (allImages.length > 0) {
      log(":// 上传" + allImages.length + "张图片...");
      await pg.evaluate(() => window.scrollTo(0, 400));
      await pg.waitForTimeout(500);
      try {
        const fileInput = pg.locator('input#:r1f:');
        await fileInput.setInputFiles(allImages);
        log('   waiting for upload 60s...');
        await pg.waitForTimeout(60000);
        log('   done: ' + allImages.length + ' images');
      } catch (e) { log('   upload failed: ' + e.message); }
    }

// ========== 4. Product Options ==========
    if (skus.length > 1) {
      log(`🔧 设置Product Options...`);
      await pg.evaluate(() => window.scrollTo(0, 1500));
      await pg.waitForTimeout(1000);

      const addOptBtn = pg.locator('button:has-text("添加尺寸或颜色等选项")').first();
      if (!(await addOptBtn.isVisible({timeout:2000}).catch(()=>false))) {
        await pg.evaluate(() => window.scrollTo(0, 800));
        await pg.waitForTimeout(500);
      }
      if (await addOptBtn.isVisible({timeout:3000}).catch(()=>false)) {
        await addOptBtn.click();
        await pg.waitForTimeout(3000);
        log(`   对话框已打开`);

        // 删除已有选项（如果有遗留）
        const delBtn = pg.locator('button:has-text("删除")').first();
        if (await delBtn.isVisible({timeout:1000}).catch(()=>false)) {
          await delBtn.click();
          await pg.waitForTimeout(500);
        }

        // 从SKU名称提取选项
        // SKU格式: "(xxx) iPhone" -> Color/Size=xxx, Port=iPhone (用)分隔)
        //         "2 PCS-Type C" -> Color/Size=2 PCS, Port=Type C (用最后一个-分隔)
        const option1Vals = [...new Set(skus.map(s => {
          if (s.name.includes(') ')) {
            return s.name.split(') ')[0].replace(/^\(/, '').trim();
          } else {
            const hyIdx = s.name.lastIndexOf('-');
            return hyIdx > 0 ? s.name.slice(0, hyIdx).trim() : s.name.trim();
          }
        }).filter(Boolean))];
        const option2Vals = [...new Set(skus.map(s => {
          if (s.name.includes(') ')) {
            return s.name.split(') ')[1]?.trim();
          } else {
            const hyIdx = s.name.lastIndexOf('-');
            return hyIdx > 0 ? s.name.slice(hyIdx + 1).trim() : '';
          }
        }).filter(Boolean))];

        // 选项1
        const opt1Name = pg.locator('input[name="optionName[0]"]');
        await opt1Name.waitFor({state:'visible', timeout:8000});
        await opt1Name.fill('Color/Size');
        await pg.waitForTimeout(500);

        const val1 = pg.locator('input[name="optionValue[0][0]"]');
        await val1.fill(option1Vals[0]);
        await val1.press('Enter');
        await pg.waitForTimeout(300);
        for (let i = 1; i < option1Vals.length; i++) {
          await val1.fill(option1Vals[i]);
          await val1.press('Enter');
          await pg.waitForTimeout(300);
        }
        log(`   ✅ Color/Size: ${option1Vals.join(', ')}`);

        // 选项2
        if (option2Vals.length > 0) {
          const addOpt2 = pg.locator('button:has-text("添加其他选项")').first();
          if (await addOpt2.isVisible({timeout:2000}).catch(()=>false)) {
            await addOpt2.click();
            await pg.waitForTimeout(1200);
          }
          const opt2Name = pg.locator('input[name="optionName[1]"]');
          if (await opt2Name.isVisible({timeout:3000}).catch(()=>false)) {
            await opt2Name.fill('Port');
            await pg.waitForTimeout(500);
          }
          const val2 = pg.locator('input[name="optionValue[1][0]"]');
          await val2.fill(option2Vals[0]);
          await val2.press('Enter');
          await pg.waitForTimeout(300);
          for (let i = 1; i < option2Vals.length; i++) {
            await val2.fill(option2Vals[i]);
            await val2.press('Enter');
            await pg.waitForTimeout(300);
          }
          log(`   ✅ Port: ${option2Vals.join(', ')}`);
        }

        const doneBtn = pg.locator('button:has-text("完成")').first();
        if (await doneBtn.isVisible({timeout:3000}).catch(()=>false)) {
          await doneBtn.click();
          await pg.waitForTimeout(3000);
          log(`   ✅ Product Options 完成`);
        }
      }
    }

    // ========== 5. 填每个变体的价格和SKU ==========
    if (skus.length > 0) {
      log(`📋 填写变体详情...`);
      await pg.evaluate(() => window.scrollTo(0, 400));
      await pg.waitForTimeout(2000);
      for (let i = 0; i < skus.length; i++) {
        const sku = skus[i];
        const variantName = sku.name; // e.g. "2 PCS-iPhone"
        try {
          const row = pg.locator(`button:has-text("${variantName}")`).first();
          if (await row.isVisible({timeout:2000}).catch(()=>false)) {
            await row.click();
            await pg.waitForTimeout(1500);
          }
          const pf = pg.locator('input.variant-price-input').first();
          if (await pf.isVisible({timeout:2000}).catch(()=>false)) {
            await pf.fill(sku.price);
            log(`   ✅ ${variantName}: $${sku.price}`);
          }
          const sf = pg.locator('input.variant-sku-input').first();
          if (await sf.isVisible({timeout:2000}).catch(()=>false)) {
            await sf.fill(sku.sku || `TK-${sku.price}`);
            log(`      SKU: ${sku.sku || `TK-${sku.price}`}`);
          }
          await pg.keyboard.press('Escape');
          await pg.waitForTimeout(400);
        } catch (e) { log(`   ⚠️ ${variantName}: ${e.message}`); }
      }
    }

    // ========== 6. 填描述（通过TinyMCE iframe） ==========
    log(`📝 填写描述...`);
    await pg.evaluate(() => window.scrollTo(0, 300));
    await pg.waitForTimeout(500);
    try {
      const fl = pg.frameLocator('iframe#product-description-rn_ifr');
      await fl.locator('#tinymce').waitFor({state:'attached', timeout: 10000});
      await pg.waitForTimeout(500);
      await fl.locator('#tinymce').click();
      await pg.waitForTimeout(500);
      await fl.locator('#tinymce').type(product.description || '', {delay: 15});
      log(`   ✅ 描述已填写`);
    } catch (e) { log(`   ⚠️ 描述失败: ${e.message}`); }

    // ========== 7. 保存 ==========
    log(`💾 保存商品...`);
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(500);
    const saveBtn = pg.locator('button:has-text("保存"), button:has-text("Save")').first();
    await saveBtn.waitFor({state:'visible', timeout:5000});
    await saveBtn.click();
    await pg.waitForTimeout(8000);

    const finalUrl = pg.url();
    const productId = finalUrl.match(/\/products\/(\d+)/);
    if (productId) {
      log(`\n✅ 商品发布成功!`);
      log(`   ID: ${productId[1]}`);
      log(`   URL: ${finalUrl}`);
    } else {
      log(`⚠️ 保存完成，URL: ${finalUrl}`);
    }
    await pg.screenshot({path: path.join(TK_OUTPUT_DIR, folderPath, `published-${Date.now()}.png`), fullPage: true});

  } catch (e) {
    console.error(`❌ 错误: ${e.message}`);
    await pg.screenshot({path: `/root/.openclaw/workspace_shop/error-${Date.now()}.png`}).catch(()=>{});
  } finally {
    // 关闭新建的Tab（pg可能未定义）
    if (pg) {
      try { await pg.close(); log('🔚 已关闭新建的Tab'); } catch (e) {}
    }

    // 根据是否新建CDP连接来决定关闭策略（browser/cdpResult可能未定义）
    if (cdpResult && cdpResult.isNew) {
      if (browser) {
        log('🔓 关闭浏览器 (新建CDP连接)');
        try { await browser.close(); } catch (e) {}
      }
      closeBrowser(store.profileNo);
    } else if (browser) {
      log('🔗 断开CDP连接 (复用已有浏览器)');
      try { await browser.disconnect(); } catch (e) {}
    }

    // 释放锁（lockFile可能未定义）
    if (lockFile) {
      releaseLock(lockFile);
      log(`🔓 已释放 profile ${store.profileNo} 锁`);
    }
  }
}

// CLI
const args = process.argv.slice(2);
let folder = '', storeQuery = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--store' && args[i+1]) { storeQuery = args[++i]; }
  else if (args[i].includes('/')) folder = args[i];
}
if (!folder) { console.error('❌ 请指定商品目录'); process.exit(1); }
const store = findStore(storeQuery);
if (!store) { console.error(`❌ 未找到店铺: ${storeQuery||'default'}`); process.exit(1); }
uploadProduct(folder, store).catch(e => { console.error('❌ 错误:', e.message); process.exit(1); });
