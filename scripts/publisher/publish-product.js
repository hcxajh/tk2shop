#!/usr/bin/env node
/**
 * Shopify 发布总入口
 *
 * 目标：
 * 1. 支持两种入口：商品目录 / 商品 URL
 * 2. URL 模式下先采集，再统一执行内容增强
 * 3. 生成/校验 product.csv
 * 4. 调用 import-csv-onestop.js 完成 Shopify 导入
 * 5. 由导入脚本自动完成模板收尾（评论模板填写 + Theme template 绑定）
 *
 * 用法：
 *   node publish-product.js <商品目录> --store <店铺ID>
 *   node publish-product.js --url "https://shop.tiktok.com/..." --store <店铺ID>
 *
 * 可选：
 *   --skip-enrich  跳过内容增强
 *   --skip-csv     若 product.csv 已存在，则跳过重新生成
 *   --csv-only     只执行到 CSV 阶段，不执行导入
 *   --collect-only URL 模式下只执行采集，不继续增强/发布
 *   --help, -h     查看帮助
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown';
const COLLECTOR_SCRIPT = path.join(__dirname, '..', 'collector', 'runner.js');
const ENRICH_SCRIPT = path.join(__dirname, 'enrich-product.js');
const TO_CSV_SCRIPT = path.join(__dirname, 'to-csv.js');
const IMPORT_SCRIPT = path.join(__dirname, 'import-csv-onestop.js');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    productDir: '',
    productUrl: '',
    storeQuery: '',
    skipEnrich: false,
    skipCsv: false,
    csvOnly: false,
    collectOnly: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === '--help' || cur === '-h') out.help = true;
    else if (cur === '--store' && args[i + 1]) out.storeQuery = args[++i];
    else if (cur === '--url' && args[i + 1]) out.productUrl = args[++i];
    else if (cur === '--skip-enrich') out.skipEnrich = true;
    else if (cur === '--skip-csv') out.skipCsv = true;
    else if (cur === '--csv-only') out.csvOnly = true;
    else if (cur === '--collect-only') out.collectOnly = true;
    else if (!cur.startsWith('--') && cur.includes('/')) out.productDir = cur;
  }

  return out;
}

function printHelp() {
  console.log('用法:');
  console.log('  node publish-product.js <商品目录> --store <店铺ID>');
  console.log('  node publish-product.js --url "https://shop.tiktok.com/..." --store <店铺ID>');
  console.log('');
  console.log('示例:');
  console.log('  node publish-product.js 2026-03-26/010 --store vellin1122');
  console.log('  node publish-product.js --url "https://shop.tiktok.com/view/product/1729532359962515764?region=US&locale=en" --store vellin1122');
  console.log('');
  console.log('可选参数:');
  console.log('  --skip-enrich  跳过内容增强');
  console.log('  --skip-csv     若已存在 product.csv，则跳过重新生成');
  console.log('  --csv-only     只执行到 CSV 阶段，不执行导入');
  console.log('  --collect-only URL 模式下只执行采集，不继续增强/发布');
  console.log('  --help, -h     查看帮助');
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} 不存在: ${filePath}`);
  }
}

function runNodeScript(scriptPath, scriptArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...scriptArgs], {
      cwd: path.dirname(scriptPath),
      stdio: 'inherit',
    });

    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`${label} 失败，退出码=${code}`));
    });
    child.on('error', err => reject(new Error(`${label} 启动失败: ${err.message}`)));
  });
}

function collectProduct(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [COLLECTOR_SCRIPT, JSON.stringify({ tiktokUrl: url })], {
      cwd: path.dirname(COLLECTOR_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      process.stdout.write(data);
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      process.stderr.write(data);
      stderr += data.toString();
    });

    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`采集失败，退出码=${code}`));
      }

      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
        if (!jsonMatch) {
          return reject(new Error('采集完成，但未解析到结果 JSON'));
        }

        const result = JSON.parse(jsonMatch[0]);
        if (!result.success || !result.outputDir) {
          return reject(new Error('采集结果缺少 outputDir'));
        }

        const productDir = path.relative(TK_OUTPUT_DIR, result.outputDir);
        if (!productDir || productDir.startsWith('..')) {
          return reject(new Error(`采集输出目录异常: ${result.outputDir}`));
        }

        resolve({
          ...result,
          productDir,
        });
      } catch (err) {
        reject(new Error(`解析采集结果失败: ${err.message}`));
      }
    });

    child.on('error', err => reject(new Error(`采集启动失败: ${err.message}`)));
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.storeQuery) {
    printHelp();
    throw new Error('请指定 --store <店铺ID>');
  }

  if (!opts.productDir && !opts.productUrl) {
    printHelp();
    throw new Error('请指定商品目录，或使用 --url <商品链接>');
  }

  if (opts.productDir && opts.productUrl) {
    throw new Error('商品目录和 --url 只能二选一');
  }

  let productDir = opts.productDir;

  if (opts.productUrl) {
    log(`🌐 Step 1/4: 采集商品`);
    const collectResult = await collectProduct(opts.productUrl);
    productDir = collectResult.productDir;
    log(`✅ 采集完成: ${productDir}`);

    if (opts.collectOnly) {
      log('🛑 已指定 --collect-only，本次到采集阶段结束');
      return;
    }
  }

  const productDirAbs = path.join(TK_OUTPUT_DIR, productDir);
  const productJsonPath = path.join(productDirAbs, 'product.json');
  const productCsvPath = path.join(productDirAbs, 'product.csv');

  log(`📦 发布商品: ${productDir}`);
  log(`🏪 目标店铺: ${opts.storeQuery}`);
  log(`📁 商品目录: ${productDirAbs}`);

  ensureFileExists(productDirAbs, '商品目录');
  ensureFileExists(productJsonPath, 'product.json');
  ensureFileExists(ENRICH_SCRIPT, 'enrich-product.js');
  ensureFileExists(TO_CSV_SCRIPT, 'to-csv.js');
  ensureFileExists(IMPORT_SCRIPT, 'import-csv-onestop.js');

  if (opts.skipEnrich) {
    log('✨ Step 2/4: 跳过内容增强');
  } else {
    log('✨ Step 2/4: 内容增强');
    await runNodeScript(ENRICH_SCRIPT, [productDirAbs], '内容增强');
    log('✅ 内容增强完成');
  }

  if (opts.skipCsv) {
    log('🧾 Step 3/4: 跳过 CSV 生成，直接校验现有 product.csv');
    ensureFileExists(productCsvPath, 'product.csv');
    log(`✅ 已找到现有 CSV: ${productCsvPath}`);
  } else {
    log('🧾 Step 3/4: 生成 product.csv');
    await runNodeScript(TO_CSV_SCRIPT, [productDir, '--store', opts.storeQuery], 'CSV 生成');
    ensureFileExists(productCsvPath, 'product.csv');
    log(`✅ CSV 已就绪: ${productCsvPath}`);
  }

  if (opts.csvOnly) {
    log('🛑 已指定 --csv-only，本次到 CSV 阶段结束');
    return;
  }

  log('📤 Step 4/4: 导入 Shopify 并执行模板收尾');
  await runNodeScript(IMPORT_SCRIPT, [productDir, '--store', opts.storeQuery], 'Shopify 导入/模板收尾');

  log('🎉 发布闭环完成');
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
