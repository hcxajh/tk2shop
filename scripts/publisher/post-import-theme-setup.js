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
    templateName: `demo-${Date.now().toString().slice(-6)}`,
  };

  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === '--store' && args[i + 1]) out.storeQuery = args[++i];
    else if (cur === '--template-name' && args[i + 1]) out.templateName = args[++i];
    else if (cur === '--help' || cur === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`用法:\n  node post-import-theme-setup.js --store <店铺ID> [--template-name <模板名>]`);
}

function loadStores() {
  try {
    const data = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
    return data.stores || [];
  } catch (e) {
    throw new Error(`读取 stores.json 失败: ${e.message}`);
  }
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

function openBrowser(profileNo) {
  return new Promise((resolve, reject) => {
    const activeBrowser = getActiveBrowser(profileNo);
    if (activeBrowser) {
      log(`🔁 检测到 profile ${profileNo} 已有活跃浏览器，优先复用当前实例...`);
      if (activeBrowser.cdpUrl && activeBrowser.cdpUrl.startsWith('ws')) {
        log(`🔌 复用已有 CDP: ${activeBrowser.cdpUrl}`);
        return resolve({ cdpUrl: activeBrowser.cdpUrl, isNew: false });
      }
      log(`⚠️ 已检测到活跃浏览器，但未拿到可用 ws 地址；debug_port=${activeBrowser.debugPort || '无'}，改为新开浏览器`);
    } else {
      log(`ℹ️ 未检测到 profile ${profileNo} 的活跃浏览器，准备新开实例`);
    }

    log(`🔓 打开 AdsPower 浏览器 (profileNo: ${profileNo})...`);
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
      log(`🔌 CDP: ${match[1]}`);
      resolve({ cdpUrl: match[1], isNew: true });
    });
    p.on('error', reject);
  });
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

  let frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes/.test(url));
  if (!frame) {
    await logThemesDebug(page);
    frame = await getVisibleFrameByUrl(page, url => /shopifyapps\.com/.test(url));
  }
  if (!frame) {
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
  await waitForEditorReady(page, 60000);
  await page.waitForTimeout(8000);

  let frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes\/.+\/editor/.test(url));
  if (!frame) {
    await logEditorDebug(page);
    frame = await getVisibleFrameByUrl(page, url => /online-store-web\.shopifyapps\.com\/themes\/.*/.test(url));
  }
  if (!frame) {
    await logEditorDebug(page);
    frame = await getVisibleFrameByUrl(page, url => /shopifyapps\.com/.test(url));
  }
  if (!frame) {
    throw new Error('未找到 Theme Editor 主体 iframe');
  }

  log('✅ 已进入 Theme Editor 主体 iframe');
  return frame;
}

async function switchToProductAndCreateTemplate(frame, templateName) {
  log('🔄 打开顶部模板切换...');
  const pickerBtn = frame.locator('[aria-controls="topbar-picker-templates"]').first();
  await pickerBtn.waitFor({ state: 'visible', timeout: 20000 });
  await pickerBtn.click();
  await frame.page().waitForTimeout(2500);

  log('📦 切到 Product 模板...');
  const productBtn = frame.locator('li#PRODUCT button').first();
  await productBtn.waitFor({ state: 'visible', timeout: 15000 });
  await productBtn.click();
  await frame.page().waitForTimeout(2500);

  log('🆕 点击 Create template...');
  const createBtn = frame.locator('li#__create__ button').first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });
  await createBtn.click();
  await frame.page().waitForTimeout(2500);

  const modal = frame.locator('.Polaris-Modal-Dialog__Container, .Polaris-Modal-Dialog--alignSelfCenter').first();
  await modal.waitFor({ state: 'visible', timeout: 15000 });

  log(`⌨️ 输入模板名: ${templateName}`);
  const input = modal.locator('input').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
  await input.fill('');
  await input.type(templateName, { delay: 80 });
  await frame.page().waitForTimeout(500);

  const finalValue = await input.inputValue().catch(() => '');
  if (!finalValue || finalValue.replace(/\s+/g, '') !== templateName.replace(/\s+/g, '')) {
    throw new Error(`模板名输入失败，期望=${templateName}，实际=${finalValue}`);
  }

  const confirmBtn = modal.locator('button:has-text("Create template"), button:has-text("创建模板")').last();
  await confirmBtn.waitFor({ state: 'visible', timeout: 10000 });
  await confirmBtn.click();
  await frame.page().waitForTimeout(6000);

  log('✅ 已创建并进入新 Product 模板');
}

async function openMulticolumn(frame) {
  log('🎯 进入 Multicolumn...');
  const row = frame.locator('li[data-component-extra-section_type="multicolumn"]').first();
  await row.waitFor({ state: 'visible', timeout: 20000 });

  const primary = row.locator('button.Online-Store-UI-NavItem__PrimaryAction_1232d').first();
  await primary.waitFor({ state: 'visible', timeout: 10000 });
  await primary.click();
  await frame.page().waitForTimeout(4000);

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

  log(`🏪 店铺: ${store.name} (${slug})`);
  log(`👤 Profile: ${profileNo}`);
  log(`🏷️ 模板名: ${argv.templateName}`);

  let browser = null;
  let cdpResult = null;

  try {
    cdpResult = await openBrowser(profileNo);
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
    if (reusedContext && cdpResult && cdpResult.isNew) {
      log('♻️ 虽然本次通过 open-browser 建立连接，但已命中现有 Shopify 页面上下文，后续按复用已有浏览器处理');
      cdpResult.isNew = false;
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
    await switchToProductAndCreateTemplate(editorFrame, argv.templateName);
    await openMulticolumn(editorFrame);

    log('🎉 最小闭环完成：已从当前后台页进入 Theme Editor，并到达 Multicolumn');
  } finally {
    if (browser) {
      if (cdpResult && cdpResult.isNew) {
        try { await browser.close(); } catch (e) {}
        await closeBrowser(profileNo);
      } else {
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
