# 私记 · 前端重构设计纲要（纸本手记）

> 这是本批前端重构的唯一视觉/排版依据。所有页面按此执行；文案以 `design/COPY.md` 为准。
> 不得引入任何网络字体、图片、图标库新增依赖或远程资源（CSP 与离线要求）。
> 现有组件 props、状态逻辑、数据流、无障碍语义保持不变；只改视觉、排版、标记结构与文案。

## 1. 概念

把应用做成一册**随身携带的私人纸本手记**：暖纸底色、墨色文字、朱砂印章。
- 视觉：纸（暖白/米色）、墨（近黑棕）、朱砂（印章红）三色为主，配少量苔绿（隐私/成功）。
- 排版：宋体大标题 + 无衬线正文；小号编号/标签（eyebrow）拉开层次；细线（hairline）分隔；留白充足。
- 组件：卡片是"纸页"——小圆角、1px 细线、极轻纸影，不是浮起来的白色圆角方块。
- 照片：像贴进本子的相片——细纸边、小圆角、下方配时间小字。
- 语气：安静、亲密、克制，第二人称，短句，句号收尾，不用感叹号，不卖萌。
- 深色模式叫"夜读"：墨纸 + 米色文字，朱砂提亮。
- 移动优先（390×844 为主），桌面（≥650px）适度放大留白与字号。保持 44px 触控目标、`focus-visible`、安全区、`prefers-reduced-motion`。

## 2. 设计令牌（写在 `src/styles/tokens.css`，字段名固定）

```css
:root {
  --serif: "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC",
    "SimSun", Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
    "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;

  /* 日读（浅色） */
  --paper: #f4efe6;
  --paper-raised: #fbf7ef;
  --paper-sunken: #ece5d7;
  --ink: #241f1a;
  --ink-soft: #5f574b;
  --ink-faint: #8d8272;
  --rule: #ddd3c2;
  --rule-strong: #c9bca6;
  --seal: #a83a28;
  --seal-deep: #8e2f20;
  --seal-soft: #f1ded4;
  --moss: #4f6b57;
  --moss-soft: #e4eadf;
  --danger: #a5342c;
  --danger-soft: #f3ddd8;
  --highlight: #f5ebc9;          /* 便签黄，用于"提示/一次性的强调" */
  --shadow: 0 1px 0 rgba(36, 31, 26, 0.04), 0 18px 40px -28px rgba(36, 31, 26, 0.45);
  --shadow-lift: 0 2px 0 rgba(36, 31, 26, 0.04), 0 24px 60px -30px rgba(36, 31, 26, 0.5);
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius: 8px;
  --radius-lg: 14px;
  --radius-sheet: 18px;
  --gutter: 22px;
  --content-max: 680px;
  --nav-h: 62px;
  --fs-display: clamp(30px, 7.6vw, 38px);
  --fs-h2: 19px;
  --fs-h3: 15.5px;
  --fs-body: 15px;
  --fs-small: 13px;
  --fs-caption: 11.5px;
  --fs-eyebrow: 10.5px;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --paper: #14110d;
  --paper-raised: #1d1812;
  --paper-sunken: #262019;
  --ink: #efe7d8;
  --ink-soft: #b9ac98;
  --ink-faint: #8a7e6d;
  --rule: #332c22;
  --rule-strong: #4a4032;
  --seal: #e07a5f;
  --seal-deep: #e98a70;
  --seal-soft: #3a261d;
  --moss: #93b79c;
  --moss-soft: #26302a;
  --danger: #e08072;
  --danger-soft: #33201c;
  --highlight: #3a3020;
  --shadow: 0 0 0 1px rgba(0, 0, 0, 0.2), 0 18px 40px -28px #000;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 使用与 :root[data-theme="dark"] 完全相同的变量 */ }
}
```

排版规则：
- `h1` 用 `--serif`：`font-size: var(--fs-display); font-weight: 600; line-height: 1.28; letter-spacing: .02em;`
- `h2` 用 `--serif`：`font-size: var(--fs-h2); font-weight: 600; letter-spacing: .03em;`
- `h3` 用 `--serif`：`font-size: var(--fs-h3); font-weight: 600;`
- 正文 `--sans`，`font-size: var(--fs-body); line-height: 1.75;`
- `.eyebrow`：`font-size: var(--fs-eyebrow); letter-spacing: .24em; color: var(--seal); font-weight: 600; text-transform: none;`（中文编号/日期，不要全大写英文装饰）
- 数字（时间、统计值、日期）用 `font-variant-numeric: tabular-nums;`
- 标题不要用渐变字/阴影；所有装饰只用细线、印章色块、便签黄块。

