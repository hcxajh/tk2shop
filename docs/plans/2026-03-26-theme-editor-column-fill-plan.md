# Shopify Theme Editor Column 内容自动填写 Implementation Plan

> 日期：2026-03-26
> 目标：在现有 `post-import-theme-setup.js` 已能进入 Theme Editor / Product / 新模板 / Multicolumn 的基础上，继续自动填写 3 个 Column 的用户名与好评内容，并点击保存。

## 目标收口

本轮只做这一段最小闭环：
1. 读取商品产物中的 3 条评论素材
2. 模板名改为 `YYYYMMDDHHmmss`
3. 进入 Theme Editor 的 Product 模板
4. 创建新模板
5. 进入 `Multicolumn`
6. 依次进入 3 个 `Column`
7. 每个 `Column`：
   - 上边填写用户名
   - 下边填写好评内容
8. 点击 `Save`
9. 成功后退出并回报模板名

## 明确不做

本轮刻意不做：
- 不处理模板绑定商品
- 不处理按钮文案/链接
- 不处理图片替换
- 不处理第 4 个及以上 Column
- 不处理多 section 联动
- 不处理 theme publish
- 不串回“发布商品总控脚本”

---

## 现有基础判断

已确认现有脚本 `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js` 已具备：
- 连接 AdsPower 浏览器
- 复用当前 Shopify 后台上下文
- 进入 Themes
- 打开 Theme Editor
- 切到 Product
- 创建模板
- 进入 `Multicolumn`

所以这次不重写主骨架，只在现有脚本基础上继续补：
- 评论数据读取
- 时间模板名
- Column 内容定位与填写
- Save 成功判定

---

## 数据来源设计

### 数据入口
优先从商品目录内的 `product.json` 读取：
- `templateAssets.reviews`

预期结构：
```json
{
  "templateAssets": {
    "reviews": [
      { "name": "...", "content": "..." },
      { "name": "...", "content": "..." },
      { "name": "...", "content": "..." }
    ]
  }
}
```

### CLI 输入补充
建议给脚本补一个商品目录参数，例如：
- `--product-dir 2026-03-26/010`

用途：
- 进入脚本后能直接从对应目录读取 `product.json`
- 避免把评论内容硬编码进脚本

### 数据校验
脚本启动后先做硬校验：
- `product.json` 存在
- `templateAssets.reviews` 是数组
- 至少有 3 条
- 每条都有 `name` 和 `content`

若不满足，直接报错退出，不继续进入 Theme Editor。

---

## 模板命名规则

### 新规则
模板名改为当前时间：
- `YYYYMMDDHHmmss`

示例：
- `20260326154530`

### 实现方式
在 Node 里本地格式化时间，避免依赖 UI 侧生成。

### 成功要求
- 创建模板时实际输入值与预期模板名一致
- 若输入框回弹为空或值不一致，直接失败退出

---

## Theme Editor 内容填写策略

### 总体原则
不要一上来就靠“猜字段顺序”直接填。
先按可重复定位规则收口：
1. 先进入 `Multicolumn`
2. 再逐个进入 `Column`
3. 在单个 `Column` 设置面板里识别：
   - 上边输入框（用户名）
   - 下边输入框（好评）
4. 填完一个，再回到下一个

### 关键未知点（本轮要先探明）
当前还未完全确认的是：
- 单个 Column 的设置面板里，用户名字段和好评字段在 DOM 上的稳定选择器是什么
- 是：
  - `Heading` + `Text`
  - 还是 `Caption` + `Heading`
  - 还是两个 `rich text` / `textarea`

### 先探测、再固化
建议先在脚本中加入一段调试探测：
- 进入第一个 Column 后
- 打印设置面板里可见字段标签
- 确认真实字段结构

在确认后再正式固化填写逻辑。

---

## Column 填写动作设计

### Step 1：进入 Multicolumn
复用现有稳定逻辑：
- 锁定 `li[data-component-extra-section_type="multicolumn"]`
- 点击主按钮进入

### Step 2：收集 Column 列表
目标是稳定拿到 3 个 Column 项：
- `Column`
- `Column`
- `Column`

成功标准：
- 至少找到 3 个 Column 导航项
- 顺序与 UI 展示顺序一致

### Step 3：逐个进入 Column
按 index 处理：
- 第 1 个 Column → reviews[0]
- 第 2 个 Column → reviews[1]
- 第 3 个 Column → reviews[2]

### Step 4：在 Column 设置面板中填写内容
预期填写规则：
- 用户名写上边字段
- 好评写下边字段

待确认的最稳方法：
1. 优先通过字段 label 定位
2. 再用真实 `.fill()` / `.click()` / `.type()` 触发输入
3. 输入后立即回读 value 校验

### Step 5：逐个完成后点击 Save
成功标准：
- Save 按钮可点击
- 点击后出现保存成功的 UI 反馈，或 Save 按钮恢复为不可用状态

---

## 建议拆分任务

### Task 1：补 CLI 参数与评论数据读取
**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**内容：**
- 新增 `--product-dir`
- 读取 `product.json`
- 读取 `templateAssets.reviews`
- 校验 3 条评论结构
- 新增时间模板名生成函数

**成功标准：**
- 不进浏览器也能完成参数校验
- 日志打印模板名与 3 条评论

### Task 2：补第一个 Column 的字段探测
**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**内容：**
- 进入第一个 Column
- 打印设置面板中可见 label / input / textarea 摘要
- 找到稳定字段类型

**成功标准：**
- 能明确知道“用户名字段”和“好评字段”的真实 UI 结构

### Task 3：实现 3 个 Column 的内容填写
**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`

**内容：**
- 逐个点 3 个 Column
- 分别写入用户名与评论
- 每次输入后校验值

**成功标准：**
- 3 个 Column 均完成填写
- 未出现字段串位或漏填

### Task 4：实现 Save 与结果判定
**Files:**
- Modify: `/root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js`
- Modify: `/root/.openclaw/skills/tk2shop/docs/shopify-post-publish-steps.md`
- Modify: `/root/.openclaw/skills/tk2shop/CHANGELOG.md`

**内容：**
- 点击 Save
- 增加保存成功判定
- 更新文档与变更记录

**成功标准：**
- 脚本能输出模板名
- 保存完成后不误报

---

## 验证方式

建议用真实样本：
- `/root/.openclaw/TKdown/2026-03-26/010`

建议命令：
```bash
node /root/.openclaw/skills/tk2shop/scripts/publisher/post-import-theme-setup.js \
  --store vellin1122 \
  --product-dir 2026-03-26/010
```

验证要点：
1. 自动生成时间模板名
2. 成功进入 Product 模板并创建模板
3. 成功进入 Multicolumn
4. 3 个 Column 内容正确写入
5. Save 成功

---

## 当前推荐执行顺序
1. 先做 Task 1（数据入口 + 时间模板名）
2. 再做 Task 2（字段探测）
3. 确认字段结构后做 Task 3（正式填写）
4. 最后做 Task 4（保存 + 文档收口）

## 当前结论
这次最容易出问题的不是“进入模板”，而是：
- 单个 Column 编辑面板字段定位
- 保存成功判定

所以实现上要坚持：
- 先探明结构
- 再固化写入
- 不要在字段结构没看清前一次性写死全部流程
