#!/usr/bin/env node
/**
 * Shopify 导入后主题编辑最小闭环脚本
 *
 * 目标：
 * 1. 连接 AdsPower 浏览器
 * 2. 从当前 Shopify 后台上下文进入 Theme Editor
 * 3. 切到 Product
 * 4. 创建模板
 * 5. 进入 Multicolumn
 * 6. 成功后停住
 *
 * 用法：
 *   node post-import-theme-setup.js --store vellin1122 --template-name demo123
 */

const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    storeQuery: '',
    productDir: '',
    templateName: '',
    productId: '',
  };

  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === '--store' && args[i + 1]) out.storeQuery = args[++i];
    else if (cur === '--product-dir' && args[i + 1]) out.productDir = args[++i];
    else if (cur === '--template-name' && args[i + 1]) out.templateName = args[++i];
    else if (cur === '--product-id' && args[i + 1]) out.productId = args[++i];
    else if (cur === '--help' || cur === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`用法:\n  node post-import-theme-setup.js --store <店铺ID> [--product-dir <商品目录>] [--template-name <模板名>] [--product-id <Shopify商品ID>]`);
}

function loadStores() {
  try {
    const data = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
    return data.stores || [];
  } catch (e) {
    throw new Error(`读取 stores.json 失败: ${e.message}`);
  }
}

