#!/usr/bin/env node
/**
 * 根据已有 product.json 重新生成 shopifyTitle / descriptionHtml / descriptionAi
 * 不需要浏览器，直接读取 product.json 并调用生成函数
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const INPUT = process.argv[2] || '/root/.openclaw/TKdown/2026-03-20/010/product.json';
const MINIMAX_API_KEY = 'sk-cp-Dst9QMV4HgpBuFOpwDxiJAr7CW5dwJZv0kXGGyfpKfNzDRIBJhjgGl2QcsxPtd37gQii7WS2roJZqOuVjNLCiJXCevsxSuO4dnDeHZIh-O8NYZ5FkEz02uY';

async function main() {

/**
 * 从原始标题和描述生成 Shopify SEO 友好标题
 */
function generateShopifyTitle(originalTitle, description) {
  if (!originalTitle) return '';
  const firstWord = originalTitle.trim().split(/\s+/)[0];
  const isBrand = firstWord.length > 1 && /^[A-Z][a-zA-Z0-9]*$/.test(firstWord);
  const brand = isBrand ? firstWord : '';
  const lowerDesc = (description || '').toLowerCase();
  const featurePatterns = [
    { key: '1000m', label: '1000m Beam', pattern: /1000\s*m(eters?)?\s*(beam|range|throw)/i },
    { key: 'rechargeable', label: 'Rechargeable', pattern: /rechargeable/i },
    { key: 'tactical', label: 'Tactical', pattern: /\btactical\b/i },
    { key: 'zoomable', label: 'Zoomable', pattern: /\bzoom(able)?\b/i },
    { key: 'waterproof', label: 'Waterproof', pattern: /\bwater\ ?proof\b/i },
    { key: '6 modes', label: '6 Modes', pattern: /\b6\s*mode/i },
    { key: '5 modes', label: '5 Modes', pattern: /\b5\s*mode/i },
    { key: '5000mah', label: '5000mAh Battery', pattern: /5000\s*mah/i },
    { key: 'battery', label: 'Battery', pattern: /\bmah\b/i },
    { key: 'camping', label: 'Camping', pattern: /\bcamping\b/i },
    { key: 'outdoor', label: 'Outdoor', pattern: /\boutdoor\b/i },
    { key: 'emergency', label: 'Emergency', pattern: /\bemergency\b/i },
    { key: 'led', label: 'LED', pattern: /\bled\b/i },
    { key: 'ultrabright', label: 'Ultra-Bright', pattern: /\bultra[\s-]?bright\b/i },
    { key: 'high lumen', label: 'High Lumen', pattern: /\bhigh\s*lumen\b/i },
  ];
  let beamDistance = '';
  const beamMatch = lowerDesc.match(/(\d+)\s*m(eters?)?\s*(beam|range|throw|distance)/i);
  if (beamMatch) beamDistance = beamMatch[1] + 'm Beam';
  const features = new Set();
  for (const feat of featurePatterns) {
    if (feat.key === '1000m') { if (beamDistance) features.add(beamDistance); }
    else { if (feat.pattern.test(lowerDesc)) features.add(feat.label); }
  }
  if (features.has('5000mAh Battery') && features.has('Battery')) features.delete('Battery');
  const productCore = 'LED Flashlight';
  const topFeatures = [];
  const priorityOrder = ['1000m Beam', 'Rechargeable', 'Tactical', '6 Modes', '5 Modes',
    'Zoomable', 'Waterproof', '5000mAh Battery', 'LED', 'Ultra-Bright', 'High Lumen',
    'Camping', 'Outdoor', 'Emergency', 'Battery'];
  for (const feat of priorityOrder) {
    if (features.has(feat) && topFeatures.length < 5) topFeatures.push(feat);
  }
  const usageTags = [];
  for (const feat of ['Camping', 'Outdoor', 'Emergency', 'Tactical']) {
    if (features.has(feat) && usageTags.length < 2) usageTags.push(feat);
  }
  let seoTitle = brand ? brand + ' ' + productCore : productCore;
  if (topFeatures.length > 0) seoTitle += ' - ' + topFeatures.join(', ');
  if (usageTags.length > 0 && !seoTitle.includes(usageTags[0])) seoTitle += ' for ' + usageTags.join(', ');
  seoTitle = seoTitle.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
  return seoTitle;
}

/**
 * 将原始描述文字优化为 Shopify 风格 HTML
 */
