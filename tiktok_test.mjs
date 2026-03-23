import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('ws://127.0.0.1:42487/devtools/browser/6558bff9-9f65-43f7-a4c1-acfe6719fa84');
const context = await browser.newContext();
const page = await context.newPage();

const url = 'https://shop.tiktok.com/us/pdp/wireless-lavalier-microphones-by-pqrqp-for-iphone-android-devices/1729413476776186574';

console.log('正在打开:', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);

const title = await page.title();
console.log('页面标题:', title);

const ogTitle = await page.$eval('meta[property="og:title"]', el => el.content).catch(() => 'N/A');
console.log('OG Title:', ogTitle);

await page.screenshot({ path: '/tmp/tiktok_test.png', fullPage: false });
console.log('截图已保存到 /tmp/tiktok_test.png');

await browser.close();
console.log('完成');