## 3. 通用组件模式（写进 `src/styles/tokens.css` / `shell.css`）

**页面骨架**：`.app-shell` 最大宽 `--content-max`；`main` 左右 `--gutter`。
页面不使用装饰性大标题：每页只保留一个 `sr-only` 的 `<h1>` 功能名（今天 / 日历 / 记录 / 回顾 / 设置）；今天页在正文顶部有一条 `.page-meta`（日期 `.eyebrow` + 右侧 `.local-tag`，下方 1px 细线），其余页面直接从内容区开始。

**纸页卡片 `.card`**：
```css
background: var(--paper-raised);
border: 1px solid var(--rule);
border-radius: var(--radius-sm);
box-shadow: var(--shadow);
padding: 18px;
margin-bottom: 16px;
```
需要强调的卡片（首页佩戴区、设置隐私卡）可加 `border-top: 2px solid var(--seal)` 或左侧 2px 朱砂线。

**按钮**：
- `.primary`：朱砂底 `var(--seal)`、纸色文字、`border-radius: var(--radius-xs)`、高 48px、`letter-spacing: .06em`、按下 `--seal-deep`。
- `.secondary`：透明/纸底、1px `--rule-strong` 边框、墨色文字；按下 `--seal-soft`。
- `.text-button`：墨色或朱砂，细下划线（`text-underline-offset: 4px`），不高于 36px。
- `.danger-button`：`--danger` 底；`.danger-text`：`--danger` 文字 + 下划线。
- 所有按钮 `transition: color .15s, background-color .15s, border-color .15s`，不使用大位移/缩放动画。

**输入控件 `.field`**：标签 `--fs-small`、`--ink-soft`，字重 500；输入框纸凹底 `--paper-sunken`、1px `--rule`、`--radius-xs`、高 46px、focus 时 1px `--seal` + 2px `--seal-soft` 外圈。`select` 保持原生外观。

**章节标题 `.section-line`**：`h2` 宋体 + 右侧小字；下方 1px `--rule`，间距 12px。列表条目之间用 `border-top: 1px solid var(--rule)`。

**模态 `.sheet`**：纸底、顶部 `--radius-sheet`、抓手细线；标题宋体 20px；桌面居中、`--radius`。

**底部导航 `.bottom-nav`**：纸底 + 顶部 1px 细线，5 个 tab；选中项朱砂色并在图标下加 3px 朱砂短横线；中间"记录"是 46px 朱砂圆形相机按钮（`capture-nav`），不参与选中横线。标签 10px，`--letter-spacing: .08em`。

**页头 `.app-header`**：左侧印章（`.brand-mark` 38×38，朱砂底、纸色宋体"私"字，微转 -2deg）+ 品牌宋体 21px + 副题 `只写给自己`；右侧眼睛/锁图标按钮。

**照片 `.photo-thumb`**：4px 圆角，1px `--rule-strong` 边框，内边距 2px 纸色（相片纸边），`concealed` 模糊效果保留。

**空状态 `.empty`**：细线图标 → 宋体标题 → 小字说明，垂直留白 28px。

**Toast**：墨底纸字、小圆角、小字。

**图表**：轴文字 `--ink-faint` 10px，网格 `--rule`，主色 `--seal`，辅色 `--moss`，背景透明。热力图色阶：`--rule` → 朱砂 25/45/70/100%。

**FateWheel**：轮盘扇区颜色使用 `FATE_COLORS` 新纸本调色板（见 COPY），指针为朱砂三角，外框细线圆；结果区做成"便签条"（`--seal-soft` 底、左边 2px 朱砂线）。

## 4. CSS 拆分与文件所有权

`src/style.css` 只保留 `@import "tailwindcss";` + 各模块 import（Lead 负责）。各模块：