function formatTimestampTemplateName(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function resolveProductDir(productDirArg) {
  if (!productDirArg) return '';
  if (path.isAbsolute(productDirArg)) return productDirArg;
  return path.join('/root/.openclaw/TKdown', productDirArg);
}

function loadReviewAssets(productDirArg) {
  const productDir = resolveProductDir(productDirArg);
  if (!productDir) {
    return { productDir: '', reviews: [] };
  }

  const productJsonPath = path.join(productDir, 'product.json');
  if (!fs.existsSync(productJsonPath)) {
    throw new Error(`未找到 product.json: ${productJsonPath}`);
  }

  const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
  const reviews = Array.isArray(product?.templateAssets?.reviews) ? product.templateAssets.reviews : [];
  if (reviews.length < 3) {
    throw new Error(`评论素材不足，至少需要 3 条，当前=${reviews.length}`);
  }

  const normalized = reviews.slice(0, 3).map((item, idx) => {
    const name = String(item?.name || '').trim();
    const content = String(item?.content || '').trim();
    if (!name || !content) {
      throw new Error(`第 ${idx + 1} 条评论缺少 name/content`);
    }
    return { name, content };
  });

  return { productDir, reviews: normalized, product };
}

function findStore(query) {
  const stores = loadStores();
  if (!query) {
    if (stores.length === 1) return stores[0];
    throw new Error(`未指定店铺，且 stores.json 中有 ${stores.length} 个店铺，请用 --store <ID> 指定`);
  }
  const q = String(query).toLowerCase();
  const store = stores.find(s =>
    String(s.storeId || '').toLowerCase() === q ||
    String(s.name || '').toLowerCase() === q ||
    String(s.shopifySlug || '').toLowerCase() === q ||
    String(s.profileNo || '') === String(query)
  );
  if (!store) {
    throw new Error(`未找到店铺: ${query}`);
  }
  return store;
}

function getActiveBrowser(profileNo) {
  try {
    const out = execSync(
      `npx --yes adspower-browser get-browser-active '{"profileNo":"${profileNo}"}' 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();

    const jsonText = out.replace(/^Browser active info:\s*/i, '').trim();
    const data = JSON.parse(jsonText);
    const browser = data?.data || data;
    if (!browser) return null;

    const status = String(browser.status || '').toLowerCase();
    const wsPuppeteer = browser.ws?.puppeteer || browser.webdriver || '';
    const debugPort = browser.debug_port || browser.ws?.debug_port || '';
    const active = status === 'active' || Boolean(wsPuppeteer) || Boolean(debugPort);

    if (!active) return null;

    return {
      status: browser.status || '',
      cdpUrl: wsPuppeteer || '',
      debugPort: debugPort || '',
      raw: browser,
    };
  } catch (e) {
    return null;
  }
}

function isProfileActive(profileNo) {
  return Boolean(getActiveBrowser(profileNo));
}

async function resolveHealthyCdp(profileNo, preferNew = false) {
  const maxAttempts = preferNew ? 4 : 4;
  let triedActiveReuse = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let candidate = null;

    const allowReuse = !preferNew && !triedActiveReuse;
    if (allowReuse) {
      const activeBrowser = getActiveBrowser(profileNo);
      if (activeBrowser?.cdpUrl && activeBrowser.cdpUrl.startsWith('ws')) {
        candidate = { cdpUrl: activeBrowser.cdpUrl, isNew: false };
        triedActiveReuse = true;
        log(`🔌 尝试复用 CDP (${attempt}/${maxAttempts}): ${candidate.cdpUrl}`);
      }
    }

    if (!candidate) {
      log(`🔓 打开 AdsPower 浏览器以刷新 CDP (${attempt}/${maxAttempts})...`);
      const opened = await new Promise((resolve, reject) => {
        const jsonArg = JSON.stringify({ profileNo: String(profileNo) });
        const p = spawn('npx', ['--yes', 'adspower-browser', 'open-browser', jsonArg], { timeout: 90000 });
        let out = '';
        p.stdout.on('data', d => out += d);
        p.stderr.on('data', d => out += d);
        p.on('close', code => {
          if (code !== 0) {
            return reject(new Error('open-browser 失败: ' + out.slice(0, 300)));
          }
          const match = out.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
          if (!match) {
            return reject(new Error('无法获取 CDP URL: ' + out.slice(0, 300)));
          }
          resolve({ cdpUrl: match[1], isNew: true });
        });
        p.on('error', reject);
      });
      candidate = opened;
      log(`🔌 候选 CDP (${attempt}/${maxAttempts}): ${candidate.cdpUrl}`);
    }

    try {
      const testBrowser = await chromium.connectOverCDP(candidate.cdpUrl);
      try { await testBrowser.disconnect(); } catch (e) {}
      return candidate;
    } catch (err) {
      log(`⚠️ CDP 不可用 (${attempt}/${maxAttempts}): ${String(err.message || err).split('\n')[0]}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  throw new Error(`未拿到可用的 AdsPower CDP（profileNo=${profileNo}）`);
}

function openBrowser(profileNo) {
  return resolveHealthyCdp(profileNo, false);
}

function closeBrowser(profileNo) {
  return new Promise(resolve => {
    try {
      const jsonArg = JSON.stringify({ profileNo: String(profileNo) });
      const p = spawn('npx', ['--yes', 'adspower-browser', 'close-browser', jsonArg], { timeout: 30000 });
      p.on('close', () => resolve());
      p.on('error', () => resolve());
    } catch (e) {
      resolve();
    }
  });
}

async function waitForProfileInactive(profileNo, options = {}) {
  const retries = options.retries || 4;
  const intervalMs = options.intervalMs || 3000;

  for (let i = 1; i <= retries; i++) {
    const active = isProfileActive(profileNo);
    log(`🔍 检查 AdsPower profile 状态 (${i}/${retries}): ${active ? 'Active' : 'Inactive'}`);
    if (!active) return true;
    if (i < retries) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  return false;
}

async function ensureProfileClosed(profileNo) {
  await closeBrowser(profileNo);
  let inactive = await waitForProfileInactive(profileNo, { retries: 3, intervalMs: 2500 });
  if (inactive) return true;

  log('⚠️ Profile 关闭后仍显示 Active，执行一次兜底 close-browser...');
  await closeBrowser(profileNo);
  inactive = await waitForProfileInactive(profileNo, { retries: 4, intervalMs: 3000 });
  return inactive;
}

async function findCurrentAdminPage(context, slug) {
  const pages = context.pages();
  for (const page of pages) {
    const url = page.url();
    if (url.includes(`admin.shopify.com/store/${slug}/`)) {
      return page;
    }
  }
  return null;
}

function isEditorUrl(url) {
  return /admin\.shopify\.com\/store\/[^/]+\/themes\/\d+\/editor/.test(url || '');
}

function normalizeEditorUrl(url, slug) {
  if (!url) return `https://admin.shopify.com/store/${slug}/themes`;
  return url.replace(/\/store\/[^/]+\/themes\//, `/store/${slug}/themes/`);
}

async function getVisibleFrameByUrl(page, matcher) {
  const frames = page.frames();
  for (const frame of frames) {
    const url = frame.url() || '';
    if (matcher(url)) {
      try {
        const body = frame.locator('body');
        if (await body.count()) return frame;
      } catch (e) {}
    }
  }
  return null;
}

async function getThemeAppFrame(page) {
  const frames = page.frames();
  for (const frame of frames) {
    try {
      const url = frame.url() || '';
      const text = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (
        /online-store-web\.shopifyapps\.com\/themes/i.test(url)
        || /Current theme|Theme library|Customize|Edit code|Add theme|Theme actions/i.test(text)
      ) {
        return frame;
      }
    } catch (e) {}
  }
  return null;
}

async function waitForThemePageReady(page, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (/themes|theme|Online Store|Current theme|Edit theme|Publish/i.test(bodyText)) {
      return true;
    }
    const frames = page.frames();
    for (const frame of frames) {
      const text = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (/Current theme|Edit theme|Publish/i.test(text)) {
        return true;
      }
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

async function logThemesDebug(page) {
  const topUrl = page.url();
  const topText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1200);
  log(`🧾 themes 顶层URL: ${topUrl}`);
  if (topText) log(`🧾 themes 顶层摘要: ${topText}`);

  const frames = page.frames();
  log(`🧩 当前 frame 数量: ${frames.length}`);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const url = frame.url() || '';
    const text = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
    log(`   [frame ${i}] ${url || '(empty-url)'}`);
    if (text) log(`   [frame ${i}] 文本: ${text}`);
  }
}

async function waitForEditorReady(page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (/Home page|Product|Collection|Create template|Assigned to \d+ product|Multicolumn|Theme settings/i.test(bodyText)) {
      return true;
    }
    const frames = page.frames();
    for (const frame of frames) {
      const text = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      if (/Home page|Product|Collection|Create template|Assigned to \d+ product|Multicolumn|Theme settings/i.test(text)) {
        return true;
      }
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

async function logEditorDebug(page) {
  const topUrl = page.url();
  const topText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1200);
  log(`🧾 editor 顶层URL: ${topUrl}`);
  if (topText) log(`🧾 editor 顶层摘要: ${topText}`);

  const frames = page.frames();
  log(`🧩 editor 当前 frame 数量: ${frames.length}`);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const url = frame.url() || '';
    const text = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
    log(`   [editor frame ${i}] ${url || '(empty-url)'}`);
    if (text) log(`   [editor frame ${i}] 文本: ${text}`);
  }
}

async function gotoThemesAndGetEditorUrl(page, slug) {
  const themesUrl = `https://admin.shopify.com/store/${slug}/themes`;
  log(`🚀 进入主题页: ${themesUrl}`);
  await page.goto(themesUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await waitForThemePageReady(page, 45000);
  await page.waitForTimeout(5000);

  let frame = null;
  for (let i = 0; i < 8 && !frame; i++) {
    frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes/.test(url));
    if (!frame) frame = await getThemeAppFrame(page);
    if (!frame && i === 2) {
      await logThemesDebug(page);
    }
    if (!frame) {
      await page.waitForTimeout(2000);
    }
  }

  if (!frame) {
    await logThemesDebug(page);
    throw new Error('未找到 Shopify Themes 主体 iframe');
  }

  log('✅ 已进入主题页主体 iframe');

  const editLink = frame.locator('a[href*="/editor"]').first();
  await editLink.waitFor({ state: 'visible', timeout: 20000 });
  const href = await editLink.getAttribute('href');
  if (!href) {
    throw new Error('未找到 Theme Editor 链接');
  }

  const editorUrl = href.startsWith('http') ? href : `https://admin.shopify.com${href}`;
  log(`🎯 Theme Editor 链接: ${editorUrl}`);
  return editorUrl;
}

async function openEditorAndGetFrame(page, editorUrl) {
  log('🚀 打开 Theme Editor...');
  await page.goto(editorUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });

  const started = Date.now();
  const maxWaitMs = 120000;
  while (Date.now() - started < maxWaitMs) {
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (/Your connection needs to be verified before you can proceed/i.test(bodyText)) {
      log('⏳ Theme Editor 命中验证页，继续等待自动放行...');
      await page.waitForTimeout(5000);
      continue;
    }

    await waitForEditorReady(page, 10000).catch(() => {});
    await page.waitForTimeout(2000);

    let frame = null;
    const editorIframe = page.locator('iframe._Frame_1vogr_1[title="Online Store"]').first();
    if (await editorIframe.count().catch(() => 0)) {
      frame = await editorIframe.contentFrame();
    }

    if (!frame) {
      frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes\/.+\/editor/.test(url));
    }
    if (!frame) {
      frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes\/.*/.test(url));
    }
    if (!frame) {
      frame = await getVisibleFrameByUrl(page, url => /shopifyapps\.com/.test(url));
    }
    if (frame) {
      log('✅ 已进入 Theme Editor 主体 iframe');
      return frame;
    }

    await page.waitForTimeout(3000);
  }

  await logEditorDebug(page);
  throw new Error('未找到 Theme Editor 主体 iframe');
}

async function switchToProductAndCreateTemplate(frame, page, templateName) {
  log('🔄 打开顶部模板切换...');
  const pickerBtn = frame.locator('[aria-controls="topbar-picker-templates"]').first();
  await pickerBtn.waitFor({ state: 'visible', timeout: 20000 });
  await pickerBtn.click();
  await page.waitForTimeout(2500);

  log('📦 切到 Product 模板...');
  const productBtn = frame.locator('li#PRODUCT button').first();
  await productBtn.waitFor({ state: 'visible', timeout: 15000 });
  await productBtn.click();
  await page.waitForTimeout(2500);

  log('🆕 点击 Create template...');
  const createBtn = frame.locator('li#__create__ button').first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });
  await createBtn.click();
  await page.waitForTimeout(2500);

  const modal = frame.locator('.Polaris-Modal-Dialog__Container, .Polaris-Modal-Dialog--alignSelfCenter').first();
  await modal.waitFor({ state: 'visible', timeout: 15000 });

  log(`⌨️ 输入模板名: ${templateName}`);
  const input = modal.locator('input').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await input.fill('');
  await input.type(templateName, { delay: 80 });
  await page.waitForTimeout(500);

  const finalValue = await input.inputValue().catch(() => '');
  if (!finalValue || finalValue.replace(/\s+/g, '') !== templateName.replace(/\s+/g, '')) {
    throw new Error(`模板名输入失败，期望=${templateName}，实际=${finalValue}`);
  }

  const confirmBtn = modal.locator('button:has-text("Create template"), button:has-text("创建模板")').last();
  await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
  await confirmBtn.click();
  await page.waitForTimeout(6000);

  log('✅ 已创建并进入新 Product 模板');
}

