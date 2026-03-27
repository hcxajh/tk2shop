# 2026-03-26 发布总入口脚本设计（A 方案）

## 目标

新增一个“发布总入口”脚本，一条命令完成已有商品目录的 Shopify 发布闭环：

1. 检查商品目录与必要产物
2. 生成/校验可导入 CSV（优先复用现有 `to-csv.js` 能力）
3. 调用 `import-csv-onestop.js` 完成 Shopify CSV 导入
4. 由已串接的后处理流程自动完成：
   - Theme Editor 评论模板填写
   - 商品 `Theme template` 绑定

本期 **不包含采集**，只封装“发布”链路。

---

## 范围

### 包含
- 已有商品目录的一键发布
- 对目录内关键文件做前置检查
- 统一日志输出
- 失败时明确卡在哪一段：
  - CSV 生成
  - CSV 导入
  - 模板收尾

### 不包含
- TikTok 采集
- 批量多商品调度
- 并发发布
- 重试队列/任务中心
- 远程消息通知

---

## 脚本位置

建议新增：

- `scripts/publisher/publish-product.js`

这是“发布总入口”。

---

## CLI 设计

### 基础用法

```bash
node scripts/publisher/publish-product.js <商品目录> --store <店铺ID>
```

### 示例

```bash
node scripts/publisher/publish-product.js 2026-03-26/010 --store vellin1122
```

### 可选参数（首版）

- `--store <店铺ID>`：必填
- `--skip-csv`：若目录内已有最新 `product.csv`，可跳过重新导出
- `--csv-only`：只导出/校验 CSV，不执行导入
- `--help` / `-h`

> 首版不做太多参数，避免入口过重。

---

## 调用链设计

总入口脚本内部只做编排，不重复实现底层逻辑。

### 推荐链路

1. **解析参数**
2. **解析商品目录**
3. **前置检查**
   - `product.json` 是否存在
   - 若不 `--skip-csv`：允许重新生成 CSV
   - 若 `--skip-csv`：要求 `product.csv` 已存在
4. **生成 CSV（如需要）**
   - 调用现有 `scripts/publisher/to-csv.js`
5. **执行导入**
   - 调用现有 `scripts/publisher/import-csv-onestop.js`
6. **输出总结果**
   - 成功：提示“发布闭环完成”
   - 失败：清晰指出失败阶段

### 关键原则

- **总入口只编排，不重写导出/导入/模板逻辑**
- `import-csv-onestop.js` 已经串接了 `post-import-theme-setup.js`
- 所以总入口无需再单独调用模板脚本，避免重复执行

---

## 依赖关系

### 现有可复用脚本
- `scripts/publisher/to-csv.js`
- `scripts/publisher/import-csv-onestop.js`
- `scripts/publisher/post-import-theme-setup.js`

### 实际链路
- `publish-product.js`
  - 调 `to-csv.js`
  - 调 `import-csv-onestop.js`
    - 内部已自动调 `post-import-theme-setup.js`

---

## 日志策略

总入口脚本统一输出阶段日志，例如：

- `📦 发布商品: ...`
- `🧾 Step 1/2: 生成 CSV`
- `📤 Step 2/2: 导入 Shopify 并执行模板收尾`
- `✅ 发布完成`

若子脚本失败：
- 明确报 `CSV 生成失败`
- 或 `Shopify 导入/模板收尾失败`

---

## 失败策略

### 首版策略
- 任一步骤失败即退出非 0
- 不自动重试
- 不吞错误
- 保留子脚本原始日志输出

这样最利于排障，也符合当前阶段需求。

---

## 首版实现任务拆分

### Task 1：新增 `publish-product.js`
- 参数解析
- 路径解析
- 前置检查
- 子脚本调用封装

### Task 2：接入 `to-csv.js`
- 支持默认生成 `product.csv`
- 支持 `--skip-csv`
- 支持 `--csv-only`

### Task 3：接入 `import-csv-onestop.js`
- 调用既有导入一体化脚本
- 复用其模板收尾能力

### Task 4：真实样本回归
- 用 `2026-03-26/010`
- 至少验证：
  - 总入口能正常调用导出
  - 总入口能进入导入链路
  - 导入后模板收尾仍正常执行

---

## 验收标准

执行：

```bash
node scripts/publisher/publish-product.js 2026-03-26/010 --store vellin1122
```

满足：

1. 能成功生成/复用 `product.csv`
2. 能成功导入 Shopify
3. 能自动完成模板评论填写与商品模板绑定
4. 最终命令退出码为 0
5. 日志可明确看出每个阶段

---

## 备注

本期先做 A 方案，目标是：

**把“已有商品目录发布到 Shopify”的实际落地流程，收口成一条稳定命令。**

后续如果要扩展到：
- B：采集 + 发布总入口
- C：批量总入口

可以在这个脚本之上继续向外包一层，不需要推倒重来。