| 文件 | 负责人 | 负责的选择器（现有 class 名必须保留） |
|---|---|---|
| `src/styles/tokens.css` | Lead | `:root` 变量、暗色、reset、`h1-h3/p/small/a`、`button`、`.primary/.secondary/.text-button/.danger-button/.danger-text/.wide`、`.field`/输入、`.checkbox`、`.segmented`、`.error/.success`、`.muted`、`.group-label`、`.section-line`、`.sr-only`、`.toast`、`.offline-banner`、`.loading` |
| `src/styles/shell.css` | Lead | `.app-shell/.app-header/.brand*/.page-meta/.eyebrow/.local-tag`、`.bottom-nav/.capture-nav`、`.page-footer`、`.card`、`.photo-thumb/.photo-strip/.record*/.tags`、`.empty`、`.modal-backdrop/.sheet/.sheet-heading`、`.viewer*`、`.privacy-cover`、`.auth*` |
| `src/styles/home.css` | Home 负责人 | `.wear-hero/.hero-*/.state-label/.home-metrics/.quick-capture/.recent-grid/.fate-launch*/.fate-session-badge` |
| `src/styles/calendar.css` | Calendar 负责人 | `.calendar-card/.month-heading/.calendar-grid/.weekdays/.day*/.calendar-foot/.timeline-date` |
| `src/styles/records.css` | 记录表单负责人 | `.entry-form/.capture-zone/.camera-symbol/.capture-buttons/.draft-photos/.remove-photo/.photo-edit/.details-toggle/.comfort-options/.privacy-caption/.fast-tags`、`.session-row`、`.brush-canvas`、`.compare-*`、`.share-preview` 以外的表单选择器 |
| `src/styles/stats.css` | 统计负责人 | `.stat-grid/.metric/.stat-detail/.chart/.chart-legend/.range-select/.heat*/.data-row/.share-preview` |
| `src/styles/settings.css` | 设置负责人 | `.privacy-card/.privacy-emblem/.settings-list/.setting-label/.storage-info/.install-card/.status-pill/.storage-warning/.restore-preview/.backup-link/.danger` |
| `src/styles/fate.css` | 轮盘负责人 | `.fate-*`（含 `.fate-counts/.fate-timeline`），`.option-row` 可放ここ |

`compare-*` 选择器放 `records.css`（由记录表单负责人统一重构）。`.share-preview` 放 `stats.css`。

## 5. 组件与文案所有权

| 范围 | 负责人 | 文件 |
|---|---|---|
| 外壳、解锁、共享组件 | Lead | `src/App.tsx`、`src/components/Auth.tsx`、`src/components/Shared.tsx`、`index.html`、`scripts/icons.mjs`、`src/style.css`、`tokens.css`、`shell.css` |
| 今天页 + 首页局部 | Home | `src/components/Home.tsx`、`src/styles/home.css` |
| 日历 + 照片对比 | Calendar | `src/components/Calendar.tsx`、`src/components/ComparePhotos.tsx`、`src/styles/calendar.css` |
| 记录表单 + 时段 + 打码 | Records | `src/components/EntryForm.tsx`、`src/components/SessionForm.tsx`、`src/components/PrivacyBrush.tsx`、`src/styles/records.css` |
| 回顾 + 匿名小结 | Stats | `src/components/Stats.tsx`、`src/components/ShareCard.tsx`、`src/lib/shareCard.ts`、`src/styles/stats.css` |
| 设置 + 偏好 + 快速解锁 | Settings | `src/components/Settings.tsx`、`src/components/JournalOptions.tsx`、`src/components/BiometricSettings.tsx`、`src/styles/settings.css` |
| 命运轮盘 | Fate | `src/components/FateWheel.tsx`、`src/lib/fate.ts`（仅文案/颜色/预设）、`src/styles/fate.css` |
| 端到端测试与 README | QA | `tests/e2e/*.spec.ts`、`README.md` |

## 6. 硬性约束

1. **只改自己名下的文件。** 需要改其他文件（`Shared.tsx`、`App.tsx`、lib 通用逻辑）时，发消息给 lead 说明。
2. **不改组件 props / 状态 / 数据流 / IndexedDB / 加密逻辑。** 只改 JSX 结构、class、文案。
3. **保留现有测试依赖的 class 钩子**：`article.record`、`.photo-strip`、`.record-heading`、`.record-note`、`.tags`、`.home-metrics`、`.wear-timer`、`.hero-start`、`.fate-launch`、`.fate-result`、`.fate-rule`、`.fate-legend`、`.fate-history`、`.fate-session-badge`、`.stat-detail`、`.eyebrow`、`.toast`、`.compare-picks`、`.compare-stage`、`.compare-divider`、`.calendar-grid`、`.day`、`.selected`、`.segmented`、`role` 与 aria 属性。可新增 class，不删除这些。
4. **文案严格照 `design/COPY.md`**，不得自行发挥；COPY 里标"保持"的字符串不要动。COPY 未覆盖的次要文案（纯技术报错、aria）按同一语感微调。
5. 不使用内联 style 做视觉（图表库必需的除外）；所有颜色走变量，只有 canvas 绘图和 `FATE_COLORS` 可写十六进制。
6. 保持每屏首屏信息量不增加：移动端优先，主操作在拇指区。
7. 视觉验收：390×844 与 1280×900 两档；浅色/深色两套；不允许横向滚动；文字不溢出；触控目标 ≥44px。
8. 不要运行 `npm run build` / `npm run test` / playwright：本机沙箱会 EPERM，由 Lead 统一构建与验收。可运行 `node node_modules/typescript/bin/tsc -b` 做类型检查（如遇 tsbuildinfo 占用可跳过）。
9. 完成后向 lead 发送：改了哪些文件、文案是否与 COPY 完全一致、有无未决问题。

