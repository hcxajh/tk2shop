import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84');
const ctx = (await browser.contexts())[0];
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574', {waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(3000);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// 找所有图片（包括描述区的）
const allImgs = await page.evaluate(() => {
  const imgs = document.querySelectorAll('img');
  return [...imgs].map(img => ({
    src: img.src.slice(0, 100),
    width: img.naturalWidth,
    height: img.naturalHeight,
    parent: img.parentElement?.className?.slice(0, 80),
    inViewport: img.getBoundingClientRect().top < window.innerHeight
  }));
});
console.log('页面总图片数:', allImgs.length);
console.log('在视口内的图片:', allImgs.filter(i=>i.inViewport).length);

// 找Description区域的图片
const descImgs = await page.evaluate(() => {
  // 找所有包含Description/Details的span并点击
  const btns = document.querySelectorAll('span');
  for (const btn of btns) {
    if (btn.innerText.includes('Description') || btn.innerText.includes('Details')) {
      console.log('找到按钮:', btn.innerText, btn.getBoundingClientRect());
      btn.click();
      return 'clicked';
    }
  }
  return 'not found';
});
console.log('点击结果:', descImgs);
await page.waitForTimeout(2000);

// 再次检查图片
const afterClick = await page.evaluate(() => {
  const imgs = document.querySelectorAll('img');
  const descArea = document.querySelector('[class*="overflow-hidden"][class*="transition-all"]');
  let descImgs = [];
  if (descArea) {
    descImgs = [...descArea.querySelectorAll('img')].map(img => ({
      src: img.src.slice(0, 100),
      width: img.naturalWidth,
      height: img.naturalHeight
    }));
  }
  return {
    totalImgs: imgs.length,
    descImgs,
    descAreaHTML: descArea ? descArea.innerHTML.slice(0, 500) : 'not found'
  };
});
console.log('点击后:', JSON.stringify(afterClick, null, 2));

await page.screenshot({path: '/tmp/desc_area.png', fullPage: false});
console.log('截图已保存');
await browser.close();