function optimizeForShopify(text, images) {
  if (!text && (!images || images.length === 0)) return '';
  const lines = (text || '').split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  const imgList = images || [];
  let imgIdx = 0;
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isHeading = (
      /^[A-Z][A-Z\s\d]+$/.test(line) ||
      /^\d+[\.\)]\s/.test(line) ||
      (line.length < 40 && /[!:\-–—]$/.test(line)) ||
      /^(Features|Specifications|Price|Note|Warning|Benefit)/i.test(line)
    );
    const isListItem = (
      /^[•\-\*\+\√✓✔▶]\s/.test(line) ||
      /^[\-\*\+\–]\s/.test(line) ||
      /^\d+[\.\)]\s/.test(line)
    );
    if (isHeading) {
      const headingText = line.replace(/[:\!\.\-\–—]+$/, '').trim();
      if (headingText) html += `<h2>${headingText}</h2>\n`;
      i++;
    } else if (isListItem) {
      const items = [];
      while (i < lines.length) {
        const item = lines[i];
        if (/^[•\-\*\+\√✓✔▶]\s/.test(item) || /^[\-\*\+\–]\s/.test(item) || /^\d+[\.\)]\s/.test(item)) {
          const cleanItem = item.replace(/^[•\-\*\+\√✓✔▶▶]\s*/, '').replace(/^\d+[\.\)]\s*/, '').trim();
          if (cleanItem) items.push(cleanItem);
          i++;
        } else break;
      }
      if (items.length > 0) {
        html += `<ul>\n`;
        for (const item of items) html += `  <li>${item}</li>\n`;
        html += `</ul>\n`;
      }
    } else {
      const paraCount = (html.match(/<p>/g) || []).length;
      const shouldInsertImg = imgIdx < imgList.length && paraCount > 0 && paraCount % 3 === 0;
      if (shouldInsertImg) {
        html += `<p>${line}</p>\n`;
        html += `<img src="${imgList[imgIdx]}" alt="product detail" style="max-width:100%;margin:16px 0;" />\n`;
        imgIdx++;
      } else {
        html += `<p>${line}</p>\n`;
      }
      i++;
    }
  }
  while (imgIdx < imgList.length) {
    html += `<img src="${imgList[imgIdx]}" alt="product detail" style="max-width:100%;margin:16px 0;" />\n`;
    imgIdx++;
  }
  return html.trim();
}

/**
 * 调用 MiniMax AI 生成 Shopify 风格营销型产品介绍
 */
async function generateShopifyDescriptionAI(originalTitle, shopifyTitle, originalDesc, images) {
  if (!originalDesc || originalDesc.length < 20) {
    console.log('⚠️ 原始描述太短，跳过AI生成');
    return '';
  }
  const prompt = `你是一位专业的跨境电商 Shopify 产品文案专家。请根据以下 TikTok Shop 原始产品描述，写一套适合 Shopify 的营销型产品介绍。

## 原始标题
${originalTitle}

## SEO优化标题
${shopifyTitle}

## 原始产品描述
${originalDesc}

## 要求
1. 风格：营销型，要有感染力，突出产品卖点和使用场景
2. 结构：要有小标题（<h2>）、段落（<p>）、要点列表（<ul><li>）
3. 语言：英文，面向欧美市场消费者
4. 不要臆造产品规格，只基于原始描述里有的信息来写
5. 禁止使用 Emoji
6. HTML 要干净，不要有多余的 class 或 style
7. 总长度适中，一般 300~600 词
8. 在需要插入图片的位置，用 [IMAGE_PLACEHOLDER_1]、[IMAGE_PLACEHOLDER_2] 这样的占位符表示
9. 占位符数量不要超过 ${(images || []).length} 个

请直接输出 HTML 内容，不要加markdown代码块标记。`;
  try {
    console.log('🤖 调用 AI 生成 Shopify 风格产品介绍...');
    const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.log('⚠️ AI 生成失败:', response.status, errText);
      return '';
    }
    const data = await response.json();
    const generatedText = data.choices?.[0]?.message?.content || '';
    if (!generatedText) { console.log('⚠️ AI 返回内容为空'); return ''; }
    let cleanHtml = generatedText
      .replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if ((images || []).length > 0) {
      let imgIdx = 0;
      cleanHtml = cleanHtml.replace(/\[IMAGE_PLACEHOLDER_(\d+)\]/g, (match, num) => {
        if (imgIdx < images.length) {
          const imgTag = `<img src="${images[imgIdx]}" alt="product detail ${imgIdx + 1}" style="max-width:100%;margin:16px 0;" />`;
          imgIdx++;
          return imgTag;
        }
        return '';
      });
    }
    console.log('✅ AI 生成完成 (' + cleanHtml.length + ' 字符)');
    return cleanHtml;
  } catch (e) {
    console.log('⚠️ AI 调用异常:', e.message);
    return '';
  }
}

// 读取 product.json
const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const title = raw.title || '';
const originalDesc = raw.description || '';
const descImages = raw.descriptionImages || [];

console.log('📦 商品:', title.substring(0, 60));
console.log('📝 描述图片:', descImages.length, '张');

// 1. 生成 shopifyTitle
const shopifyTitle = generateShopifyTitle(title, originalDesc);
console.log('🏷️ Shopify标题:', shopifyTitle.substring(0, 70));

// 2. 生成 descriptionHtml
const descriptionHtml = optimizeForShopify(originalDesc, descImages);
console.log('📄 descriptionHtml:', descriptionHtml.length, '字符');

// 3. 生成 descriptionAi（AI营销版）
const descriptionAi = await generateShopifyDescriptionAI(title, shopifyTitle, originalDesc, descImages);

// 更新 product.json，字段顺序固定
const updated = {
  title,
  shopifyTitle,
  descriptionHtml,
  descriptionAi: descriptionAi || undefined,
  price: raw.price,
  compareAtPrice: raw.compareAtPrice,
  sku: raw.sku,
  status: raw.status,
  images: raw.images,
  descriptionImages: raw.descriptionImages,
  _meta: raw._meta,
};

const outPath = INPUT;
fs.writeFileSync(outPath, JSON.stringify(updated, null, 2));
console.log('\n✅ 已更新:', outPath);
console.log('   shopifyTitle:', shopifyTitle.substring(0, 60));
console.log('   descriptionHtml:', descriptionHtml.length, '字符');
console.log('   descriptionAi:', descriptionAi ? descriptionAi.length + ' 字符' : '(空)');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