## 7. 各页排版要点

### 解锁页（Lead）
整屏纸面。顶部朱砂印章 + `私记` 宋体字与副题；中段大宋体标题（换行）；说明小字；密码表单是纸页卡（顶线朱砂）；主按钮"打开手记"；快速解锁为细线按钮；底部隐私一行（苔绿）与警告小字；"忘记密码？"为文字按钮。

### 今天页（Home）
- 佩戴区是第一张纸页：顶栏"状态点 + 状态文字"与右侧"时段 →"；`.hero-caption` 小字；`.wear-timer` 宋体 52px；开始时间小字；朱砂便签式命运徽标；主按钮 + 次按钮（小憩）。
- 三栏指标 `.home-metrics`：无卡片，上下细线，标签小字 + 宋体大数字。
- `.quick-capture`：虚线相框图标 + 文案 + 箭头的一行纸页。
- `.fate-launch`：与 quick-capture 同构，但图标为朱砂印章式方块。
- "最近的照片"：3 列相片墙（照片+时间小字）；"今天写下的"：`.record` 列表。
- 空状态用 COPY 文案。

### 日历页（Calendar）
- `.segmented` 改为底部细线两档 tab（月历 / 时间线），无灰底滑块。
- 月历卡：宋体年月 + 圆图标按钮；星期行小字；日期格 46px，选中为朱砂文字 + 底部 2px 朱砂线，今天为朱砂圆点；笔数用 `8px` 小字放数字下方。
- 下方"X 月 X 日"+ 笔数、对比按钮（细线 secondary）、`.record` 列表。
- 时间线：日期标题宋体 + 右侧笔数，下细线；卡间距 14px。

### 记录页（Records）
- 拍照区：虚线纸框 + 细线相机图标（56px）+ 宋体标题 + 说明 + 两个按钮。
- 照片网格 3 列相片纸；删除按钮深墨圆点；"遮一下"小标签在左下。
- 表单区：标签小字、纸凹输入；"再写两句"折叠行为细线行；舒适度 5 个方块数字，选中朱砂。
- 提交按钮"收进今天"；底部隐私小字；危险操作文字按钮。

### 回顾页（Stats）
- 顶部两个入口按钮（匿名小结 / 轮盘历史）以纸页列表呈现。
- 4 个指标卡：2×2，宋体大数字 + 小字标签 + 细线说明。
- 各图表卡：宋体 h2 + 小字说明；卡片之间留白 18px；热力图用朱砂色阶 + 细线框。
- `.data-row` 用细线行、左右对齐、小字。
- Chart 颜色改 `--seal`/`--moss`/`--ink-faint`，移除默认白色背景 tooltip 圆角过大问题（改为纸色、4px 圆角、1px 细线）。

### 设置页（Settings）
- 顶部隐私卡：朱砂印章图标 + 宋体标题 + 说明。
- 分组标签用 `.group-label`（朱砂小字 + 后接细线）。
- `.settings-list` 行：图标（细线）、主文案、副文案小字、右侧箭头；行间细线。
- 备份/恢复/改密/清空均为 sheet 内的表单块，无嵌套卡片，用细线分隔。
- 外观下拉纸凹样式；存储信息用定义列表式 `.data-row`。

### 命运轮盘（Fate）
- 轮盘：细线外圈 + 12 点刻度感（可用 `stroke-dasharray` 虚线），指针朱砂；中心朱砂小圆。
- 结果区便签条；图例为"编号 + 色点 + 名称 + 概率"细线列表；配置/历史 sheet 内表单统一。