async function openMulticolumn(frame, page) {
  log('🎯 进入 Multicolumn...');
  const row = frame.locator('li[data-component-extra-section_type="multicolumn"]').first();
  await row.waitFor({ state: 'visible', timeout: 20000 });

  const primary = row.locator('button.Online-Store-UI-NavItem__PrimaryAction_1232d').first();
  await primary.waitFor({ state: 'visible', timeout: 10000 });
  await primary.click();
  await page.waitForTimeout(4000);

  const bodyText = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const successPatterns = [
    /Add Column/i,
    /Heading/i,
    /Customer Reviews?/i,
    /Color scheme/i,
    /Remove section/i,
  ];
  const columnCount = (bodyText.match(/Column/gi) || []).length;
  const ok = successPatterns.some(re => re.test(bodyText)) || columnCount >= 3;

  if (!ok) {
    throw new Error(`进入 Multicolumn 失败，当前页面摘要: ${bodyText.slice(0, 1500)}`);
  }

  log('✅ 已进入 Multicolumn 编辑态');
}

async function setSlateTextboxText(locator, text) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await locator.click({ force: true });
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await locator.press('Backspace').catch(() => {});
  await locator.fill('').catch(() => {});
  await locator.type(text, { delay: 20 }).catch(async () => {
    await locator.pressSequentially(text, { delay: 20 });
  });
  await locator.locator('xpath=.').page().waitForTimeout(300).catch(() => {});

  const finalText = ((await locator.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const expected = text.replace(/\s+/g, ' ').trim();
  if (!finalText || !expected || !finalText.includes(expected.slice(0, Math.min(12, expected.length)))) {
    throw new Error(`文本框写入失败，期望=${text}，实际=${finalText}`);
  }
}

async function fillReviewColumns(frame, page, reviews) {
  const rows = frame.locator('li[data-component-extra-block_type="column"]');
  const count = await rows.count();
  if (count < 3) {
    throw new Error(`Column 数量不足，期望至少 3 个，实际=${count}`);
  }

  for (let i = 0; i < 3; i++) {
    const review = reviews[i];
    const row = rows.nth(i);
    const rowId = await row.getAttribute('id');
    if (!rowId) {
      throw new Error(`第 ${i + 1} 个 Column 缺少 id，无法定位主按钮`);
    }
    const primary = frame.locator(`button[aria-labelledby="${rowId}-label"]`).first();
    await primary.waitFor({ state: 'visible', timeout: 10000 });
    await primary.focus();
    await page.waitForTimeout(200);
    await primary.press('Enter');
    await page.waitForTimeout(1800);

    const bodyText = (await frame.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (!/Column Image|Heading|Column Description/i.test(bodyText)) {
      throw new Error(`进入第 ${i + 1} 个 Column 失败，当前摘要: ${bodyText.slice(0, 1200)}`);
    }

    const editors = frame.locator('[contenteditable="true"][role="textbox"]');
    const editorCount = await editors.count();
    if (editorCount < 2) {
      throw new Error(`第 ${i + 1} 个 Column 可编辑框不足，实际=${editorCount}`);
    }

    log(`✍️ 填写第 ${i + 1} 个 Column: ${review.name}`);
    await setSlateTextboxText(editors.nth(0), review.name);
    await setSlateTextboxText(editors.nth(1), review.content);
  }
}

async function saveTemplate(frame, page) {
  const saveBtn = frame.locator('button:has-text("Save")').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
  const before = await saveBtn.innerText().catch(() => '');
  log(`💾 点击模板保存: ${before || 'Save'}`);
  await saveBtn.click({ force: true });

  const saveStarted = Date.now();
  let saveSettled = false;
  while (Date.now() - saveStarted < 30000) {
    const btnText = ((await saveBtn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const disabled = await saveBtn.evaluate(el => {
      const ariaDisabled = el.getAttribute('aria-disabled');
      return ariaDisabled === 'true' || el.hasAttribute('disabled') || el.getAttribute('data-disabled') === 'true';
    }).catch(() => false);

    const frameText = ((await frame.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const stillEditing = /Column Image|Heading|Column Description|Add Column|Remove section/i.test(frameText);
    const saveIdle = /^(Save|Saved)$/i.test(btnText) || (!btnText && disabled);

    if (stillEditing && saveIdle) {
      saveSettled = true;
      log(`✅ 模板保存已落稳: btn=${btnText || '(空)'} disabled=${disabled}`);
      break;
    }

    await page.waitForTimeout(1000);
  }

  if (!saveSettled) {
    const finalBtnText = ((await saveBtn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    const finalBody = ((await frame.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 1200);
    throw new Error(`模板保存未确认完成: btn=${finalBtnText || '(空)'} body=${finalBody}`);
  }
}

function getProductAdminUrl(store, reviewAssets, argv = {}) {
  const explicitArg = String(argv?.productId || '').trim();
  const explicit = String(store.lastImportedProductId || store.productId || '').trim();
  const fromMeta = String(reviewAssets?.product?._shopify?.productId || reviewAssets?.product?.shopifyProductId || '').trim();
  const fromMemory = String(reviewAssets?.product?.contentMeta?.shopifyProductId || '').trim();
  const productId = explicitArg || explicit || fromMeta || fromMemory || '9159876346078';
  return `https://admin.shopify.com/store/${store.shopifySlug || store.storeId || store.name}/products/${productId}`;
}

async function exitEditor(frame, page) {
  log('↩️ 退出 Theme Editor...');
  await page.waitForTimeout(1500);
  const exitLink = frame.locator('a[aria-label="Exit"]').first();
  await exitLink.waitFor({ state: 'visible', timeout: 15000 });
  await exitLink.click({ force: true });
  await page.waitForTimeout(3000);
  log('✅ 已点击 Exit');
}

async function waitForProductEditorReady(page, timeoutMs = 60000) {
  const started = Date.now();
  let reloaded = false;
  let verifySeen = false;
  let verifySince = 0;
  let verifyReloaded = false;

  while (Date.now() - started < timeoutMs) {
    const currentUrl = page.url() || '';
    const bodyText = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const verifyBlocked = /Your connection needs to be verified before you can proceed/i.test(bodyText);

    if (verifyBlocked) {
      if (!verifySeen) {
        verifySeen = true;
        verifySince = Date.now();
        log('⚠️ 商品页命中 Shopify 连接校验，进入等待窗口...');
      }

      const verifyElapsed = Date.now() - verifySince;
      if (!verifyReloaded && verifyElapsed > 15000) {
        log('⚠️ 连接校验持续未消失，执行一次 reload 兜底...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        verifyReloaded = true;
      } else {
        await page.waitForTimeout(5000);
      }

      if (verifyElapsed > 45000) {
        throw new Error('商品编辑页被 Shopify 连接校验拦截，等待后仍未恢复');
      }
      continue;
    }

    if (verifySeen) {
      log('✅ Shopify 连接校验已消失，继续等待商品编辑页就绪...');
      verifySeen = false;
      verifySince = 0;
    }

    const onProductPage = /admin\.shopify\.com\/store\/[^/]+\/products\//i.test(currentUrl);
    const hasProductSignals = /Theme template|Product status|Variants|Organization|Inventory|Media|Pricing|Title|This page is ready/i.test(bodyText);

    const interactiveState = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const saveBtn = Array.from(document.querySelectorAll('button')).find(btn => /save/i.test(btn.textContent || ''));
      const internalSelects = Array.from(document.querySelectorAll('s-internal-select'));
      const themeHost = internalSelects.find(el => {
        const label = (el.getAttribute('label') || el.getAttribute('aria-label') || '').trim();
        return /Theme template/i.test(label);
      });
      const hasFormLike = Boolean(
        document.querySelector('form')
        || document.querySelector('input[name="title"]')
        || document.querySelector('[name="title"]')
        || document.querySelector('s-internal-select')
      );
      return {
        readyState: document.readyState,
        hasSaveBtn: Boolean(saveBtn),
        hasThemeHost: Boolean(themeHost),
        hasFormLike,
        bodyLen: text.length,
      };
    }).catch(() => ({ readyState: 'unknown', hasSaveBtn: false, hasThemeHost: false, hasFormLike: false, bodyLen: 0 }));

    if (onProductPage && hasProductSignals && (interactiveState.hasThemeHost || interactiveState.hasFormLike || interactiveState.hasSaveBtn)) {
      log(`✅ 商品编辑页已就绪: readyState=${interactiveState.readyState} save=${interactiveState.hasSaveBtn} theme=${interactiveState.hasThemeHost} form=${interactiveState.hasFormLike}`);
      return true;
    }

    if (onProductPage && !reloaded && Date.now() - started > Math.min(25000, Math.floor(timeoutMs / 2))) {
      log('⚠️ 已到商品页但仍未完全就绪，执行一次 reload 兜底...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      reloaded = true;
      await page.waitForTimeout(3000);
      continue;
    }

    await page.waitForTimeout(2000);
  }
  return false;
}

async function waitForThemeTemplateOption(page, templateName, timeoutMs = 45000) {
  const started = Date.now();
  let reloadCount = 0;

  while (Date.now() - started < timeoutMs) {
    const snapshot = await page.evaluate((template) => {
      const normalized = s => String(s || '').replace(/\s+/g, ' ').trim();
      const hosts = Array.from(document.querySelectorAll('s-internal-select'));
      const matched = hosts
        .map(host => {
          const label = normalized(
            host.getAttribute('label')
            || host.getAttribute('aria-label')
            || host.shadowRoot?.querySelector('label, .label, [part="label"]')?.textContent
            || ''
          );
          const inner = host.shadowRoot?.querySelector('select#select, select');
          if (!inner || !/Theme template/i.test(label)) return null;
          const options = Array.from(inner.options).map(opt => ({
            value: opt.value || '',
            text: normalized(opt.textContent),
          }));
          const optionHit = options.some(opt => opt.value === template || opt.text === template);
          return {
            label,
            value: inner.value || host.value || host.getAttribute('value') || '',
            optionHit,
            optionCount: options.length,
            optionsPreview: options.slice(0, 20),
          };
        })
        .filter(Boolean);

      const found = matched.find(item => item.optionHit);
      return {
        found: Boolean(found),
        target: found || null,
        candidates: matched.slice(0, 6),
      };
    }, templateName).catch(() => ({ found: false, target: null, candidates: [] }));

    if (snapshot.found) {
      log(`✅ 模板已同步到商品页下拉: ${templateName}`);
      return snapshot.target;
    }

    log(`⏳ 等待模板同步到商品页下拉: ${templateName}`);
    if (snapshot.candidates?.length) {
      log(`   当前下拉模板数: ${snapshot.candidates[0].optionCount}，最新可见: ${(snapshot.candidates[0].optionsPreview || []).map(x => x.text || x.value).slice(-3).join(', ') || '(空)'}`);
    }

    if (reloadCount < 2 && Date.now() - started > 12000 * (reloadCount + 1)) {
      reloadCount += 1;
      log(`🔄 商品页模板列表尚未同步，执行第 ${reloadCount} 次 reload...`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await waitForProductEditorReady(page, 30000).catch(() => false);
      continue;
    }

    await page.waitForTimeout(4000);
  }

  throw new Error(`新模板已创建，但商品页模板列表尚未同步: ${templateName}`);
}

async function bindThemeTemplateAndSave(page, templateName) {
  log(`🔗 绑定商品模板: ${templateName}`);
  await waitForThemeTemplateOption(page, templateName, 50000);

  const selectInfo = await page.waitForFunction(
    ({ templateName }) => {
      const normalized = s => String(s || '').replace(/\s+/g, ' ').trim();
      const containers = Array.from(document.querySelectorAll('section, [role="region"], form, div'))
        .filter(el => /Theme template/i.test(normalized(el.innerText || '')))
        .slice(0, 10);

      const candidateInfos = [];
      for (const container of containers) {
        const containerText = normalized(container.innerText || '');
        const hosts = Array.from(container.querySelectorAll('s-internal-select'));
        for (const host of hosts) {
          const label = normalized(
            host.getAttribute('label')
            || host.getAttribute('aria-label')
            || host.shadowRoot?.querySelector('label, .label, [part="label"]')?.textContent
            || ''
          );
          const inner = host.shadowRoot?.querySelector('select#select, select');
          if (!inner) continue;
          const value = inner.value || host.value || host.getAttribute('value') || '';
          const options = Array.from(inner.options).map(opt => ({
            value: opt.value || '',
            text: normalized(opt.textContent),
          }));
          const optionHit = options.some(opt => opt.value === templateName || opt.text === templateName);
          candidateInfos.push({
            label,
            value,
            optionHit,
            optionCount: options.length,
            containerText: containerText.slice(0, 240),
            optionsPreview: options.slice(0, 12),
          });
          if (optionHit) {
            host.setAttribute('data-openclaw-theme-template-target', '1');
            return {
              found: true,
              label,
              value,
              optionCount: options.length,
              optionsPreview: options.slice(0, 12),
              containerText: containerText.slice(0, 240),
              candidates: candidateInfos.slice(0, 6),
            };
          }
        }
      }

      return {
        found: false,
        candidates: candidateInfos.slice(0, 6),
      };
    },
    { templateName },
    { timeout: 45000 }
  );

  const info = await selectInfo.jsonValue();
  if (!info?.found) {
    throw new Error(`未找到 Theme template 控件: ${JSON.stringify(info?.candidates || [])}`);
  }

  log(`   命中控件: label=${info.label || '(空)'} value=${info.value || '(空)'} optionCount=${info.optionCount}`);
  const select = page.locator('s-internal-select[data-openclaw-theme-template-target="1"]').first();
  await select.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1000);

  const before = await select.evaluate(el => {
    const inner = el.shadowRoot?.querySelector('select#select, select');
    return inner?.value || el.value || el.getAttribute('value') || '';
  });
  log(`   当前模板: ${before || '(空)'}`);

  const setResult = await select.evaluate((el, template) => {
    const inner = el.shadowRoot?.querySelector('select#select, select');
    const shown = el.shadowRoot?.querySelector('.value');
    if (!inner) {
      return { ok: false, reason: 'inner select missing' };
    }

    const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
    const beforeValue = inner.value || el.value || el.getAttribute('value') || '';
    const option = Array.from(inner.options).find(opt => opt.value === template || normalize(opt.textContent) === template);
    if (!option) {
      return {
        ok: false,
        reason: 'option missing',
        options: Array.from(inner.options).map(opt => opt.value || normalize(opt.textContent)),
      };
    }

    Array.from(inner.options).forEach(opt => {
      opt.selected = false;
      opt.removeAttribute('selected');
    });
    option.selected = true;
    option.setAttribute('selected', '');
    inner.selectedIndex = Array.from(inner.options).indexOf(option);
    inner.value = option.value;
    if (typeof el.value !== 'undefined') el.value = option.value;
    el.setAttribute('value', option.value);
    if (shown) shown.textContent = normalize(option.textContent);

    inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return {
      ok: true,
      before: beforeValue,
      after: inner.value || el.value || el.getAttribute('value') || '',
      shown: shown?.textContent?.trim() || '',
      selectedIndex: inner.selectedIndex,
    };
  }, templateName);

  if (!setResult.ok || setResult.after !== templateName) {
    await page.evaluate(() => {
      document.querySelectorAll('s-internal-select[data-openclaw-theme-template-target="1"]').forEach(el => el.removeAttribute('data-openclaw-theme-template-target'));
    }).catch(() => {});
    throw new Error(`Theme template 切换失败: ${JSON.stringify(setResult)}`);
  }

  log(`   已切到模板: ${setResult.after}`);
  const saveBtn = page.locator('button:has-text("Save")').first();
  await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
  await saveBtn.click({ force: true });
  await page.waitForTimeout(5000);

  const finalState = await select.evaluate(el => {
    const inner = el.shadowRoot?.querySelector('select#select, select');
    const shown = el.shadowRoot?.querySelector('.value');
    return {
      value: inner?.value || el.value || el.getAttribute('value') || '',
      shown: shown?.textContent?.trim() || '',
    };
  });

  await page.evaluate(() => {
    document.querySelectorAll('s-internal-select[data-openclaw-theme-template-target="1"]').forEach(el => el.removeAttribute('data-openclaw-theme-template-target'));
  }).catch(() => {});

  if (finalState.value !== templateName) {
    throw new Error(`保存后模板值异常，期望=${templateName}，实际=${finalState.value}`);
  }

  log(`✅ 商品模板已绑定并保存: ${finalState.value}`);
}

async function closeCurrentTab(page) {
  if (!page || page.isClosed()) return;
  try {
    const currentUrl = page.url();
    await page.close({ runBeforeUnload: true }).catch(async () => {
      await page.close().catch(() => {});
    });
    log(`🔚 已关闭当前商品Tab: ${currentUrl}`);
  } catch (e) {
    log(`⚠️ 关闭当前商品Tab失败: ${e.message}`);
  }
}

async function main() {
  const argv = parseArgs(process.argv);
  if (argv.help) {
    printHelp();
    return;
  }

  const store = findStore(argv.storeQuery);
  const profileNo = String(store.profileNo);
  const slug = String(store.shopifySlug || store.storeId || store.name || '').trim();
  if (!slug) throw new Error('店铺缺少 shopifySlug/storeId/name，无法定位 Shopify 后台');

  const reviewAssets = loadReviewAssets(argv.productDir);
  if (!argv.templateName) {
    argv.templateName = formatTimestampTemplateName();
  }

  log(`🏪 店铺: ${store.name} (${slug})`);
  log(`👤 Profile: ${profileNo}`);
  log(`🏷️ 模板名: ${argv.templateName}`);

  if (reviewAssets.reviews.length) {
    log(`📝 已加载评论素材: ${reviewAssets.productDir}`);
    reviewAssets.reviews.forEach((item, idx) => {
      log(`   [${idx + 1}] ${item.name} | ${item.content.slice(0, 60)}`);
    });
  }

  let browser = null;
  let cdpResult = null;
  let openedByUs = false;

  try {
    cdpResult = await openBrowser(profileNo);
    openedByUs = Boolean(cdpResult && cdpResult.isNew);
    browser = await chromium.connectOverCDP(cdpResult.cdpUrl);

    const context = browser.contexts()[0];
    if (!context) throw new Error('未获取到浏览器 context');

    const page = await findCurrentAdminPage(context, slug);
    if (!page) {
      throw new Error(`当前浏览器中未找到店铺 ${slug} 的 Shopify 后台页。请先完成 CSV 导入并停留在该店铺后台页面。`);
    }

    const pageCount = context.pages().length;
    const reusedContext = pageCount > 1 || isEditorUrl(page.url()) || /admin\.shopify\.com\/store\//.test(page.url());
    log(`🧭 连接后检测到 ${pageCount} 个页面，目标页: ${page.url()}`);
    if (reusedContext && openedByUs) {
      log('♻️ 本次虽然新开了 AdsPower 浏览器，但已命中现有 Shopify 页面上下文；仅复用页面，不改变最终退出责任');
    }

    await page.bringToFront().catch(() => {});
    log(`✅ 命中当前后台页: ${page.url()}`);

    let editorFrame;
    if (isEditorUrl(page.url())) {
      log('♻️ 当前页已经在 Theme Editor，直接复用当前上下文');
      const currentEditorUrl = normalizeEditorUrl(page.url(), slug);
      editorFrame = await openEditorAndGetFrame(page, currentEditorUrl);
    } else {
      const editorUrl = await gotoThemesAndGetEditorUrl(page, slug);
      const normalizedEditorUrl = normalizeEditorUrl(editorUrl, slug);
      editorFrame = await openEditorAndGetFrame(page, normalizedEditorUrl);
    }
    await switchToProductAndCreateTemplate(editorFrame, page, argv.templateName);
    await openMulticolumn(editorFrame, page);
    if (reviewAssets.reviews.length >= 3) {
      await fillReviewColumns(editorFrame, page, reviewAssets.reviews);
      await saveTemplate(editorFrame, page);
    }

    await exitEditor(editorFrame, page);
    const productAdminUrl = getProductAdminUrl(store, reviewAssets, argv);
    log(`📦 进入商品编辑页: ${productAdminUrl}`);
    await page.goto(productAdminUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const ready = await waitForProductEditorReady(page, 60000);
    if (!ready) {
      throw new Error('商品编辑页未就绪，无法继续绑定 Theme template');
    }
    await bindThemeTemplateAndSave(page, argv.templateName);
    await closeCurrentTab(page);

    log('🎉 模板闭环完成：已创建模板、填写 3 个 Column、保存模板，并绑定到商品；已关闭当前商品Tab，准备退出AdsPower');
  } finally {
    if (browser) {
      if (openedByUs) {
        log('🧹 本次 AdsPower 由脚本打开，准备彻底关闭浏览器与 profile');
        try { await browser.close(); } catch (e) {}
        const closed = await ensureProfileClosed(profileNo);
        if (closed) {
          log('✅ AdsPower profile 已确认关闭');
        } else {
          log('⚠️ AdsPower profile 关闭后状态仍不稳定，请稍后人工复核');
        }
      } else {
        log('🔗 本次仅复用已有浏览器，断开 CDP 连接，不主动关闭 AdsPower');
        try { await browser.disconnect(); } catch (e) {}
      }
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
