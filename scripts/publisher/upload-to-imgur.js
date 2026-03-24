#!/usr/bin/env node
/**
 * upload-to-imgur.js - 上传本地图片到 Imgur，生成公开 URL
 * 
 * Imgur 匿名上传，无需 API key（使用 Imgur 的 demo Client ID）
 * 每个 IP 每小时 50 张图限制
 * 
 * 用法: node upload-to-imgur.js <商品目录> [--store <店铺名>]
 * 
 * 输出:
 *   image_urls.json - 图片 URL 映射
 *   product.csv - 已更新图片 URL 的 CSV
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown';
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const STORES_FILE = path.join(CONFIG_DIR, 'stores.json');

// Imgur Demo Client ID（公开的匿名上传用）
// 生产环境应该用自己的 Client ID
const IMGUR_CLIENT_ID = '546c25a59c58ad7';

// ============================================================
// 日志
// ============================================================
function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ============================================================
// HTTP 请求
// ============================================================
function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const reqOptions = {
      hostname: url.startsWith('https') ? 'api.imgur.com' : 'api.imgur.com',
      path: url.startsWith('https') ? url.replace('https://api.imgur.com', '') : '/3/image',
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    
    const req = lib.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============================================================
// 上传单张图片到 Imgur
// ============================================================
async function uploadToImgur(imagePath) {
  try {
    // 读取文件并转为 base64
    const fileData = fs.readFileSync(imagePath);
    const base64 = fileData.toString('base64');
    
    // 判断图片类型
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';
    
    // 构建 multipart form data（简化为 URL encode 方式）
    const postData = new URLSearchParams({
      image: base64,
      type: 'base64',
      name: path.basename(imagePath),
    }).toString();
    
    const response = await httpRequest('/3/image', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, postData);
    
    if (response.success && response.data && response.data.link) {
      // 转换 https://i.imgur.com/xxx.jpg 为 https://i.imgur.com/xxx.jpg（直接可用）
      return {
        success: true,
        url: response.data.link,
        deletehash: response.data.deletehash,
      };
    } else {
      return {
        success: false,
        error: response.data?.error || 'Unknown error',
      };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============================================================
// 上传所有图片
// ============================================================
async function uploadImages(imagesDir) {
  const files = fs.readdirSync(imagesDir)
    .filter(f => /\.(webp|png|jpg|jpeg|gif)$/i.test(f))
    .sort();
  
  log(`📁 找到 ${files.length} 张图片`);
  
  const results = [];
  
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const filePath = path.join(imagesDir, filename);
    
    log(`  [${i+1}/${files.length}] 上传: ${filename}`);
    
    // 如果是 webp，Imgur 可能不支持，需要转换
    if (filename.toLowerCase().endsWith('.webp')) {
      log(`    ⚠️ 跳过 .webp 文件（Imgur 不支持）`);
      results.push({ filename, url: null, error: 'Imgur 不支持 webp 格式' });
      continue;
    }
    
    const result = await uploadToImgur(filePath);
    
    if (result.success) {
      log(`    ✅ ${result.url}`);
      results.push({ filename, url: result.url, deletehash: result.deletehash });
    } else {
      log(`    ❌ ${result.error}`);
      results.push({ filename, url: null, error: result.error });
    }
    
    // 间隔 1 秒，避免超限
    if (i < files.length - 1) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  
  return results;
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  let folder = '', storeQuery = '';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store' && args[i+1]) storeQuery = args[++i];
    else if (args[i].includes('/')) folder = args[i];
  }
  
  if (!folder) {
    console.error('❌ 请指定商品目录');
    console.log('用法: node upload-to-imgur.js <目录> [--store <店铺名>]');
    console.log('示例: node upload-to-imgur.js 2026-03-23/023 --store default');
    process.exit(1);
  }
  
  log(`📦 商品目录: ${folder}`);
  
  // 加载店铺配置
  let stores = [];
  try { stores = JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')).stores || []; }
  catch (e) {}
  
  const store = stores.find(s =>
    storeQuery && (String(s.profileNo) === storeQuery || (s.name||'').toLowerCase().includes(storeQuery.toLowerCase()))
  ) || stores[0];
  
  log(`🏪 店铺: ${store?.name || store?.storeId || '默认'}`);
  
  // 检查图片目录
  const imagesDir = path.join(TK_OUTPUT_DIR, folder, 'images');
  if (!fs.existsSync(imagesDir)) {
    console.error(`❌ 图片目录不存在: ${imagesDir}`);
    process.exit(1);
  }
  
  // 上传图片
  log('🚀 开始上传到 Imgur...');
  const results = await uploadImages(imagesDir);
  
  // 统计
  const success = results.filter(r => r.success).length;
  log(`\n📊 成功: ${success}/${results.length}`);
  
  // 保存 URL 映射
  const urlPath = path.join(TK_OUTPUT_DIR, folder, 'image_urls.json');
  fs.writeFileSync(urlPath, JSON.stringify(results, null, 2));
  log(`💾 URL 映射已保存: ${urlPath}`);
  
  // 返回结果供后续使用
  return results;
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
