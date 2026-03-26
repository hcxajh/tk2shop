#!/usr/bin/env node
/**
 * Shopify 发布总入口（A 方案）
 *
 * 目标：
 * 1. 检查商品目录
 * 2. 生成/校验 product.csv
 * 3. 调用 import-csv-onestop.js 完成 Shopify 导入
 * 4. 由导入脚本自动完成模板收尾（评论模板填写 + Theme template 绑定）
 *
 * 用法：
 *   node publish-product.js <商品目录> --store <店铺ID>
 *   node publish-product.js 2026-03-26/010 --store vellin1122
 *
 * 可选：
 *   --skip-csv   若 product.csv 已存在，则跳过重新生成
 *   --csv-only   只生成/校验 CSV，不执行导入
 *   --help, -h   查看帮助
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TK_OUTPUT_DIR = '/root/.openclaw/TKdown';
const TO_CSV_SCRIPT = path.join(__dirname, 'to-csv.js');
const IMPORT_SCRIPT = path.join(__dirname, 'import-csv-onestop.js');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = {
    productDir: '',
    storeQuery: '',
    skipCsv: false,
    csvOnly: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if ((cur === '--help') || (cur === '-h')) out.help = true;
    else if (cur === '--store' && args[i + 1]) out.storeQuery = args[++i];
    else if (cur === '--skip-csv') out.skipCsv = true;
    else if (cur === '--csv-only') out.csvOnly = true;
    else if (!cur.startsWith('--') && cur.includes('/')) out.productDir = cur;
  }

  return out;
}

function printHelp() {
  console.log('用法:');
  console.log('  node publish-product.js <商品目录> --store <店铺ID>');
  console.log('');
  console.log('示例:');
  console.log('  node publish-product.js 2026-03-26/010 --store vellin1122');
  console.log('');
  console.log('可选参数:');
  console.log('  --skip-csv   若已存在 product.csv，则跳过重新生成');
  console.log('  --csv-only   只生成/校验 CSV，不执行导入');
  console.log('  --help, -h   查看帮助');
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

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.productDir) {
    printHelp();
    throw new Error('请指定商品目录');
  }
  if (!opts.storeQuery) {
    printHelp();
    throw new Error('请指定 --store <店铺ID>');
  }

  const productDirAbs = path.join(TK_OUTPUT_DIR, opts.productDir);
  const productJsonPath = path.join(productDirAbs, 'product.json');
  const productCsvPath = path.join(productDirAbs, 'product.csv');

  log(`📦 发布商品: ${opts.productDir}`);
  log(`🏪 目标店铺: ${opts.storeQuery}`);
  log(`📁 商品目录: ${productDirAbs}`);

  ensureFileExists(productDirAbs, '商品目录');
  ensureFileExists(productJsonPath, 'product.json');
  ensureFileExists(TO_CSV_SCRIPT, 'to-csv.js');
  ensureFileExists(IMPORT_SCRIPT, 'import-csv-onestop.js');

  if (opts.skipCsv) {
    log('🧾 Step 1/2: 跳过 CSV 生成，直接校验现有 product.csv');
    ensureFileExists(productCsvPath, 'product.csv');
    log(`✅ 已找到现有 CSV: ${productCsvPath}`);
  } else {
    log('🧾 Step 1/2: 生成 product.csv');
    await runNodeScript(TO_CSV_SCRIPT, [opts.productDir, '--store', opts.storeQuery], 'CSV 生成');
    ensureFileExists(productCsvPath, 'product.csv');
    log(`✅ CSV 已就绪: ${productCsvPath}`);
  }

  if (opts.csvOnly) {
    log('🛑 已指定 --csv-only，本次到 CSV 阶段结束');
    return;
  }

  log('📤 Step 2/2: 导入 Shopify 并执行模板收尾');
  await runNodeScript(IMPORT_SCRIPT, [opts.productDir, '--store', opts.storeQuery], 'Shopify 导入/模板收尾');

  log('🎉 发布闭环完成');
}

main().catch(err => {
  console.error(`❌ 错误: ${err.message}`);
  process.exit(1);
});
