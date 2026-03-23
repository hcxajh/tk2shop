#!/usr/bin/env node
/**
 * TikTok 采集并发启动器
 *
 * 用法：
 *   node spawn.js "https://shop.tiktok.com/us/pdp/..."              # 单个
 *   node spawn.js "url1" "url2" "url3"                             # 并发3个
 *   node spawn.js --file urls.txt --parallel 5                    # 从文件读取，5个并发
 *
 * 流程：
 * 1. 解析参数（URL列表 + 并发数）
 * 2. 预分配配置文件（每个任务分配一个空闲profile）
 * 3. 并发启动多个 runner.js 进程
 * 4. 收集结果，输出汇总
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SKILL_DIR = __dirname;
const RUNNER = path.join(SKILL_DIR, 'runner.js');
const PROFILE_POOL_FILE = path.join(SKILL_DIR, 'profile-pool.json');

// ============================================================
// 配置
// ============================================================

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);
}

function loadProfilePool() {
  try {
    const config = JSON.parse(fs.readFileSync(PROFILE_POOL_FILE, 'utf8'));
    return config.profiles || [];
  } catch (e) {
    log(`⚠️ 读取配置池失败: ${e.message}`);
    return [];
  }
}

function readUrlListFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const urls = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });
    rl.on('line', (line) => {
      const url = line.trim();
      if (url && url.startsWith('http') && url.includes('/pdp/')) {
        urls.push(url);
      }
    });
    rl.on('close', () => resolve(urls));
    rl.on('error', reject);
  });
}

// ============================================================
// 任务执行器
// ============================================================

function runTask(url, profileNo) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    log(`🚀 [${url.match(/\/(\d+)(?:\?.*)?$/)?.[1] || url}] profile=${profileNo}`);

    const child = spawn('node', [RUNNER], {
      env: {
        ...process.env,
        TK_TIKTOK_URL: url,
        TK_ADSPOWER_PROFILE: String(profileNo)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      process.stdout.write(data); // 实时输出
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(data);
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const success = code === 0;
      log(`📦 [${elapsed}s] ${success ? '✅' : '❌'} ${url}`);

      // 尝试从输出中解析结果
      let result = null;
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
        if (jsonMatch) result = JSON.parse(jsonMatch[0]);
      } catch (e) {}

      resolve({
        url,
        profileNo,
        success,
        code,
        elapsed,
        result
      });
    });

    child.on('error', (err) => {
      resolve({
        url,
        profileNo,
        success: false,
        error: err.message,
        elapsed: 0,
        result: null
      });
    });
  });
}

// ============================================================
// 主程序
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('用法:');
    console.log('  node spawn.js "https://shop.tiktok.com/us/pdp/..."');
    console.log('  node spawn.js "url1" "url2" "url3" --parallel 3');
    console.log('  node spawn.js --file urls.txt --parallel 5');
    process.exit(1);
  }

  // 解析参数
  let urls = [];
  let concurrency = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      const fileUrls = await readUrlListFromFile(args[i + 1]);
      urls.push(...fileUrls);
      i++;
    } else if (args[i] === '--parallel' && args[i + 1]) {
      concurrency = Math.max(1, Math.min(10, parseInt(args[i + 1], 10) || 3));
      i++;
    } else if (args[i].startsWith('http')) {
      urls.push(args[i]);
    }
  }

  if (urls.length === 0) {
    console.error('❌ 未找到有效URL');
    process.exit(1);
  }

  const pool = loadProfilePool();
  if (pool.length === 0) {
    console.error('❌ 配置文件池为空');
    process.exit(1);
  }

  log(`🎯 待采集: ${urls.length} 个商品`);
  log(`⚡ 并发数: ${concurrency}`);
  log(`📋 配置文件池: ${pool.length} 个 (${pool.join(', ')})`);
  log('');

  // 过滤出真实存在的 profile（通过 get-browser-active 验证）
  const { execSync } = require('child_process');
  const validPool = pool.filter(pno => {
    try {
      const out = execSync(
        `npx --yes adspower-browser get-browser-active '{"profileNo":"${pno}"}' 2>/dev/null`,
        { encoding: 'utf8', timeout: 10000 }
      );
      // "Profile does not exist" 说明 profile 编号不存在
      return !out.includes('Profile does not exist');
    } catch {
      return false;
    }
  });

  if (validPool.length === 0) {
    console.error('❌ 配置池中没有有效的配置文件');
    process.exit(1);
  }

  log(`✅ 有效配置文件: ${validPool.length} 个 (${validPool.join(', ')})`);
  log('');

  // 预分配：每个URL分配一个profile，轮询使用有效 pool
  const tasks = urls.map((url, i) => ({
    url,
    profileNo: validPool[i % validPool.length]
  }));

  log(`📌 任务分配完成，开始执行...`);
  log('');

  // 并发控制
  const results = [];
  let active = 0;
  let index = 0;
  let resolveMain;
  const mainPromise = new Promise(r => { resolveMain = r; });

  const runNext = () => {
    while (index < tasks.length && active < concurrency) {
      const task = tasks[index++];
      active++;
      runTask(task.url, task.profileNo).then(result => {
        active--;
        results.push(result);
        runNext();
        if (active === 0 && index >= tasks.length) resolveMain();
      });
    }
  };

  runNext();
  // 如果所有任务一开始就满了，runNext 不会再次触发，需要在这里等
  await new Promise(resolve => {
    const checkDone = setInterval(() => {
      if (active === 0 && index >= tasks.length) {
        clearInterval(checkDone);
        resolve();
      }
    }, 500);
  });

  // 汇总
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;

  log('');
  log('========================================');
  log(`📊 汇总: ${successCount} 成功 / ${failCount} 失败`);
  log('========================================');
  results.forEach(r => {
    const mark = r.success ? '✅' : '❌';
    const info = r.success
      ? `${r.elapsed}s → ${r.result?.productId || ''}`
      : r.error || `exit ${r.code}`;
    log(`  ${mark} ${r.url} | ${r.profileNo} | ${info}`);
  });

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
