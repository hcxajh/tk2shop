---
name: tk2shop
description: TikTok Shop 商品数据采集与发布插件。从 TikTok Shop 商品页提取数据并发布到 Shopify。触发场景：用户提到 TikTok Shop 商品链接、商品采集、tiktok 商品下载、从 TikTok 搬家到 Shopify。
---

# tk2shop — TikTok 商品采集与发布

## 目录结构

```
tk2shop/
├── SKILL.md                    ← 本文档（入口）
├── scripts/
│   ├── collector/
│   │   ├── runner.js          ← 自动采集（全流程）
│   │   └── spawn.js          ← 并发启动器
│   └── publisher/
│       └── upload-product.js  ← 发布到 Shopify
└── config/
    ├── profile-pool.json      ← AdsPower 配置（师父维护）
    └── stores.json           ← 店铺配置（师父维护）
```

详细文档见 `references/README.md`。

## 快速命令

### 采集

```bash
cd /root/.openclaw/skills/tk2shop
node scripts/collector/runner.js '{"tiktokUrl": "https://shop.tiktok.com/..."}'
```

### 并发采集

```bash
node scripts/collector/spawn.js "url1" "url2" --parallel 3
node scripts/collector/spawn.js --file urls.txt --parallel 5
```

### 发布到 Shopify

```bash
node scripts/publisher/upload-product.js 2026-03-23/001 --store storeId
```

## 配置（师父维护）

所有配置都在 `config/` 目录下，代码里不写死默认值：

- `config/profile-pool.json` — AdsPower 配置文件池
- `config/stores.json` — 店铺配置表

## 重要规则

- **配置文件必须师父手动维护**，代码只读不写
- **OUTPUT_DIR、profiles 等全部从配置文件读取**，不再硬编码
- **店铺发布需指定目标店铺**（模糊匹配 name/profileNo/remark）
