#!/usr/bin/env node
/**
 * 采集运行器：自动打开浏览器 → 导航到商品页 → 获取CDP URL → 执行采集
 * 用法: node run-extract.js <profileNo> [tiktokProductUrl]
 * 
 * 示例:
 *   node run-extract.js 1895750 https://shop.tiktok.com/us/pdp/...
 */

const { execSync, spawn } = require('child_process');
const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const profileNo = process.argv[2] || '1895750';
  const productUrl = process.argv[3] || 'https://shop.tiktok.com/us/pdp/skyfire-1376-led-flashlight-rechargeable-5-modes-waterproof/1731296369348809623';
  
  console.log('🔌 打开 AdsPower 浏览器...');
  
  // 打开浏览器并获取CDP URL
  const output = execSync(
    `npx --yes adspower-browser open-browser '{"profileNo":"${profileNo}"}'`,
    { encoding: 'utf8', timeout: 30000 }
  );
  
  // 从输出中提取 ws.puppeteer 地址
  const wsMatch = output.match(/ws\.puppeteer:\s*(ws:\/\/[^\s]+)/);
  if (!wsMatch) {
    console.error('❌ 无法从输出中提取 CDP URL:');
    console.error(output);
    process.exit(1);
  }
  
  const cdpUrl = wsMatch[1];
  console.log('✅ 浏览器已打开');
  console.log('🔗 CDP: ' + cdpUrl);
  
  // 用Playwright导航到商品页
  console.log('🌐 导航到商品页...');
  try {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const ctx = browser.contexts()[0];
    
    // 关闭AdsPower初始页面（只留TikTok Shop）
    const pages = ctx.pages();
    if (pages.length > 1) {
      await pages[0].close();  // 关闭AdsPower start页
    }
    
    // 在剩余的页面上导航到商品页
    const activePage = ctx.pages()[0];
    await activePage.goto(productUrl, { waitUntil: 'domcontentloaded' });
    // 等待商品数据渲染（滚动触发）
    await activePage.evaluate(() => { window.scrollTo(0, 500); });
    await activePage.waitForTimeout(3000);
    await activePage.evaluate(() => { window.scrollTo(0, 1000); });
    await activePage.waitForTimeout(2000);
    await activePage.evaluate(() => { window.scrollTo(0, 0); });
    await activePage.waitForTimeout(1000);
    console.log('✅ 页面已加载: ' + activePage.url());
    
    // 保持浏览器连接不断开（提取脚本会复用这个连接）
    // 注意：这里不能await browser.close()，否则提取脚本会断连
  } catch (e) {
    console.log('⚠️ 导航失败:', e.message);
  }
  
  // 等待页面完全加载
  await new Promise(r => setTimeout(r, 2000));
  
  // 设置环境变量并运行采集脚本
  const extractPath = path.join(__dirname, 'extract-detail.js');
  
  console.log('\n📦 开始采集...\n');
  
  const child = spawn('node', [extractPath], {
    env: { 
      ...process.env,
      TK_CDP_URL: cdpUrl
    },
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main().catch(e => { 
  console.error('❌', e.message); 
  process.exit(1); 
});
