# 工作区保活设计（方案 A · MVP）v3.1

> v3.1 是在 v3 通过独立复核（B1–B4 阻断项 + 高/中/低项均已核对）之后的**增量修订**：简化 MVP、消除 4 个 Block 级缺陷、**不改变核心目标**（切换工作区时含浏览器 tab 的本地工作区保活，webview 不销毁）。
>
> v1 驳回，v2 为有条件通过，v3 为当前实现依据，**v3.1 为落地实现依据**。v3.1 中所有行号、契约与链路结论均已在真实代码中核对（见第 0.1 节「已核实事实基线」），未核对的设计点标注「待确认」，不作推测。
>
> **结论：v3.1 通过条件见第 9.3 节 Gate 清单**，全部标记 **Block** 的 Gate 未通过前不得合入。

---

## 0. v3.1 修订摘要

### 0.1 已核实事实基线（v3.1 校正）

以下结论由 4 条独立侦察线在真实代码中核对得出，v3.1 直接采用，**不得再推测或改写行号**：

| 域 | 事实 |
|---|---|
| 样式入口 | 唯一全局样式入口 `src/renderer/src/main.tsx:4` → `import './styles/theme.css'`；Tailwind v4；已有 `data-*` 样式钩子先例（`[data-theme-region]`、`[data-dock-root]`、`[data-terminal-status]`） |
| AppShell | `<main>` 为 `497-611`；`498-505` standalone 分支；`506-609` else 基础 shell；`515-591` 外层 Tab 条（带 `app-drag`）；`597-607` content 区；`598-599` feature→`FeatureView`；`600-603` 空态；`604-606` → `<DockRoot>`；`610` `<ConnectionDialogs>` |
| `baseActive` | 准确表达式 = `activeStandaloneFeature === null && activeOuter?.kind === 'workspace' && activeWorkspaceId !== null` |
| 拖动区 | `.app-drag` / `.app-no-drag` 定义于 `theme.css:502-507`；`-webkit-app-region` 可继承 |
| feature 根 | `FeatureFrame.tsx:71` 根 = `flex min-h-0 flex-1 flex-col`；standalone 容器需套同类 flex 才能撑满 |
| registry | `InnerViewProps` 定义 `84-98`（无 active 字段）；`InnerView` `100-105`；browser 分支 `157-158` `<BrowserView tab workspace/>`；`BrowserView` 可直接 `useWindowStore` 读状态（先例 `BrowserFeature.tsx:39-40`），**无需改 registry / InnerViewProps** |
| bind 契约 | `src/shared/ipc/contract.ts:475`：`'browser:bind': { req: { workspaceId; tabId; webContentsId }; res: void }`；preload 类型由 contract 泛型自动派生（`preload/index.ts:37-42`）。**注意 res 为 `void`**：renderer 无法从 bind 结果区分拒绝原因——这是 D1 移出「非 owner 渲染占位」的直接原因。MVP 不改 contract |
| 主进程 handler | `src/main/ipc/index.ts:394-398`：实际只解构 `req`，**未接收 `ctx` 参数**（v3 文档称签名含 `ctx: WindowContext` 不准确）。`WindowContext { id; kind; sender }` 定义于 `window/registry.ts:28-32`，`id = sender.id`；完整版若需要 owner，可在该 handler 增加 `ctx` 参数 |
| bindings | `BoundPage` 定义 `bindings.ts:25-29`（无 owner 字段）；`bindIab` `117-201`；entry 赋值 `177-181` |
| 多窗口 | 多主窗共享 main 的 outer/tabs（`main/state/store.ts:630` `outerTabKey(windowKind)` 按 kind 分库）；`browser:changed` 经 `emitToAll` 广播（实际行 `main/ipc/index.ts:943`，位于 `941-945` 段）；renderer `App.tsx:89-93` 全量 `syncBrowserTabs`；renderer 侧 `windowId` **零使用**。主进程**无 outer 变更广播**，故多窗口下 resident 只基于本窗口 outer 快照推导（见 6.2） |
| tabs 闭包状态 | `loading = new Set`（`tabs.ts:483`）、`pendingTitles`（`484`）、`pendingBrowser`（`488`）、`dockCache`（`387`）——均位于 **tabs store 工厂闭包内**，非模块顶层；因 store 单例，行为等价 |
| tabs 关键函数 | `ensure` `688-710`；`loadOrSeed` `497-522`（三分支，不校验工作区是否仍打开）；`hydrate` `679-686`（**全仓无生产调用方，仅测试使用**）；`forget` `1249-1264`（不清 loading/pendingBrowser/pendingTitles）；`syncBrowserTabs` `1093-1193`（缺失 ws → `1094-1098` 存 pending + `ensure` + return；push `1147-1159`；prune `1162-1168` 依赖 `remoteIds`（`1100`）；整段 `write`（`1184`））；`write` `474-480`（整表浅拷贝 + 单 ws 替换） |
| selector | `useShallow` 先例仅 `ChatView.tsx:12,109`；tabs store 有 getter `stateOf:527` / `tabsOf:531` / `activeIdOf:535` / `dockOf:539`（getter，非订阅切片） |
| portal 到 body | 共 12 处：`ProviderModelMenu.tsx:182/197`、`ui/ContextMenu.tsx:132/154`、`shell/WindowControls.tsx:54/108`、`ui/Dialog.tsx:98/142`、`shell/UpdateIndicator.tsx:218/302`、`shell/SearchPalette.tsx:166/267`、`ui/Submenu.tsx:75/96`、`ui/ToastViewport.tsx:96/115`、`ui/Tooltip.tsx:155/191`、`views/chat/ImageLightbox.tsx:134/223`、`views/chat/TurnNavigationRail.tsx:94/112`、`ui/Select.tsx:91`（Radix Portal）；另有 `plugin-ui/view.tsx:155` 直接 appendChild 到 body |
| Context 范式 | 模块级 `createContext` + 独立 Provider（`i18n/index.tsx:4181`、`components/markdown/MarkdownProvider.tsx:32`）；无 workspace 级 Context（现由 zustand 承担） |
| 焦点 | `Composer.tsx:368-370` 挂载即聚焦（注释明确假设「非激活 Tab 不挂载 ⇒ 挂载=可见」）；`ImageLightbox.tsx:97-128` 有 `restoreRef` + `document.contains(el)` 失效判据；**无通用焦点工具**；`src/renderer/src/views` 下 mount-time `useEffect` 约 100 处，保活后需逐项复核（见 4.9 前置检查单） |
| 音频/节流 | renderer **零使用** `setAudioMuted` / `audioMuted` / `setBackgroundThrottling`；全仓唯一相关是主进程 `plugin/host-window.ts:142` `backgroundThrottling:false` |
| 测试 | vitest + jsdom；**无 `e2e/`、无 `*.spec.ts`、无 playwright.config**；`playwright-core` 仅被 `scripts/office-editors-probe.mjs:35,120` 用 `_electron.launch` 做 Electron 进程探针；组件测试范式 `views/chat/__tests__/chat-view.test.ts:1-3`（`createRoot` / `act` / JSDOM） |

### 0.2 v2 → v3 实质变更（历史记录，已被 0.2.1 部分覆盖）

> 本表记录 v2 → v3 的变更。其中第 3/4/5/13/14 项（owner 机制、owner 接管、portal 返回 `null`、E2E harness、generation）**已被 v3.1 修订覆盖**，一律以 0.2.1 为准；保留本表仅为追溯，不得据此实现。

| # | 项 | v2 结论 | v3 变更 | 原因 |
|---|---|---|---|---|
| 1 | **B1** 渲染集 | 只渲染 resident（含 browser tab 的本地已水合工作区） | stage 渲染集 = `dedupe(resident ∪ {活动工作区})`；「仅因 active 而渲染」的层标 `transient`，切走即卸载；**活动但无 browser tab 的工作区也照常渲染** | v2 的定义会让「打开工作区但尚未开浏览器」的活动工作区不被渲染，直接回归到「切换=卸载」之前的功能性缺失 |
| 2 | **B2** 隔离落点 | `inactive` props 经层→Dock→registry→BrowserView 透传 | ① `pointer-events:none` 用 `theme.css` 全局规则 `[data-workspace-active='false'] webview { pointer-events: none }`；② JS 侧新增模块级 `WorkspaceActiveContext`（Provider 挂在 layer 根，值 `{ workspaceId, active }`），`BrowserView` 消费它做 mute/throttle；③ **删除 props 透传表述**；`registry.tsx`、`Dock.tsx` 明确不改 | props 透传要改 `InnerViewProps`（`registry.tsx:84-98` 无 active 字段）与整条分发链；CSS 全局规则 + Context 是零透传的等价手段，且 `BrowserView` 本就能直接读 store（`BrowserFeature.tsx:39-40` 先例） |
| 3 | **B3** 多窗口 owner | 方案待定：BrowserTab/BoundPage 加 `ownerWindowId` 或限制 keepalive | **定案 `ownerWindowId`**：`bindings.bindIab` 入参加 `ownerWindowId` 并在 `122-132` 校验；`BoundPage`（`25-29`）加字段；`main/ipc/index.ts:394-398` 传 `ctx.id`；`BrowserView` 对非 owner 渲染占位。**明确：不改 contract / preload / bootstrap，不需要 renderer 侧 windowId** | `WindowContext.id = sender.id` 已在 handler 内可得，无需新增 windowId 下发链路；contract 只承载 renderer→main 的 req，owner 是 main 侧信息 |
| 4 | **B3** owner 接管 | 未定义 | owner 是 **per-tab**；owner 窗口关闭后**允许接管**（见 4.11.3） | 不给出结论会让「关掉第二个窗口后第一个窗口里的页面永久变占位」成为静默故障 |
| 5 | **B4** 静音语义 | 失活 mute、激活恢复「失活前状态」（记住用户静音偏好） | MVP：失活 `mute`、激活 `unmute`；**不实现「记住用户静音偏好」**（移到完整版，注明当前无此状态） | renderer 零使用 `setAudioMuted`，仓库内不存在「用户静音偏好」状态；为其新建状态属于未验证需求 |
| 6 | **B4** 节流 | 「按 Gate G5 决定」 | **MVP 不做 `setBackgroundThrottling`**，明确接受后台 guest 被节流；完整版时机方案写入 4.8.4 | 同上：renderer 零使用，唯一先例是插件宿主窗口（`host-window.ts:142`），与 workspace guest 无关；MVP 引入无依据 |
| 7 | **B4** 焦点 | 「记录/清理焦点，激活恢复」 | 模块级 per-workspace **元素引用** + `document.contains` 失效判据（`ImageLightbox.tsx:97-128` 先例）；激活时恢复，失败降级到当前 Composer；层卸载即丢弃 ref | 仓库无通用焦点工具，但有可直接复用的失效判据先例 |
| 8 | **H2** resident 顺序 | 按 `workspace.id` 排序 | 改为 **首次成为 resident 的插入顺序（append-only）**：新增成员只 append，成员移除不重排幸存者 | 按 `workspace.id` 排序时，新成员可能插在既有成员之前，React 会 `insertBefore` 移动既有 webview 祖先；append-only 保证既有节点只发生 append，不发生移动 |
| 9 | **H2** 移出去抖 | 无 | 关闭最后一个 browser tab 的移出需去抖 / 连续判定，处理广播分批导致的「消失又回来」 | `browser:changed` 经 `emitToAll` 广播（`941-945`），一次 UI 操作可分多批到达；prune 依赖 `remoteIds`（`1100`），批次间 `hasBrowser` 可能闪回 |
| 10 | **H3** CDP 输入 | 未讨论 | 明确 CDP `Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent` **直接投递 guest、不经宿主命中测试**，故 `pointer-events:none` 不影响 Agent 操作；新增 Block Gate **G16** | 否则「隔离」会被误读为「Agent 也不能操作隐藏页面」，与 1.1/9.1 场景三自相矛盾 |
| 11 | **H4** baseActive | `baseActive` 未精确定义 | 拆为两个判据（见 4.2.3）：`baseShellActive = activeStandaloneFeature === null`（作用于含外层 Tab 条的基础 shell 容器）；`baseActive = baseShellActive && activeOuter?.kind === 'workspace' && activeWorkspaceId !== null`（已核实表达式）。**feature 外层 tab 激活时外层 Tab 条保持可见可交互**；新增回归 Gate **G17** | 已核实表达式在 `activeOuter.kind === 'feature'` 时为 false；若把它直接套在容器上，feature tab 激活时整个 Tab 条会被 inert，无法切走 |
| 12 | **H5** portal | 给 portal 浮层加 `ownerWorkspaceId` 参数并逐处传 | 改用 `WorkspaceActiveContext`（**React Context 跨 `createPortal` 生效**）：失活时 workspace-owned 浮层返回 `null`；`useWorkspaceActive()` 无 Provider 时默认 `true`。明确纳入/排除清单（见 4.7.3） | 免改 12 处 portal 的调用签名；Context 默认值保证 app 级用法零改动 |
| 13 | **H6** E2E | 只提出「必须有双窗口 E2E」 | 基于既有 `scripts/*.mjs` + `playwright-core _electron.launch` 先例搭 harness（`scripts/office-editors-probe.mjs:35,120`），**不引入 Playwright test runner**；给出建议路径与探针能力；脚手架工作量单列 | 仓库无 `e2e/`、无 `*.spec.ts`、无 playwright.config；引入 test runner 会新增依赖与配置面 |
| 14 | **M1** 水合治理 | 「generation 或 tombstone」二选一，描述含糊 | 精确化：`forget` 清 `loading` / `pendingBrowser` / `pendingTitles` 并写 tombstone；`ensure` 检查 tombstone，重新打开时清 tombstone + bump generation；`loadOrSeed` / `hydrate` 落地前校验 generation；stale 丢弃时**不** `applyPendingBrowser`；`syncBrowserTabs` 对非 outer 工作区只存 pending 不 `ensure` | v2 未指定 `loading`、`pendingTitles` 的清理，也未处理 `hydrate`（`679-686`）与 `ensure.finally` 的 `applyPendingBrowser` |
| 15 | **M2** Gate 表 | 无来源标注 | Gate 表加「来源」列（外部核查 / 本机实测 / 待实测） | 区分「查文档得到的结论」与「在本仓代码/实机上验证过的结论」 |
| 16 | **M3** | G6（节流）列为 Block | **G6 降为 High** | MVP 不做 throttling（见 #6），G6 只服务完整版定标 |
| 17 | **M4** 命名 | `WorkspaceDeck` / `WorkspaceDockLayer` 混用 | 统一 `WorkspaceDockLayer`；测试文件 `workspace-dock-layer.test.ts` | v2 内部两种命名并存 |
| 18 | **M5** selector | 「收敛 selector」无示例 | 给 `useShallow` selector 示例（订阅 `outer` + 派生 `Array<{id, hasBrowser}>`，含浅比较陷阱说明） | v2 只提出要求，未给可落地写法 |
| 19 | **M6** 三态 | 三态未含 `workspace === undefined` | 三态补 `workspace === undefined` 分支 | `AppShell.tsx:600-603` 的实际判据是 `workspace === undefined \|\| activeWorkspaceId === null` |
| 20 | 引用一致性 | `AppShell` 区域有 `497-610` / `497-609` 两种写法；`openWorkspace` 有 `367-378` / `367-394` | 统一：AppShell 同一区域写 `497-611`；`window.ts` `openWorkspace` 写 `367-394` | 已核实行号 |

### 0.2.1 v3 → v3.1 实质变更

v3.1 在 v3 通过结论的基础上增量修订，**消除 4 个 Block 级缺陷**（① 多窗口「不改 contract 却要占位」的自相矛盾；② `runningSessionIds` 沿 props 链击穿所有层 memo；③ resident 无数量硬上限、xterm WebGL context 触顶；④ E2E harness 全家桶工作量与 CI 可行性均无法在 MVP 交付），其余为简化与事实校正。

| # | 项 | v3 结论 | v3.1 变更 | 原因 |
|---|---|---|---|---|
| **D1** | 多窗口 owner 机制 | MVP 定案 `ownerWindowId` + 非 owner 渲染占位；双窗口 E2E 为 Block（G12/G19） | **整体移出 MVP**：不新增机制，维持既有 bind 语义（新 bind 会 release 旧绑定，`src/main/browser/bindings.ts:139`）；G12/G19 标注完整版；`BrowserView` 删占位分支 | `browser:bind` 的 res 为 `void`（`contract.ts:475`），renderer 无法区分拒绝原因，**占位分支做不出来**；原方案声称「不改 contract」却要求占位，自相矛盾。双窗口 CDP handle 竞争是既有问题，keepalive 不引入不扩大 |
| **D2** | memo / props 稳定性 | `WorkspaceDockLayer` 传 `workspace` 对象与 `runningSessionIds`；`fallbackModel` 用 `useMemo` | props 收敛为 `workspaceId` / `active` / `transient` 及少数原始值；层内经 store selector `s.workspaceTargets[workspaceId]` 按 id 取 workspace；`runningSessionIds` 由 `InnerTabBar.tsx:234` 直接 `useRunIndex` 精确订阅；`fallbackModel` 仍 `useMemo` | `App.tsx:222` 的 `useMemo(() => new Set(runIndex...), [runIndex])` 在任何 run 变化时换新 Set，沿 props 链传入会击穿所有层的 memo |
| **D3** | 反向销毁 Gate | 无 | 新增 **Block G22**：关闭外层 Tab / 关闭最后一个 browser tab 后，旧 `webContents.isDestroyed() === true` 且 `BrowserBindings.pages` entry 已移除 | 保活方案必须证明「该销毁时确实销毁」，否则隐藏层泄漏 |
| **D4** | M1 水合治理 | `forget` 清状态 + tombstone + generation 校验 + `loadOrSeed`/`hydrate` 校验 generation + `syncBrowserTabs` 非 outer 只存 pending | **改为 tombstone 单机制**：保留① `forget` 清 `loading`/`pendingBrowser`/`pendingTitles` 并写 tombstone；② `ensure` 入口查 tombstone 直接 return；③ 重开清 tombstone。**删除 generation**，`loadOrSeed` 落地前改为查 tombstone；**删除**「非 outer 只存 pending 不 ensure」。G21 降 High | `hydrate`（`tabs.ts:679-686`）全仓无生产调用方，给它加 generation 校验是死代码；pending-only 会让 `pendingBrowser` 无界增长 |
| **D5** | resident 数量上限 | 无硬上限，靠 browser tab 过滤 + 全关释放；G15 为 High | 新增**模块级常量硬上限（建议 3）**：成为第 4 个 resident 时，把 seq 最小且非当前可见的旧 resident **移出 stage 渲染集（卸载）**；G15 升 **Block** | 这是「不做 LRU」论证成立的真前提；xterm WebGL context 上限约 16，触顶会静默降级 |
| **D6** | 音频语义 | 失活 `mute`、激活无条件 `unmute` | 失活前读一次 `view.isAudioMuted()` 存模块级 Map（不持久化、无 UI），激活时 `setAudioMuted(map 值)`，无记录默认 `false` | 避免「切回工作区瞬间突然出声」；读的是 Electron 运行时现值，不新增产品状态 |
| **D7** | portal 治理 | 失活返回 `null`（硬卸载）；纳入 7 类 | 语义改为**失活时触发一次正常关闭**（受控组件用 `open && active`，或 effect 里 `if (!active) onOpenChange?.(false)`）；范围收敛为 5 处：`Dialog`/`ContextMenu`/`Select`/`ImageLightbox`/**`Tooltip`（新增）**；`Submenu`/`ProviderModelMenu`/`TurnNavigationRail` 移完整版。G20 判据更新为「浮层被正常关闭、body 无残留、无 keydown 响应」 | 返回 `null` 会与 Radix FocusScope 抢焦点并残留 open 状态；`Tooltip` trigger 大量位于 Dock 子树内，原归为 app 级不纳入是错的 |
| **D8** | 焦点方案 | 模块级 `workspaceFocus.ts`（焦点 Map + 降级工具） | **删除 `workspaceFocus.ts`**；改为 `Composer.tsx:368-370` 挂载聚焦 effect 依赖「本层是否 active」（变 active 时聚焦，失败降级聚焦本层根节点 `tabIndex=-1`），其余复用 `document.contains` 判据；新增实现前置检查单（grep `views` 下约 100 处 mount-time effect） | 模块级焦点 Map 徒增状态与生命周期面；Composer 是唯一真正依赖「挂载即可见」的路径 |
| **D9** | 4.10 拖拽 | 两条规则（取消拖拽 + mutation 校验 active） | 只保留第 1 条（`active` 变 false 取消 dragZone、释放 pointer capture）；**删除第 2 条** | `Dock.tsx:220` 已拒绝跨工作区 drop，第 2 条属 YAGNI |
| **D10** | E2E | harness 全家桶 + 6 用例 + 双窗口驱动 + 资源采样 | **收敛为 1 个 `scripts/e2e-webcontents-stable.mjs`（约 60 行）**，照抄 `scripts/office-editors-probe.mjs:35,120` 的 `_electron.launch` 先例；其余 Gate 走 9.1 手动 + 一次性定标 | harness 全家桶工作量过大、CI 可行性未验证，无法在 MVP 交付 |
| **D11** | 事实基线与结构 | 部分行号/签名/结构图不准确 | 校正 `browser:bind` handler 签名、`browser:changed` 行号、AppShell 订阅描述、闭包状态位置；4.2.2 补 `<StatusBar />`；修正 `isLocalEnvironment` 过滤理由；4.1.4 补 seq 复用与 `useMemo` 说明 | 评审逐条核对真实代码后的修正 |
| **D12** | Gate 表 | G12/G19 Block、G21 Block、G13 High、G15 High、G8 High | G12/G19 移出（完整版）；G21 降 High；G13 升 Block；G15 升 Block；G8 补 `blur()` 缓解说明；G1 判据补 `destroyed` 事件数为 0；新增 G22/G23（Block） | 与 D1/D3/D4/D5 对齐，补齐反向销毁与 transient→resident 的实测门禁 |
| **D13** | 关闭确认 | 仅确认未保存文档 | 关闭**含 browser tab** 的外层 Tab 时，复用既有 `confirmDocumentChanges`（`AppShell.tsx:406-413`）扩展文案「将关闭 N 个浏览器页面，页面运行时不可恢复」 | 关闭会不可逆销毁 N 个页面运行时，必须让用户知情 |
| **D14** | 已知接受项 | 未显式记录 | 6.1 明确：隐藏层聊天流式输出、隐藏终端持续写 xterm buffer 照常发生（`memo` 不挡层内自身订阅），纳入 G11 观测 | 工作区级保活的固有代价，作为将来切方案 B 的数据依据 |
| **D15** | 测试计划 | 计划 `workspace-active.test.ts`、`workspace-focus.test.ts` 等 | 保留 `workspace-dock-layer.test.ts`、`hydration-tombstone.test.ts`（按 D4 缩小）、既有 isolation/navigation 最小增量；删除上述两个测试计划；文件清单同步 | 与 D4/D8 对齐，避免为已删除机制写测试 |
| **B1** | 复审 Block · `workspaceTargets` 字段修正 | 4.2.4 示例代码误用 `WindowState` 上不存在的 `workspaces` 数组字段（照抄编译失败） | 改为 `s.workspaceTargets[props.workspaceId]`（`stores/window.ts:26`，`updateWorkspaces :269` 写入），并注明身份稳定性不变（仅 `workspace:changed` 换引用）；同步 5.3、第 8 节清单 | 字段名错误，照抄编译失败 |
| **B2** | 复审 Block · resident 进入去抖 + 移出措辞 | `MAX_RESIDENT` 降级未接去抖，后台新开 tab 即 3→4 静默销毁保活 guest；「降级为 transient」措辞有歧义 | resident 进入同样套 4.1.5 的 300ms 去抖窗口；措辞改为「移出 stage 渲染集（卸载）」；补「沿用旧 seq、下次优先被移出」 | resident 判定不要求可见，去抖只覆盖了移出、未覆盖计入 |
| **H1** | 复审 High · Dock.tsx `runningSessionIds` 签名清理 | 4.6 称 Dock.tsx「不改」，与 D2 冲突 | 4.6 与第 8 节明确：机械删除 `runningSessionIds` 透传链（签名 8 处），属签名清理、不改语义，是 D2 前置 | 类型检查会强制发现遗漏，不会静默 |

---

## 1. 背景与问题

### 1.1 现象

应用顶部支持多个工作区 Tab。用户从工作区 A 切到工作区 B，再切回 A 时，A 中的内嵌浏览器会重新加载，导致以下瞬时页面状态丢失：

- `sessionStorage`
- 页面 JavaScript 内存中的 token、草稿和 SPA 状态
- 滚动位置
- 未提交表单
- WebSocket/长连接上下文
- 当前历史栈和部分页面内导航状态
- Agent 已绑定的 CDP target

这种现象容易被描述成「登录态或缓存丢失」，但多数情况下不是 Cookie 被清理，而是承载页面的 `<webview>` 被销毁后重新创建。

浏览器使用持久化 session partition，定义位于 `src/shared/domain/browser.ts:68-69`。真正清理该 partition 的 `clearStorageData()` 只出现在用户清理登录态或删除 Profile 的路径中，见 `src/main/browser/session.ts:109-110`（调用点：`src/main/ipc/index.ts:410`、`src/main/ipc/index.ts:433`）。`BrowserManager` 在配置作用域变化时也明确说明不会清 Cookie，见 `src/main/browser/manager.ts:292-306`。

因此，工作区切换时的主要问题是：

> 页面运行时被销毁，而不是持久化 Cookie 被删除。

Cookie 和 localStorage 通常仍在，但依赖当前 renderer 生命周期的 `sessionStorage`、DOM、JS 堆、滚动位置和表单状态会消失。

### 1.2 根因证据链

#### 1. AppShell 同时只渲染一个工作区 Dock

`AppShell` 根据当前 `activeOuter` 和 `activeWorkspaceId`，最终只渲染一个 `<DockRoot>`，见 `src/renderer/src/shell/AppShell.tsx:597-607`：

```tsx
{activeOuter?.kind === "feature" ? (
  <FeatureView feature={activeOuter.ref.feature} />       // 598-599
) : workspace === undefined || activeWorkspaceId === null ? (
  <div className="flex min-h-0 flex-1 items-center justify-center ...">  // 600-603
    {t("app.openWorkspace")}
  </div>
) : (
  <DockRoot workspace={workspace} ... />                  // 604-606
)}
```

切换工作区后，旧工作区的 `DockRoot` 不再出现在 React 树中。

#### 2. 不同工作区拥有不同 Dock root identity

`DockRoot` 从工作区级 tabs store 取得对应 Dock，并以 `root.id` 作为 `DockNodeView` 的 key，见 `src/renderer/src/shell/Dock.tsx:20-37`。

这套 key 对单个工作区内部的 Dock 结构是合理的，不应删除。但当不同工作区轮流占用同一个 React 渲染位置时，不同的 `root.id` 会明确告诉 React：这是另一棵 Dock 子树，需要卸载旧树并挂载新树。

#### 3. `<webview>` 属于 BrowserView 的 DOM 子树

浏览器页面运行时由 `BrowserView` 直接渲染 `<webview>`，见 `src/renderer/src/views/browser/BrowserView.tsx:242-260`。其 `src` 和 partition 分别来自当前 URL 与 `browserPartition(workspace.id, profileId)`，见 `src/renderer/src/views/browser/BrowserView.tsx:251-258`。

当 `BrowserView` 所在的 Dock 子树卸载时，对应 `<webview>` 元素也被移除，Electron guest `webContents` 随之销毁。

主进程绑定层明确监听 guest 的 `destroyed` 和 `render-process-gone`，见 `src/main/browser/bindings.ts:183-188`；失效后会移除绑定并将 BrowserTab 标记为 `error`，见 `src/main/browser/bindings.ts:376-379`。

#### 4. BrowserManager 只保存元数据，不能恢复页面运行时

`BrowserManager` 只持有 `BrowserTab` 元数据，不持有 `BrowserWindow` 或 `webContents`，见 `src/main/browser/manager.ts:87-94`。

页面重建后，`BrowserView` 可以通过 URL、`clientTabId` 和 `browserId` 重新对账，见 `src/renderer/src/views/browser/BrowserView.tsx:66-82`，但这只能重新加载页面，不能恢复已销毁的 DOM、JS 堆和 sessionStorage。

### 1.3 现有可复用机制

同一 DockGroup 内切换内层浏览器 Tab 时，代码已经刻意保留**当前已渲染分支中的**浏览器视图，只通过 opacity 和 pointer-events 切换可见性，见 `src/renderer/src/shell/Dock.tsx:291-315`。

其中注释已经说明原因：销毁 guest 会断开 Agent 的 CDP target，见 `src/renderer/src/shell/Dock.tsx:307-311`。

> ★ 精确表述：该模式**不等于**「所有浏览器视图都被保留」。当 edge 被判 `absent` 时对应分支不渲染（`src/renderer/src/shell/Dock.tsx:62-65`、`src/renderer/src/shell/Dock.tsx:131-149`）。v1 的「保留所有浏览器视图」表述过强，v3 沿用 v2 的精确描述。

本方案复用同一视觉保活原则，但把边界限定为：

> 含 browser tab 的本地已水合工作区，在失活后保留其 workbench；活动工作区无论是否有 browser tab 都照常渲染（只是切走即卸载）。

---

## 2. 目标与非目标

### 2.1 目标

1. 切换顶部工作区 Tab 时，不卸载**含 browser tab 的本地工作区**的 workbench。
2. 保留这些工作区中当前挂载的浏览器 guest 及其 `<webview>` DOM 节点。
3. 保持 `<webview>` 的 `webContentsId` 不变。
4. 保持 `BrowserBindings.pages` 中的 CDP handle 不变，避免 Agent 在切工作区后重新等待绑定。
5. **活动工作区（含无 browser tab、含远程）照常渲染**，不引入功能回归。
6. 复用现有 `outer`、`tabs.byWorkspace`、per-workspace panel state，不增加第二份工作区生命周期状态。
7. 不修改 Dock split / 拖拽 / 主进程浏览器绑定机制的**语义**。
8. 将改动集中在 `AppShell`、一个模块级 `WorkspaceDockLayer`、一个模块级 `WorkspaceActiveContext`、一条全局 CSS 规则、以及 store 的关闭/水合竞态治理上。

### 2.2 非目标

MVP 明确不包含：

- 不含 browser tab 的工作区在**失活后**继续常驻（终端/聊天/文件树不因本方案无界常驻）。
- LRU 或基于内存压力的自动驱逐。
- 主进程 `WebContentsView` 迁移（方案 C）。
- 页面状态序列化、销毁后重建。
- 修复浏览器 Tab 跨 DockGroup 移动时可能重建 guest 的既有问题。
- 让未完成连接准备的 SSH/远程工作区在后台常驻。
- 修改 BrowserManager 的元数据模型或 CDP 工具协议。
- **记住用户静音偏好**（v3 移除，见 4.8.3）。
- **`setBackgroundThrottling` 干预**（v3 明确 MVP 不做，见 4.8.4）。
- 跨窗口共享同一个 IAB guest（见 2.3.1）。

### 2.3 MVP 前置约束（阻断级）

以下三项**不是**「非目标」，而是 MVP 必须解决的前置约束。未解决前不得合入。

#### 2.3.1 多窗口 BrowserTab / IAB guest 所有权（v3.1 移出 MVP）

- 所有主窗口注册为同一种 `main` kind（`src/main/index.ts:421`），bootstrap 按 `windowKind` 读取同一份 outer 状态（`src/main/ipc/app.ts:78-85`）；多主窗共享 main 的 outer/tabs（`src/main/state/store.ts:630` `outerTabKey(windowKind)` 按 kind 分库）。
- BrowserManager 变更广播到所有窗口（`src/main/ipc/index.ts:943`），每个 renderer 都执行 `syncBrowserTabs()`（`src/renderer/src/App.tsx:89-93`）。
- `BrowserBindings` 对同一 BrowserTab 只保留一个绑定，新 bind 会 `release()` 旧绑定（`src/main/browser/bindings.ts:133-140`）。

**v3.1 决策：多窗口在 MVP 中不新增机制**（`ownerWindowId` 整体移出 MVP，见 10.2 完整版）。

- MVP 维持既有 bind 语义：新 `bind` 会 `release()` 旧绑定（`src/main/browser/bindings.ts:139`）。双窗口打开同一工作区时的 CDP handle 竞争是**既有问题**，keepalive 不引入、不扩大（详见 6.2）。
- 多窗口下 resident 基于**本窗口 outer 快照**推导，不要求跨窗口一致——主进程**无 outer 变更广播**，本就没有跨窗口一致性的基础。
- renderer 侧 `windowId` 的「零使用」表述保留：不新增 windowId 下发链路，也不需要。
- **移出理由（原方案自相矛盾）**：v3 声称「不改 contract」，却又要求「非 owner 渲染占位」；但 `browser:bind` 的 res 为 `void`（`src/shared/ipc/contract.ts:475`），renderer 无法区分 bind 被拒的原因，占位分支**做不出来**。因此 owner 机制无法以「不改契约」的方式落地，整体移入完整版。

#### 2.3.2 workspace-owned overlay / portal 生命周期

workspace 内发起的 portal 浮层必须在所属工作区失活时停止渲染（v3 用 `WorkspaceActiveContext` 实现，见 4.7）。`document` / `window` 级监听必须校验所属工作区当前 active。

#### 2.3.3 Electron 行为 Gate

第 9.3 节 Gate 清单中标记为 **阻断（Block）** 的项全部通过。

---

## 3. 方案总览

一句话定义：

> 每个「外层 Tab 仍打开、内层 tabs 已水合、本地环境、且存在 browser tab」的工作区拥有一个**常驻** workbench 层；当前活动工作区无论是否满足该条件都拥有一个**瞬时**层；切换工作区只改变层的可见性、交互性与媒体状态，不改变其 React 挂载身份。

工作区 workbench 层的生命周期边界为：

- **resident**：外层工作区 Tab 打开、内层状态完成水合、本地环境、**且有 browser tab** → 常驻；失活后保留挂载。
- **transient**：当前活动工作区（不满足 resident 条件时，含「活动但无 browser tab」与远程活动工作区）→ 渲染但**切走即卸载**（与现状一致）。
- 工作区切换：改变 `active`（可见性 + 交互性 + 媒体 + 焦点），不卸载 resident 层。
- 打开功能页（feature / standalone）：workbench 保持挂载，功能页覆盖其上；**外层 Tab 条保持可见可交互**。
- browser tab 全部关闭：经去抖后移出 resident 集合并卸载。
- 关闭外层工作区 Tab：移出 resident 集合、卸载、并使在途水合失效。
- 应用退出：随 renderer 和主进程 browser bindings 一并释放。

方案 B 是「仅将 `<webview>` 抽到 renderer 全局池中」，适用于：完整 Dock 常驻被证明存在明显额外开销，或需要顺带解决浏览器 Tab 跨 DockGroup 移动重建的问题。

方案 C 是「主进程持有 `WebContentsView`」，仅在产品明确要求页面跨 renderer 重载继续存活、Agent 完全脱离 UI 后台运行时考虑。它涉及原生 View 覆盖、坐标同步和多窗口所有权，不属于 MVP。

---

## 4. 详细设计

### 4.1 stage 渲染集如何推导

#### 4.1.1 权威状态

外层工作区 Tab 和当前活动项来自 `WindowState`：

- `outer`：`src/renderer/src/stores/window.ts:36`
- `activeOuterId`：`src/renderer/src/stores/window.ts:37`
- `activeWorkspaceId`：`src/renderer/src/stores/window.ts:39`
- `activeStandaloneFeature`：`src/renderer/src/stores/window.ts:46`
- `workspaceTargets`：`src/renderer/src/stores/window.ts:27`

外层 workspace tab 的类型定义位于 `src/shared/domain/tab.ts:12-14`。

已完成内层 Tab 水合的工作区由 `tabs.byWorkspace` 表示，字段定义见 `src/renderer/src/stores/tabs.ts:173`，初始值见 `src/renderer/src/stores/tabs.ts:525`。

水合完成时，`loadOrSeed()` 将状态写入 `byWorkspace`，见 `src/renderer/src/stores/tabs.ts:497-522`。当前活动工作区通过 `ensureTabs(activeWorkspaceId)` 触发水合，见 `src/renderer/src/shell/AppShell.tsx:269-273`。

#### 4.1.2 resident 精确定义

```text
residentWorkspaceIds =
    outer 中 kind === "workspace" 的 workspaceId
  ∩ tabs.byWorkspace 中已存在的 workspaceId
  ∩ 本地环境工作区
  ∩ 该工作区仍存在 kind === 'browser' 的内层 Tab
```

结构示意（不要求逐字实现）：

```ts
const residentWorkspaces = dedupeByWorkspaceId(
  outer
    .filter((tab) => tab.kind === 'workspace')
    .map((tab) => workspaces.find((w) => w.id === tab.ref.workspaceId))
    .filter((w): w is Workspace => w !== undefined)
    .filter((w) => tabs.byWorkspace[w.id] !== undefined)
    .filter((w) => isLocalEnvironment(w.environment))
    .filter((w) => hasBrowserTab(tabs.byWorkspace[w.id]))
)
```

`dedupeByWorkspaceId` **必须存在**：`openWorkspace()` 正常路径保证一个工作区只有一个 outer Tab（`src/renderer/src/stores/window.ts:367-394`），但 `hydrate()` 不去重损坏或旧数据（`src/renderer/src/stores/window.ts:308-333`）。重复 workspaceId 会产生重复 `key={workspace.id}`。

**`isLocalEnvironment` 过滤的真实目的（v3.1 校正）：** `BrowserView.tsx:46` 对非本地环境**直接 return 提示文案、不创建 webview**，所以过滤不是为了「防 webview」，而是避免**远程工作区的聊天/终端/文件树**在后台常驻。远程工作区仍按 transient 在活动时渲染（4.1.6）。

本地环境判定函数位于 `src/shared/domain/environment.ts:140-142`。

**resident 数量硬上限（v3.1 · D5，MVP 新增）：**

- 模块级常量 `MAX_RESIDENT = 3`（**常量，非配置**；不引入设置项），只约束 **resident 层数**；append-only 顺序表规模随 stage 成员（含 transient）增长，由未决问题 19 单独跟踪（v3.1 · M1）。
- **resident 进入也套 4.1.5 的去抖窗口（v3.1 · B2）**：某工作区需在 `residentExitDebounceMs`（300ms）内**稳定持有** browser tab，才计入 resident 并参与 `MAX_RESIDENT` 降级判定；去抖窗口内的层保持挂载（沿用 4.1.5 规则 3）。
  - 原因：resident 判定不要求可见，Agent 在后台工作区开一个 browser tab（`syncBrowserTabs` push，`tabs.ts:1147-1159`）就会 3→4 触发降级，静默销毁用户正在保活的 guest。4.1.5 的去抖只覆盖 `hasBrowser` 变 false 的移出，不覆盖新成员计入 resident，必须补上。
- 当某工作区稳定成为第 4 个 resident 时，把**当前 seq 最小、且非当前可见**的旧 resident **移出 stage 渲染集（卸载）**，再纳入新 resident。选择「最旧且不可见」是廉价且确定的规则，不引入 LRU 评分。
  - 措辞澄清：不写「降级为 transient」——transient 的定义是「仅因当前活动而渲染」，被移出者本就非可见，两者不等价。
- 硬上限是 7.1「不做 LRU」论证成立的**真前提**：没有硬上限，无界常驻 + 不做 LRU 就是无上限内存增长。
- 被移出的工作区会卸载其 guest（`webContents` 销毁），这是已知代价；**沿用旧 seq**（4.1.4 规则 3），重新成为 resident 后 seq 最小、下次优先被移出，属可接受的既有简化，无需 bump。
- 该上限同时服务 G15（xterm WebGL context 上限约 16，触顶会静默降级 → 升为 Block）。

#### 4.1.3 stage 渲染集（v3 · B1，阻断）

```text
stageLayers = dedupeByWorkspaceId(resident ∪ transient)
transient   = { 当前 visible 判据成立的工作区 } \ resident
```

**硬性规则：**

1. **活动但无 browser tab 的工作区也照常渲染。** 这是 v2 的功能缺口：v2 只渲染 resident，会让「打开工作区 → 还没开浏览器 → 切走 → 切回」以及「活动工作区无 browser tab」两种情况下层根本不存在。v3 用 `transient` 补齐。
2. `transient` 层的语义是**切走即卸载**（与现状一致），仅在其 `visible` 为真时存在于 stage。
3. `resident` 与 `transient` 用**同一个 `key={workspace.id}`**。同一工作区在 transient ↔ resident 之间转换（例如活动工作区里新开了 browser tab）时，React 复用同一实例，不重挂载、不重建 guest。
4. `transient` 只影响 `data-workspace-transient` 标记与测试判据，**不参与样式/隔离/mute 判定**——后者一律由 `visible` 决定。
5. 远程活动工作区同样进入 `transient`（不进入 resident），并使用完整 `visible` 判据（见 4.1.5）。

#### 4.1.4 DOM 顺序固定：append-only（v3 · H2，阻断）

**resident 层的 DOM 顺序不得跟随 outer Tab 顺序，也不得按 `workspace.id` 排序。**

- outer 可 `move()`、`togglePin()` 后重排（`src/renderer/src/stores/window.ts:466-479`）。
- 按 `workspace.id` 排序时，新成员可能排到既有成员之前，React 会 `insertBefore` **移动**既有含 `<webview>` 的祖先节点。
- React 移动 DOM 会物理移动节点；含 `<webview>` 的祖先被移动时，Electron **无官方契约**保证 guest 不 detach。一旦 detach 就会走 `src/main/browser/bindings.ts:183-188` → `src/main/browser/bindings.ts:376-379`，直接摧毁本方案目标。

**规则（append-only 插入顺序）：**

1. 维护一个 `Map<workspaceId, seq>`：工作区**首次**进入 stage 渲染集时分配递增 `seq`；已在 map 中则复用原 `seq`（幂等，不因 StrictMode 双调用而抖动）。
2. 渲染顺序按 `seq` **升序**。这样新增成员只会 `appendChild`，**既有成员的祖先永不发生 `insertBefore` 移动**。
3. **成员移除不重排幸存者**（`seq` 保留，不压缩、不重编号）。
4. 该 map 只参与渲染顺序数组的构造，**不参与 React key**（key 固定为 `workspace.id`），也不作为订阅源触发额外 render（惰性分配、幂等写入）。
5. 每个 `WorkspaceDockLayer` 监听自身 guest 的 `destroyed`，一旦发生则记录并触发自愈/降级日志（不静默）。
6. 单脚本 E2E 覆盖 reorder / pin / unpin / 新开 browser tab 触发 transient→resident（见 9.4）。

> v2 的「按 `workspace.id` 排序」**删除**。v1 的「顺序遵循 outer」同样**删除**。

**实现形态建议**（模块级惰性分配，**并入** `src/renderer/src/shell/WorkspaceDockLayer.tsx`，不单独建 `layerOrder.ts`）：

```ts
// ponytail: 顺序表常驻内存，仅随工作区首次进入 stage 增长；
// 若未来需要彻底遗忘，可在 tombstone 清除时同步 delete seq。
const seqOf = new Map<string, number>()
let nextSeq = 0
function orderOf(ids: readonly string[]): string[] {
  for (const id of ids) if (!seqOf.has(id)) seqOf.set(id, nextSeq++)
  return [...ids].sort((a, b) => seqOf.get(a)! - seqOf.get(b)!)
}
```

- **seq 复用是安全的**：关闭后重开同一工作区沿用旧 `seq`。重开时该工作区是**全新挂载的节点**，只会以新节点 `append`/`insertBefore` 落地，**不会移动任何既有含 `<webview>` 的祖先**——这正是本规则要保护的不变量。
- **`orderOf` 的 map 写入必须放在 `useMemo` 内**：render 期副作用在并发渲染下可能被丢弃（React 可重放或放弃 render），把顺序表的惰性写入散落在 render 顶层会引入不确定性；放进 `useMemo` 并注明原因。

#### 4.1.5 移出去抖 / 连续判定（v3 · H2，阻断）

`browser:changed` 经 `emitToAll` 广播到所有窗口（`src/main/ipc/index.ts:941-945`），一次 UI 操作可分多批到达；`syncBrowserTabs()` 的 prune 依赖批次内的 `remoteIds`（`src/renderer/src/stores/tabs.ts:1100`、prune `1162-1168`）。因此「关闭最后一个 browser tab」可能在批次间表现为 `hasBrowser: true → false → true → false` 的抖动，直接移出会导致层被卸载又重建，guest 销毁——正是本方案要避免的。

**规则：**

1. 移出判定使用**去抖**：观测到 `hasBrowser === false` 后启动一个短延迟窗口，窗口内若该工作区重新出现 browser tab 则取消移出。
   - 建议初值 `residentExitDebounceMs = 300`（待 G2/G11 实测调整；取值上限应在一次 `browser:changed` 广播批次 + 一次 UI 帧之内）。
2. 备选（可与去抖并用）：**连续判定** —— 连续两次（或连续 N ms 内）观测到无 browser tab 才移出。
3. 去抖期间该层**保持挂载**（仍在 stage 渲染集内，`transient`/`resident` 标记不重要，重要的是不卸载）。
4. 去抖计时器必须随 `WorkspaceDockLayer` 卸载而清理（避免定时器泄漏导致状态错乱）。

#### 4.1.6 远程 / 需要连接准备的工作区处理

`WindowStore` 内部的 `needsPrepare()` 将「不存在或非本地」的工作区视为需要连接准备，见 `src/renderer/src/stores/window.ts:215-218`。该函数是 store 内部闭包，不能从 `AppShell` 直接调用。

MVP 不复制 `needsPrepare()` 的连接状态机，只使用同一基础条件 `isLocalEnvironment()` 排除远程工作区的**后台常驻**。远程工作区仍在其处于活动状态时按 `transient` 渲染（4.1.3），不加入 resident。

**远程层必须使用完整 visible 判据**（v2 遗留修正）：激活 feature 时 `activeWorkspaceId` 故意保留原工作区（`src/renderer/src/stores/window.ts:341-356`），无条件 `active` 会让远程层被误判可交互，只是被 feature 的 z-index 覆盖。

```ts
const visible =
  activeStandaloneFeature === null &&
  activeOuter?.kind === 'workspace' &&
  activeOuter.ref.workspaceId === workspace.id &&
  activeWorkspaceId === workspace.id
```

是否让远程工作区长期持有连接租约并进入 resident 集合属于后续连接生命周期设计，**待确认**。

#### 4.1.7 不单独维护 resident Set

MVP 不新增 `residentWorkspaceIds` Zustand 字段，resident 必须每次由 `outer`、`tabs.byWorkspace`、工作区环境、browser tab 存在性直接推导。

唯一的跨 render 记忆是 4.1.4 的 `seq` map（只影响顺序）与 4.1.5 的去抖计时器（只影响移出时机），二者都不构成第二份工作区生命周期状态。

> ★ 纯推导能阻止**渲染**幽灵层，但**不能**阻止关闭后状态复活。必须配合 4.5.4 的 hydration tombstone。

#### 4.1.8 水合三态（v3 · M6 补全 `workspace === undefined`）

不得用 `stageLayers.length === 0` 推导 EmptyState。判定顺序：

| 序 | 状态 | 判据 | 渲染 |
|---|---|---|---|
| 1 | 无活动工作区 | `activeWorkspaceId === null` **或** `workspace === undefined` | `t("app.openWorkspace")` 空态 |
| 2 | 水合中 | 非 (1)，且 `byWorkspace[id] === undefined` | 骨架/占位（**不**渲染空态文案） |
| 3 | 已水合 | 非 (1)，且 `byWorkspace[id] !== undefined` | 对应 layer |

`workspace === undefined` 分支对应 `AppShell.tsx:600-603` 的真实判据（`workspace === undefined || activeWorkspaceId === null`）：outer 指向的工作区记录已被删除时，活动 id 仍非空，必须走空态而不是骨架。

`ensureTabs()` 是 effect 后异步执行（`AppShell.tsx:269-273`），首帧 resident 必然为空。

---

### 4.2 AppShell 渲染结构改造

#### 4.2.1 当前结构

见 `src/renderer/src/shell/AppShell.tsx:497-611`：

- `498-505`：`activeStandaloneFeature !== null` 时**直接替换整块**（含 browser/extensions/scheduled/git 的 standalone 分支）。
- `506-609`：else 基础 shell，其中 `515-591` 是外层 Tab 条（带 `app-drag`），`597-607` 是 content 区。
- `610`：`<ConnectionDialogs>` 在 `<main>` 内、else 块之后；它本身不包 `shrink-0`，但其内部状态条 div 自身是 `shrink-0`（`ConnectionDialogs.tsx:37-50`）。

不同工作区轮流占用同一 `<DockRoot>` 位置（`604-606`），因此旧工作区子树被卸载。

#### 4.2.2 目标结构（stage 叠层）

```tsx
<main data-theme-region="canvas" className="app-canvas flex min-w-0 flex-1 flex-col overflow-hidden rounded-panel bg-canvas">
  {/* ★ stage：唯一被绝对定位叠层的区域 */}
  <div className="relative min-h-0 min-w-0 flex-1">
    {/* 基础 shell：外层 Tab 条 + content 叠层 */}
    <div
      data-theme-region="base-shell"
      data-base-active={baseShellActive ? 'true' : 'false'}
      aria-hidden={baseShellActive ? undefined : true}
      inert={!baseShellActive}
      className={cn(
        'absolute inset-0 flex min-h-0 min-w-0 flex-col',
        baseShellActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
      )}
    >
      <OuterTabBar ... />              {/* 515-591 原结构，含 app-drag */}
      <div
        data-theme-region="content"
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {stageLayers.map((layer) => (
          <WorkspaceDockLayer
            key={layer.id}
            workspaceId={layer.id}
            active={visible(layer.id)}
            transient={layer.transient}
          />
        ))}
        {activeOuter?.kind === 'feature' && (
          <div className="absolute inset-0 z-20 flex min-h-0 min-w-0">
            <FeatureView feature={activeOuter.ref.feature} />
          </div>
        )}
        {showEmptyState && <div className="absolute inset-0 z-20 ...">...</div>}
      </div>
    </div>

    {/* standalone feature：覆盖整个 stage */}
    {activeStandaloneFeature !== null && (
      <div className="absolute inset-0 z-30 flex min-h-0 min-w-0">
        <StandaloneFeature ... />
      </div>
    )}
  </div>

  {/* ★ 保持正常流，不在叠层内 */}
  <ConnectionDialogs workspace={workspace} />
</main>

{/* ★ 在 <main> 之外（AppShell.tsx:618），不受 stage 叠层影响 */}
<StatusBar />
```

要点：

1. `<main>` **保持** `flex min-h-0 flex-1 flex-col`，不被改成 absolute 容器。
2. 新增一个 `relative min-h-0 min-w-0 flex-1` 的 **stage**，只有 stage 内部做 absolute 叠层。
3. `ConnectionDialogs` 保持在 stage **之外**的正常流（`AppShell.tsx:610` 的当前位置语义），从而保住其状态条布局与 inert 豁免。
4. `<StatusBar />` 位于 `<main>` **之外**（`AppShell.tsx:618`），本身不受 stage 叠层影响；结构图补出它是为了避免误以为它也需要进 stage。
5. standalone feature 覆盖 stage（含外层 Tab 条），与当前 `498-505`「整块主内容被替换」的语义一致；其容器必须是 `flex min-h-0 min-w-0`，以匹配 `FeatureFrame.tsx:71` 的 `flex min-h-0 flex-1 flex-col` 根。

#### 4.2.3 两个 active 判据（v3 · H4，阻断）

已核实的 `baseActive` 表达式为 `activeStandaloneFeature === null && activeOuter?.kind === 'workspace' && activeWorkspaceId !== null`。该式在 `activeOuter.kind === 'feature'`（feature 外层 tab 激活）时为 **false**，但此时**外层 Tab 条必须仍然可见可交互**（否则用户无法从 feature 页切回工作区）。因此 v3 拆成两个判据：

| 判据 | 表达式 | 作用对象 |
|---|---|---|
| `baseShellActive` | `activeStandaloneFeature === null` | 基础 shell **容器**的 `inert` / `aria-hidden` / `opacity` / `pointer-events`（含外层 Tab 条） |
| `baseActive` | `baseShellActive && activeOuter?.kind === 'workspace' && activeWorkspaceId !== null` | 「基础 shell 中存在可见工作区层」的判据，用于空态层与 feature 覆盖层的互斥判断 |

二者差集仅出现在 `activeOuter.kind === 'feature'`：此时 `baseShellActive === true`（Tab 条可交互）、`baseActive === false`（无工作区层 visible），content 区按 `598-599` 语义渲染 `FeatureView`。

**规则：**

1. 容器一律用 `baseShellActive`，**不得**直接用 `baseActive`——否则 feature tab 激活时整个 Tab 条被 inert（regression，Gate **G17**）。
2. feature 外层 tab 激活时：外层 Tab 条**保持可见且可交互**；`app-drag` 行为与现状一致（`theme.css:502-507`，`-webkit-app-region` 可继承）。
3. 工作区层的 `active` 一律用 4.1.6 的完整 `visible` 判据，`transient` 与 `resident` 层一视同仁。
4. 回归 Gate **G17** 必须覆盖：feature tab 激活 → 点击外层工作区 Tab 能正常切回。

#### 4.2.4 WorkspaceDockLayer（必须模块级，命名统一）

```tsx
// src/renderer/src/shell/WorkspaceDockLayer.tsx
export const WorkspaceDockLayer = memo(function WorkspaceDockLayer(props: {
  workspaceId: string
  active: boolean
  transient?: boolean
  fallbackModel: FallbackModel   // 由 AppShell useMemo 稳定引用
  maxOutputTokens: number
}): ReactNode {
  // ★ 层内按 id 取 workspace：identity 天然稳定，不把 workspace 对象当 props 传。
  // workspaceTargets 是 Record<string, Workspace>（stores/window.ts:26，updateWorkspaces :269 写入），
  // 只在 workspace:changed 时换引用，因此 selector 结果引用稳定。
  const workspace = useWindowStore((s) => s.workspaceTargets[props.workspaceId])
  const rightOpen = useWindowStore((s) =>
    s.activeWorkspaceId === props.workspaceId
      ? s.rightPanelOpen
      : s.rightPanelOpenByWorkspace[props.workspaceId] ?? false
  )
  const bottomOpen = useWindowStore((s) =>
    s.activeWorkspaceId === props.workspaceId
      ? s.bottomPanelOpen
      : s.bottomPanelOpenByWorkspace[props.workspaceId] ?? false
  )
  const right = usePresence(rightOpen, PANEL_MS)
  const bottom = usePresence(bottomOpen, PANEL_MS)

  // ★ H5/B2：Provider 挂在 layer 根，跨 createPortal 生效
  const activeCtx = useMemo(
    () => ({ workspaceId: props.workspaceId, active: props.active }),
    [props.workspaceId, props.active]
  )

  if (workspace === undefined) return null // outer 已移除：由 stage 渲染集保证不出现，兜底

  return (
    <WorkspaceActiveContext.Provider value={activeCtx}>
      <div
        data-workspace-layer-id={props.workspaceId}
        data-workspace-active={props.active ? 'true' : 'false'}
        data-workspace-transient={props.transient ? 'true' : 'false'}
        aria-hidden={props.active ? undefined : true}
        inert={!props.active}
        className={cn(
          'absolute inset-0 flex min-h-0 min-w-0',
          props.active ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
        )}
      >
        <DockRoot
          workspace={workspace}
          right={right}
          bottom={bottom}
          fallbackModel={props.fallbackModel}
          maxOutputTokens={props.maxOutputTokens}
        />
      </div>
    </WorkspaceActiveContext.Provider>
  )
})
```

**硬性规则：**

- **必须定义在模块级**（独立文件，或至少 `AppShell.tsx` 的模块作用域）。定义在 `AppShell` 函数体内时，父级每次 render 都会得到新的组件类型，React 会重挂载整棵子树 —— 这与保活目标直接冲突。
- 必须 `React.memo`（见 5.3）。
- **props 只接受原始值**：`workspaceId` / `active` / `transient` + 稳定的 `fallbackModel` / `maxOutputTokens`。**不传 `workspace` 对象**——层内经 store selector `s.workspaceTargets[workspaceId]` 按 id 取（`stores/window.ts:26`），identity 天然稳定（D2）。
- **`runningSessionIds` 不沿 props 链传入**：由实际消费组件 `InnerTabBar.tsx:234` 直接 `useRunIndex` 精确订阅（D2）。原因见 5.3：`App.tsx:222` 的 `useMemo(() => new Set(runIndex...), [runIndex])` 在任何 run 变化时都换新 Set，沿 props 传入会击穿所有层的 memo。
- `fallbackModel` 在 AppShell 用 `useMemo` 稳定引用（5.3 第 5 条）。
- 命名统一为 `WorkspaceDockLayer`（v2 的 `WorkspaceDeck` 废弃）。
- `inert` 只作为 **embedder 侧**兜底，**不是** webview 隔离手段（见 4.8）。
- `data-workspace-active` 是 CSS 隔离规则与 E2E 的唯一定位钩子（见 4.8.2）。

#### 4.2.5 隐藏方式

推荐隐藏组合：

```text
absolute inset-0
opacity-0
pointer-events-none
inert            （仅 embedder 侧兜底：Tab 顺序、embedder 焦点、文本选择）
aria-hidden=true （仅 embedder 侧兜底，不覆盖 guest 无障碍树）
z-index 低于活动层
```

不应使用：

```text
条件渲染移除
display:none
width:0 / height:0
```

原因：

1. `display:none` 会让整个 workbench 不参与布局，guest 的宿主尺寸可能变成零。
2. `BrowserBindings` 的 viewport 来自页面 `innerWidth/innerHeight`，见 `src/main/browser/bindings.ts:148-151`。
3. Agent 截图直接调用 `contents.capturePage()` 并同时读取 viewport，见 `src/main/browser/bindings.ts:162-170`。
4. `absolute inset-0` 可以继续拥有与内容区一致的尺寸。

> ★ v1 称 opacity 是「已验证模式」过强。代码里确实已有该实现（`Dock.tsx:291-315`），但**整工作区级**的 OOPIF、焦点、截图、节流行为尚未在本仓库验证。见 9.3 Gate。

---

### 4.3 每工作区独立的 right/bottom 面板 Presence

#### 4.3.1 当前问题

当前 `rightEdge` 和 `bottomEdge` 在 `AppShell` 顶层，只服务于单个活动工作区，见 `src/renderer/src/shell/AppShell.tsx:214-216`。

`rightPanelOpen` / `bottomPanelOpen` 只是活动工作区状态的投影；真正的工作区级状态位于 `rightPanelOpenByWorkspace` 与 `bottomPanelOpenByWorkspace`，见 `src/renderer/src/stores/window.ts:55-60`。

切换工作区时，活动投影会从目标工作区的 map 中恢复，见 `src/renderer/src/stores/window.ts:341-364`。

#### 4.3.2 必须下移 Presence

每个 `WorkspaceDockLayer` 必须独立调用 `usePresence`。`usePresence` 内部包含每个视图独立的 `mounted`、`shown`、`animating` 状态，见 `src/renderer/src/lib/usePresence.ts:22-36`，并在收起后延迟将 `mounted` 设为 false，见 `src/renderer/src/lib/usePresence.ts:73-78`。这些状态不能在所有工作区之间共享。

#### 4.3.3 不独立时的后果

`DockRoot` 先构建完整结构树，再依据 edge Presence 判断子树是 live、ghost 还是 absent，见 `src/renderer/src/shell/Dock.tsx:20-37` 与 `src/renderer/src/shell/Dock.tsx:60-69`。当 `edgeHidden(..., mounted)` 为真时，对应分支进入 `absent`，`absent` 分支不渲染，见 `src/renderer/src/shell/Dock.tsx:131-149`。边缘可见性最终由 `visibleDockNode()` 过滤，见 `src/renderer/src/shell/dock-layout.ts:17-29`。

如果隐藏工作区错误地使用当前活动工作区的 Presence，切换工作区可能把隐藏工作区的右侧或底部浏览器分支判为 `absent`，从而仍然卸载 `<webview>`。

> ★ 边界澄清：per-workspace Presence 只保证**工作区切换**不误判。用户在该工作区**真实关闭** right/bottom 面板时，对应分支仍会在退场动画结束后进入 `absent` 并卸载 —— 这是既有且正确的行为，本方案不改变。

#### 4.3.4 状态选择规则

```ts
const rightOpen =
  state.activeWorkspaceId === workspace.id
    ? state.rightPanelOpen
    : state.rightPanelOpenByWorkspace[workspace.id] ?? false
```

底部同理。兼容所有现有写入路径：

- 当前工作区按钮切换：`src/renderer/src/stores/window.ts:486-500`
- 后台工作区定向设置：`src/renderer/src/stores/window.ts:502-510`
- 底部面板对应逻辑：`src/renderer/src/stores/window.ts:513-537`

---

### 4.4 与 standalone feature 的互斥/覆盖

#### 4.4.1 当前行为

`browser`、`extensions`、`scheduled`、`git` 不创建外层 Tab，而是设置 `activeStandaloneFeature`，见 `src/renderer/src/stores/window.ts:396-407`；关闭时恢复为 null，见 `src/renderer/src/stores/window.ts:420-422`。

现有 store 测试确认：

- 打开浏览器管理页不改变 `outer`、`activeOuterId`、`activeWorkspaceId`，见 `src/renderer/src/stores/__tests__/browser-navigation.test.ts:56-72`。
- 关闭后回到原工作区，见 `src/renderer/src/stores/__tests__/browser-navigation.test.ts:74-91`。
- 切工作区会退出 standalone 模式并恢复目标面板状态，见 `src/renderer/src/stores/__tests__/browser-navigation.test.ts:93-110`。

但当前 `AppShell` 使用互斥条件渲染：standalone feature 激活时（`498-505`），包含外层 Tab 条和 Dock 的基础 shell 整体被卸载。

#### 4.4.2 MVP 决策

**standalone feature 纳入 MVP。** 否则「常驻 workbench」仍可被侧边栏功能入口卸载，目标直接落空。

#### 4.4.3 目标结构

见 4.2.2 的 stage 结构。四条硬性约束：

1. **`ConnectionDialogs` 必须在 stage 之外、正常流内**，且不在基础 shell 的 `inert` 容器内。它返回的连接状态条是普通流元素且自身 `shrink-0`（`src/renderer/src/shell/ConnectionDialogs.tsx:37-50`），进入 absolute 叠层会被覆盖或挤错；进入 inert 会禁用「重连」「取消」按钮。
2. **standalone feature 根依赖 flex 尺寸**：`FeatureFrame` 根是 `flex min-h-0 flex-1 flex-col`（`src/renderer/src/shell/FeatureFrame.tsx:71`）。因此 standalone 容器必须是 `absolute inset-0 flex min-h-0 min-w-0`，让 feature 根能正确拿到 `flex-1`。
3. **基础 shell 隐藏时其 `app-drag` 区域必须失效**：外层 Tab 条带 `app-drag`（`AppShell.tsx:515-591`）。`inert` 不保证原生拖动区失效，必须在 Gate 中实测（G7），必要时给隐藏的基础 shell 叠加 `app-no-drag`（`theme.css:502-507`）或 `pointer-events-none`（后者已包含）。注意 `-webkit-app-region` 可继承，叠加位置需实测确认。
4. **feature 外层 tab 激活时 Tab 条保持可交互**（4.2.3，G17）。

#### 4.4.4 焦点交接

standalone 打开/关闭必须走 4.9 的 active 焦点生命周期：打开时焦点进入 feature 页；关闭时归还给目标工作区 layer 的最后焦点目标。

---

### 4.5 生命周期

#### 4.5.1 加入 stage 渲染集

- **resident**：本地工作区同时满足「outer 中存在对应 `kind: 'workspace'` Tab」+「`tabs.byWorkspace[workspaceId]` 已存在」+「`isLocalEnvironment`」+「存在 `kind === 'browser'` 的内层 Tab」后自动加入。
- **transient**：当前 `visible` 判据成立且不在 resident 内的工作区自动加入（含「活动但无 browser tab」与远程活动工作区）。

打开工作区时，`openWorkspace()` 会创建或激活外层 Tab，见 `src/renderer/src/stores/window.ts:367-394`。活动工作区随后由 `AppShell` 的 effect 调用 `ensureTabs()`，见 `src/renderer/src/shell/AppShell.tsx:269-273`。水合完成后 `loadOrSeed()` 写入 `byWorkspace`，见 `src/renderer/src/stores/tabs.ts:497-522`。

不需要额外的「加入 resident」action。

#### 4.5.2 切换工作区

`activate()` 更新 `activeOuterId`、`activeWorkspaceId` 和活动工作区的 right/bottom 投影，见 `src/renderer/src/stores/window.ts:341-365`。

resident 集合不因 active 变化而删除成员。React 继续保留各层的 `key={workspace.id}`。切换时必须同时执行：

1. **可见性/交互性**：`opacity`、`pointer-events`、`inert`、`z-index`（4.2.4）。
2. **webview 级隔离**：由 `theme.css` 的 `[data-workspace-active='false'] webview` 规则自动生效，无需 JS 参与（4.8）。
3. **媒体**：隐藏层所有 guest `setAudioMuted(true)`；激活层 `setAudioMuted(失活前读到的值)`，无记录默认 `false`（4.8.3）。
4. **节流**：MVP 不做（4.8.4）。
5. **overlay**：workspace-owned 受控浮层经 `WorkspaceActiveContext` **触发一次正常关闭**（4.7）。
6. **拖拽**：取消拖拽状态、释放 pointer capture（4.10）。
7. **焦点**：本层 `active` 变 true 时聚焦 Composer，失败降级聚焦本层根节点（`tabIndex=-1`，4.9 / M3）。

#### 4.5.3 关闭外层工作区 Tab

`WindowStore.close()` 先从 `outer` 删除目标，再调用 `useTabsStore.getState().forget(workspaceId)`，见 `src/renderer/src/stores/window.ts:424-455`。`forget()` 释放会话 store、删除 `byWorkspace`、删除 Dock cache，见 `src/renderer/src/stores/tabs.ts:1249-1264`。

stage 渲染集使用 `outer ∩ byWorkspace` 推导，因此任一侧删除后该层都不再渲染。

关闭入口还会先确认未保存文档，见 `src/renderer/src/shell/AppShell.tsx:406-413`。只有 `win.close()` 真正移除外层 Tab 后，workbench 才应卸载。

**关闭确认强化（v3.1 · D13）：** 当被关闭的外层 Tab 对应的 workbench **含 browser tab** 时，复用既有 `confirmDocumentChanges`（`AppShell.tsx:406-413`）的确认流程，扩展提示文案：

> 将关闭 N 个浏览器页面，页面运行时不可恢复。

只加**文案与计数**，不新建对话框组件。理由：关闭会不可逆销毁 N 个页面运行时（sessionStorage、JS 堆、表单、CDP target），必须让用户知情。

**实现注记（v3.1 · M2）：** 实现时先确认 `confirmDocumentChanges` 是否支持自定义文案/计数；若不支持，在 `closeOuterTab` 对「含 browser tab」分支单独走一次确认，仍**不新建对话框组件**。

#### 4.5.4 hydration tombstone（v3.1 · M1 简化为单机制，阻断）

**问题：** `outer ∩ byWorkspace` 只阻止**渲染**幽灵层，不阻止状态复活。

- `ensure` `688-710`：`byWorkspace[ws] !== undefined || loading.has(ws)` 直接 return；`finally` 清 `loading`/`pendingTitles` 并 `applyPendingBrowser`。`loading`（`483`）位于 store 工厂闭包（单例），无法作废已发出的加载。
- `loadOrSeed` `497-522`：三分支，**不校验工作区是否仍打开**。
- `hydrate` `679-686`：直接 `set({ byWorkspace: { ...[ws]: state } })` + `applyPendingBrowser`，**无任何有效性校验**；且该函数**全仓无生产调用方**（仅测试使用）。
- `forget` `1249-1264`：删 `byWorkspace[ws]`、`dockCache`、`releaseSession`；**不清 `loading` / `pendingBrowser`（`488`）/ `pendingTitles`（`484`）**。
- `syncBrowserTabs` `1093-1193`：缺失 ws → `1094-1098` 存 pending + `ensure` + return。

**场景：** 打开 A 后立即关闭 → `getInnerTabs(A)` 晚到 → `byWorkspace[A]` 复活；或 guest 销毁导致 BrowserManager 事件晚到 → 重新 `ensure()`。outer 交集确实不会渲染 layer，但「关闭工作区 = 退出内存」的语义已失败。

**MVP 必须实现（tombstone 单机制，3 条）：**

1. `forget(workspaceId)`：
   - 现有行为保留（删 `byWorkspace[ws]`、`dockCache`、`releaseSession`）；
   - **新增**：`loading.delete(ws)`、`pendingBrowser.delete(ws)`、`pendingTitles.delete(ws)`；
   - **新增**：写 tombstone（`tombstones.add(ws)`）。
2. `ensure(workspaceId)`：`688-710` 入口**新增 tombstone 检查** —— 若该 ws 处于 tombstone 状态，直接 return（不发起加载）。
3. **重新打开**工作区（`openWorkspace` 路径 `window.ts:367-394` 命中）时：**清 tombstone**，之后才允许 `ensure`。

**落地防护（替代原 generation，一行判断）：** `loadOrSeed`（`497-522`）与 `hydrate`（`679-686`）落地前**检查 tombstone**，命中则丢弃结果；stale 丢弃时不得 `applyPendingBrowser`（仅在本轮成功落地时调用）。这等价覆盖「晚到写入」场景。

**v3.1 删除的两项（及理由）：**

- **删除 generation 机制**（原第 4/5 条）：`hydrate`（`tabs.ts:679-686`）全仓**无生产调用方**（仅测试使用），给它加校验是死代码；`loadOrSeed` 落地前的防护改为**检查 tombstone**，等价覆盖晚到写入场景。
- **删除原第 6 条「`syncBrowserTabs` 对非 outer 工作区只存 pending 不 ensure」**：`pendingBrowser` 只在 `ensure` 成功路径被 `applyPendingBrowser` 消费，不 ensure 则永不消费、**无界增长**（agent 可在任意工作区开页面）。MVP 维持现状（缺失 ws 仍 `ensure`）。

原 G21 因此降为 High，测试范围相应缩小（9.2.3）。

#### 4.5.5 browser tab 全部关闭则释放隐藏 Dock

当 resident 工作区的 `browser` tab 全部关闭（关闭路径见 `src/renderer/src/stores/tabs.ts:640-654`、`src/renderer/src/stores/tabs.ts:1004-1016`），该工作区应按 4.1.5 的**去抖/连续判定**移出 resident 集合并卸载隐藏 Dock。这是 4.1.2 硬上限之外的自然释放边界，替代 v1 的无界常驻。

#### 4.5.6 应用退出

renderer 销毁会卸载全部 `WorkspaceDockLayer`。主进程退出阶段还会调用 `browserBindings.shutdown()`，见 `src/main/index.ts:984-1000`；bindings 会清空 page map 并关闭 handle，见 `src/main/browser/bindings.ts:360-367`。

---

### 4.6 与既有模块的协同

#### `src/renderer/src/shell/Dock.tsx`

**不改（v3 明确）。** 保留结构 key、split/ghost、拖拽、DropOverlay、以及**已有的内层浏览器保活语义**（`291-315`）。

理由：`root.id` 是单工作区 Dock 结构身份，不是问题本身（`Dock.tsx:20-37`）；`WorkspaceDockLayer` 为每个工作区提供独立稳定槽位后，无需删除或修改内部 key。B2 的隔离改由 CSS + Context 完成，**不需要**把 `inactive` 透传进 Dock。

**增量（两条，均不改语义）：**

1. 4.10 的拖拽/pointer capture 取消。
2. **机械删除 `runningSessionIds` prop（v3.1 · H1）**：`DockRoot:20` → `DockNodeView:40` → `DockSplitView:60` → `DockGroup:154/:260` → `InnerTabBar:234` 整条透传链，签名共 `:20/37/40/44/60/120/154/260` 8 处。属**签名清理，不改语义**，是 D2（`InnerTabBar` 自行 `useRunIndex` 订阅）的前置条件；类型检查会强制发现遗漏，不会静默。

#### `src/renderer/src/views/registry.tsx`

**不改（v3 明确）。** `InnerViewProps` 定义于 `84-98`，**不含 active 字段，也不需要新增**；`InnerView` `100-105` 按 tab kind 分派；browser 分支 `157-158` 仍是 `<BrowserView tab workspace/>`。workbench 常驻发生在 registry 上层；隔离与静音由 CSS 与 `WorkspaceActiveContext` 承担，`BrowserView` 自行消费。

#### `src/renderer/src/views/browser/BrowserView.tsx`

**最小增量改动，但不含 `inactive` props 透传。** `BrowserView` 本就能直接读 store（先例：`BrowserFeature.tsx:39-40` 直接取 `activeWorkspaceId`），v3 改为读 `WorkspaceActiveContext`。

需要的增量（全部 additive，不改语义）：

1. 消费 `useWorkspaceActive()`：
   - `active === false` → 读一次 `webview.isAudioMuted()` 存入模块级 `Map<tabId, boolean>`，再 `setAudioMuted(true)`；`active === true` → `setAudioMuted(map.get(tabId) ?? false)`（4.8.3）。
   - MVP **不调用** `setBackgroundThrottling`（4.8.4）。
2. `pointer-events` **不在组件内写**：由 `theme.css` 的 `[data-workspace-active='false'] webview` 规则覆盖（4.8.2）。
3. 增加 `data-browser-tab-id` 定位属性（供 Gate 与 E2E 定位）。
4. 监听 `destroyed` 并上报，用于 4.1.4 的自愈与 Gate 观测。
5. **不新增占位分支**（v3.1 · D1）：多窗口 owner 机制移出 MVP，bind 无拒绝语义（res 为 `void`），无占位可渲染。

现有逻辑保持不变：本地状态不重建（`BrowserView.tsx:50-58`）、对账 effect 不因切换重跑（`BrowserView.tsx:66-82`）、`did-attach` 与导航监听继续存在（`BrowserView.tsx:84-141`）、CUA 指针层继续与原 webview 同处一个 DOM 视图（`BrowserView.tsx:262-280`）。

#### `src/main/browser/bindings.ts`

**不改绑定语义。** 保活后 `webContentsId` 不变，因此：

- 同一 ID 的重复 bind 仍是幂等返回，见 `src/main/browser/bindings.ts:133-138`。
- 不会执行替换旧 handle 的 `release()`，见 `src/main/browser/bindings.ts:139`。
- `destroyed` 不会在普通工作区切换时触发，见 `src/main/browser/bindings.ts:183-188`。
- Agent 继续通过现有 `CdpBrowserPage` 操作同一页面，见 `src/main/browser/bindings.ts:148-180`。

**必改（完整版 · 2.3.1 / 4.11）：** 记录并校验 `ownerWindowId`。**MVP 不改**——多窗口机制整体移出 MVP（D1）。

#### `src/main/browser/manager.ts`

**不改。** 继续只维护 `BrowserTab` 元数据，见 `src/main/browser/manager.ts:87-94`。关闭 BrowserTab / 工作区元数据逻辑保持现状，见 `src/main/browser/manager.ts:260-275`。

#### `src/shared/domain/browser.ts`

**不改（MVP）。** partition、owner、BrowserTabStatus 均保持现状，见 `src/shared/domain/browser.ts:7-9`、`src/shared/domain/browser.ts:16-32`、`src/shared/domain/browser.ts:68-69`。`discarded` 状态仅为完整版预留。

#### `src/renderer/src/stores/tabs.ts`

**必须改。** 见 4.5.4（M1 tombstone 单机制）。

---

### 4.7 workspace-owned overlay / portal 生命周期（v3.1 · D7 简化语义与范围）

#### 4.7.1 问题

`inert` / `aria-hidden` / `opacity` 只作用于隐藏层的**真实 DOM 子树**。仓库中 12 处 UI portal 到 `document.body`，这些节点不受约束：

| 组件 | portal 位置 |
|---|---|
| `components/ui/Dialog.tsx` | `98` / `142` |
| `components/ui/ContextMenu.tsx` | `132` / `154` |
| `components/ui/Submenu.tsx` | `75` / `96` |
| `components/ui/Select.tsx`（Radix Portal） | `91` |
| `components/ui/ToastViewport.tsx` | `96` / `115` |
| `components/ui/Tooltip.tsx` | `155` / `191` |
| `components/ProviderModelMenu.tsx` | `182` / `197` |
| `shell/WindowControls.tsx` | `54` / `108` |
| `shell/UpdateIndicator.tsx` | `218` / `302` |
| `shell/SearchPalette.tsx` | `166` / `267` |
| `views/chat/ImageLightbox.tsx` | `134` / `223` |
| `views/chat/TurnNavigationRail.tsx` | `94` / `112` |

另有 `plugin-ui/view.tsx:155` 直接 `appendChild` 到 body。

**场景：** A 中打开灯箱 / 右键菜单 / Select / Dialog，然后通过快捷键、插件事件或会话跳转切到 B。A 的 layer 已 inert，但 portal 仍可能显示在 B 上方、保留焦点、响应 Escape/方向键/pointer，并继续被屏幕阅读器读取。

#### 4.7.2 方案：WorkspaceActiveContext

**React Context 跨 `createPortal` 生效**（portal 只改变 DOM 挂载点，不改变 React 树），因此无需给浮层组件加 `ownerWorkspaceId` props，也无需改造 12 处调用签名。

```tsx
// src/renderer/src/shell/workspace-active.tsx  （模块级 createContext + Provider，沿用
// i18n/index.tsx:4181、markdown/MarkdownProvider.tsx:32 的既有范式）
type WorkspaceActive = { workspaceId: string; active: boolean }

const WorkspaceActiveContext = createContext<WorkspaceActive>({
  workspaceId: '',
  active: true, // ★ 无 Provider 时默认 true：app 级用法零改动
})

export function useWorkspaceActive(): WorkspaceActive {
  return useContext(WorkspaceActiveContext)
}
```

Provider 挂在 `WorkspaceDockLayer` 根（见 4.2.4 代码）。

**规则：**

1. workspace-owned 浮层在读取到 `active === false` 时**触发一次正常关闭**：受控组件用 `open && active`（或 effect 里 `if (!active) onOpenChange?.(false)`），让组件走自身的 dismiss / Presence 退场。
   - **v3.1 变更（D7）**：不再「返回 `null`（硬卸载）」。硬卸载会让 Radix `FocusScope` 的焦点恢复与保活层的焦点恢复互相抢焦点，并可能残留 `open` 状态；走正常关闭则两者解耦。
2. `useWorkspaceActive()` 在无 Provider 时返回 `active: true` —— 所有 app 级用法不受影响，无需改动。
3. `document` / `window` 级监听（keydown、pointerdown、selectionchange、scroll 等）在 workspace-owned 组件内仍必须校验 `active`（正常关闭只能触发组件自身的清理，不保证第三方监听已注销）。
4. 新增「打开浮层后切工作区」的组件测试与手动场景（9.2 / 9.1 场景九）。

#### 4.7.3 纳入 / 排除清单（v3.1 · D7 收敛为 5 处）

**workspace-owned，MVP 必须接入 `useWorkspaceActive()`（5 处）：**

| 组件 | portal 位置 |
|---|---|
| `components/ui/Dialog.tsx` | `98` / `142` |
| `components/ui/ContextMenu.tsx` | `132` / `154` |
| `components/ui/Select.tsx` | `91` |
| `views/chat/ImageLightbox.tsx` | `134` / `223` |
| `components/ui/Tooltip.tsx` | `155` / `191` |

> **`Tooltip` 为 v3.1 新增纳入（D7）**：其 trigger 大量位于 Dock 子树内，原归为 app 级不纳入是错的。

**移入完整版（不属 MVP）：**

- `components/ui/Submenu.tsx`（`75` / `96`）
- `components/ProviderModelMenu.tsx`（`182` / `197`）
- `views/chat/TurnNavigationRail.tsx`（`94` / `112`）
- 文件行菜单 / `OpenWithMenu`（是否属 workspace 内**待确认**）

**app 级，不纳入（保持默认 `active: true`）：**

- `shell/WindowControls.tsx`（`54` / `108`）
- `shell/UpdateIndicator.tsx`（`218` / `302`）
- `shell/SearchPalette.tsx`（`166` / `267`）
- `components/ui/ToastViewport.tsx`（`96` / `115`）

`plugin-ui/view.tsx:155` 直接 `appendChild` 到 body，不走 React portal，不受 Context 约束；其是否属于 workspace-owned **待确认**（取决于插件视图是否只在工作区 Dock 内渲染）。

---

### 4.8 webview 级隔离与媒体

#### 4.8.1 核查结论（含「来源」标注，见 M2）

| 项 | 结论 | 来源 | 设计影响 |
|---|---|---|---|
| 祖先 `inert` 对 OOPIF `<webview>` | ❌ **无效**，不跨 document 边界 | 外部核查 | 隔离必须落在 `<webview>` 元素或 CSS 规则上；`inert` 只作 embedder 侧兜底 |
| `aria-hidden` 对 guest 无障碍内容 | ❌ **无效** | 外部核查 | guest 仍可聚焦会构成 WCAG 违规；需 guest 内处理或确保隐藏 guest 不可聚焦 |
| 隐藏 webview 自动静音 | ❌ **不会** | 外部核查 + 本机代码核对（renderer 零使用 `setAudioMuted`） | 失活时显式 `setAudioMuted(true)`，激活恢复 |
| 主窗口最小化/隐藏后 guest 节流 | ❌ 默认 `backgroundThrottling=true` 会被节流 | 外部核查 + 本机代码核对（唯一先例为主进程插件宿主窗口 `host-window.ts:142`） | MVP 不做干预，明确接受节流（4.8.4） |
| 多个 `opacity:0` webview 资源 | ⚠️ 仍占 GPU 合成 Surface + 渲染进程，随数量线性增长 | 外部核查 | 保活范围必须受限（4.1.2），验收含资源阈值（G11） |
| 移动含 `<webview>` 的祖先 DOM | ⚠️ 官方无契约（大概率安全但不保证） | 外部核查 | append-only 顺序（4.1.4）+ 监听 `destroyed` 自愈 + E2E |
| `opacity:0` 且有尺寸时 `visibilityState` / `innerWidth` / `capturePage()` | ✅ visible / 真实 / 正常 | 外部核查 | `absolute inset-0 + opacity-0` 路线成立 |
| `pointer-events:none` 对 webview 命中测试 | ✅ 有效 | 外部核查 | 作为 guest 隔离主手段 |
| 隐藏窗口下截图 / CDP | ✅ 仍可用（timer 被节流） | 外部核查 | Agent 后台操作可行，但页面 timer 行为需产品接受 |
| CDP `Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent` | ✅ **直接投递 guest，不经宿主命中测试** | 外部核查 | `pointer-events:none` **不影响** Agent 操作（H3，Gate G16） |

#### 4.8.2 隔离落点（v3 · B2）

**唯一手段：全局 CSS 规则。** 写在 `theme.css`（唯一全局样式入口由 `src/renderer/src/main.tsx:4` 引入；Tailwind v4；`data-*` 样式钩子已有先例 `[data-theme-region]`、`[data-dock-root]`、`[data-terminal-status]`）：

```css
/* theme.css —— 失活工作区层内的所有 webview 不参与命中测试 */
[data-workspace-active='false'] webview {
  pointer-events: none;
}
```

- 由 `WorkspaceDockLayer` 根节点上的 `data-workspace-active` 驱动，**无需 props 透传**，也无需 `BrowserView` 感知。
- 同时覆盖插件 webapp 的独立 `<webview>`（`views/plugins/PluginWebAppView.tsx:116-138`）与任何未来新增的 webview，无遗漏面。
- **删除 v2 的「`inactive` props 经层→Dock→registry→BrowserView 透传」表述**；`registry.tsx` 与 `Dock.tsx` 因此不改（4.6）。
- 该规则是**设计前提级**的 Gate **G3**（回归）对象。

#### 4.8.3 媒体：静音语义（v3.1 · D6 恢复失活前值）

**MVP 语义：**

```text
层失活 → 读一次 view.isAudioMuted() 存 Map<tabId, boolean>，再 setAudioMuted(true)
层激活 → setAudioMuted(map.get(tabId) ?? false)   // 无记录默认 false
```

- **不是「激活无条件 unmute」**：改为恢复**失活前的运行时值**，避免「切回工作区瞬间突然出声」。约 5 行。
- 存的是**模块级 `Map<tabId, boolean>`**：不持久化、不建 UI、不进 store。读的是 Electron 运行时现值，**不新增产品状态**——这与原 v3「不为静音偏好新建状态」的论证一致，只是把「现值」也纳入了恢复。
- 不实现「记住用户静音偏好」：renderer 当前**零使用** `setAudioMuted`，仓库内不存在跨会话的用户静音偏好状态；为其新建持久化状态仍属未验证需求（完整版项目，见 10.2）。
- 由 `BrowserView` 消费 `useWorkspaceActive()` 执行（4.6）。

#### 4.8.4 节流（v3 · B4，MVP 不做）

**MVP 不调用 `setBackgroundThrottling`。** 依据：

- renderer 侧**零使用** `setBackgroundThrottling` / `audioMuted` 系列 API（已核实）。
- 全仓唯一相关代码是主进程插件宿主窗口 `src/main/plugin/host-window.ts:142` 的 `backgroundThrottling: false`，那是插件独立窗口的创建选项，与 workspace guest 无关，不构成先例。
- MVP 引入无依据的新行为，且会与「后台不耗电」的默认行为冲突。

**MVP 明确接受的行为：** 后台（失活）guest 的页面 timer 被 Chromium 节流；Agent 的 CDP 调用与 `capturePage()` 仍可用（G10）。

**完整版时机方案（若产品要求后台不节流）：**

1. 开启时机：guest `did-attach` 之后、且该 guest 属于 resident 层时调用 `setBackgroundThrottling(false)`。
2. 恢复时机：层转 `active` 时调用 `setBackgroundThrottling(true)`（回到默认）；层卸载时不需恢复（guest 随 DOM 移除销毁）。
3. 前置：必须由 G6 定标（G6 已降为 High，见 M3），并明确功耗代价的验收阈值。

#### 4.8.5 无障碍

`aria-hidden=true` 只覆盖 embedder 侧。guest 侧残留需在 Gate G8 实测。**缓解（D12）**：层失活时对 guest 调用 `blur()`，把焦点从隐藏 guest 移出，尽量降低「隐藏 guest 仍可聚焦」的 WCAG 风险；若实测仍违规，记录为已知问题，完整版再考虑 guest 内 `aria-hidden` 注入。

---

### 4.9 active 焦点生命周期（v3.1 · D8 简化）

#### 问题

`Composer` 在挂载时主动获取焦点（`src/renderer/src/views/chat/Composer.tsx:368-370`），并明确假设「非激活的 Tab 在 `shell/Dock.tsx` 里压根没有挂载，所以『挂载』就等于『这个对话刚成为可见的那一个』」。

常驻后该不变量失效：切回已 resident 的聊天不会重新 mount，因此输入框不会重新聚焦。旧工作区中已聚焦的 `<webview>` / contentEditable 在被设为 inactive 时如何失焦也未定义（外部核查：`inert` 不跨 OOPIF，已聚焦 guest 的失焦路径无保证）。

仓库**无通用焦点工具**，但有可直接复用的失效判据先例：`ImageLightbox.tsx:97-128` 使用 `restoreRef` + `document.contains(el)` 判断目标元素是否仍可恢复。

#### 规则（v3.1 删除模块级焦点 Map）

1. **Composer 挂载聚焦改为依赖 active**：`Composer.tsx:368-370` 的 effect 改为依赖「本层是否 active」（经 `useWorkspaceActive()`），**变为 active 时聚焦**；常驻后不再依赖「挂载即可见」。
2. **降级**：聚焦失败（元素已卸载/不可聚焦）时，降级为**聚焦本层根节点**（`tabIndex=-1` 容器），保证焦点至少移出隐藏子树；不写「降级到当前主区 Composer」——Composer 正是刚失败的那个，语义循环（M3）。
3. **其余组件复用既有判据**：需要恢复焦点的组件直接用 `document.contains(el)`（`ImageLightbox.tsx:97-128` 先例），**不新建模块级焦点 Map，不建 `workspaceFocus.ts`**。
4. **失活清理**：层失活时对 guest 调 `blur()`（4.8.5），把焦点移出隐藏子树。
5. 已聚焦 `<webview>` 的失焦路径必须在 Gate G9 实测。
6. **standalone 打开/关闭**走同一路径：打开时焦点进入 feature 页；关闭时聚焦目标工作区 layer 内的 Composer（若失败按第 2 条降级到该层根节点）。

> **已知项（M3）：** 层内存在多个 Composer（主区 + 右栏）时，变 active 都会尝试聚焦，**最后一个赢**；这与旧行为（挂载即聚焦）同级，不视为回归。

> **v3.1 删除 `workspaceFocus.ts` 的理由（D8）：** 模块级 `Map<workspaceId, HTMLElement>` + 降级工具徒增状态与生命周期面；仓库真正依赖「挂载即可见」的只有 Composer 一处，改为依赖 active 即可覆盖，其余组件已有自愈判据。

#### 实现前置检查单（v3.1 · D8 新增）

保活后「挂载即可见」不变量失效，**实现前**必须用 grep 过一遍 `src/renderer/src/views` 下全部 mount-time `useEffect`（约 100 处），对命中「挂载即可见」假设的逐项登记处理：

- **高危候选**（需逐项确认/改造）：`Thread.tsx:145`、`ChatView.tsx:164/198`、`MentionInput.tsx:108`、`TerminalView.tsx:74`、`FilesView.tsx:216/237/278`。
- **已确认安全**：`BrowserView.tsx:131`（立即 attach，且 `getWebContentsId` 失败被 catch，不依赖可见性）。
- 检查结果应形成一份清单附在实现 PR 中，作为 G9 / G18 的输入。

---

### 4.10 拖拽与 pointer capture

`inert` 与 `pointer-events-none` 主要影响**新的**命中测试；已建立的 pointer capture、HTML drag 和 document 监听没有自动取消路径。

- `DockSplitter` 主动 `setPointerCapture`，见 `src/renderer/src/shell/Dock.tsx:334-347`。
- `DockGroup` 在 document 注册 `dragend` / `drop`，见 `src/renderer/src/shell/Dock.tsx:166-175`。

**规则（v3.1 · D9 只保留第 1 条）：**

1. `active` 变 false 时：取消 `dragZone` 状态、释放 pointer capture。
2. 测试：拖动 splitter 或 Dock Tab 期间切换工作区，隐藏层不得继续接收 pointer 事件或保留拖拽态。

> **删除原第 2 条**（Dock mutation handler 校验所属工作区 active）：`Dock.tsx:220` 已拒绝跨工作区 drop，属 YAGNI。

---

### 4.11 多窗口 owner 与接管（**完整版** · v3.1 移出 MVP）

> **v3.1 · D1：本节整体移出 MVP。** 原因：`browser:bind` 的 res 为 `void`（`contract.ts:475`），renderer 无法区分 bind 被拒的原因，「非 owner 渲染占位」**做不出来**（原方案「不改 contract」与「渲染占位」自相矛盾）。MVP 维持既有 bind 语义（新 bind `release()` 旧绑定），多窗口 CDP handle 竞争作为**既有问题**记录在 6.2。以下为**完整版**设计，不作为 MVP 实现依据。

#### 4.11.1 改动面（精确）

| 落点 | 位置 | 改动 |
|---|---|---|
| `src/main/browser/bindings.ts` | `bindIab` `117-201` | 入参加 `ownerWindowId`；在 `122-132`（现有校验段）校验：若该 tab 已绑定且 `BoundPage.ownerWindowId !== 本次 ownerWindowId` → 拒绝本次 bind（保留原绑定，不 `release`） |
| `src/main/browser/bindings.ts` | `BoundPage` `25-29` | 新增 `ownerWindowId` 字段 |
| `src/main/browser/bindings.ts` | entry 赋值 `177-181` | 写入 `ownerWindowId` |
| `src/main/ipc/index.ts` | `394-398` | 调用 `bindIab` 时传 `ctx.id` |

#### 4.11.2 不需要改的部分（明确）

- **req 结构不改** `src/shared/ipc/contract.ts:475`（`{ workspaceId; tabId; webContentsId }` 不变）。**但 res 若需承载 owner 判定结果，完整版必须扩 res 或另开只读通道**（当前 res 为 `void`，这是占位分支做不出来的根因）。
- **不改** `src/preload/index.ts`（`37-42` 的类型由 contract 泛型自动派生）。
- **不改** `index.d.ts`、`bootstrap`（`src/main/ipc/app.ts:78-85`）。
- **不需要 renderer 侧 `windowId`**：renderer 当前零使用（已核实），也不新增下发链路。owner 判定完全在主进程侧用 `ctx.id` 闭环；完整版还需在 `browser:bind` handler（`src/main/ipc/index.ts:394-398`）**增加 `ctx` 参数**（现状只解构 `req`）。

#### 4.11.3 owner 语义与接管策略

- **owner 是 per-tab 的**：同一窗口可以对不同 tab 持有 owner；同一 tab 的 owner 唯一。
- **owner 窗口关闭后允许接管**（v3 结论）：
  1. 主进程窗口关闭时（`src/main/window/registry.ts` 的注销路径），将该窗口持有的所有 `BoundPage.ownerWindowId` 置为「无主」。
  2. 无主 tab 的下一次来自**任意**窗口的 `bind` 直接接管，写入新的 `ownerWindowId`，无需额外 UI 或用户确认。
  3. 接管**不释放** CDP handle（guest 未销毁，handle 仍有效），只更新 owner 字段。
  4. 若在窗口关闭前 guest 已销毁，走既有 `destroyed` → `dropIfCurrent` 路径（`bindings.ts:376-379`），与接管无关。
- **非 owner 渲染占位（完整版）**：renderer 侧不感知 windowId，因此「非 owner」只能通过 bind 被拒来观测 —— 但 res 为 `void`，当前**无法落地**；完整版需要先扩 `browser:bind` 的 res（会改 contract），或在 renderer 侧通过其他只读通道观测。
  - 该占位分支能否在真实双窗口场景下稳定触发，属 **G12** 验证范围（v3.1 已移出 MVP Gate 表）。
- 完整版落地时需补双窗口 E2E（对应 G12 / G19，v3.1 已移出 MVP Gate 表）。

---

## 5. 数据流与状态

### 5.1 五个概念

#### resident

表示工作区是否应拥有一个**已挂载且失活后仍保留**的 workbench 层。

```text
outer workspace tabs
∩ tabs.byWorkspace
∩ 本地环境
∩ 存在 browser tab
```

resident 与当前是否可见无关；DOM 顺序为 append-only 插入顺序，不跟随 outer、不按 id 排序。resident 数量受 4.1.2 的 `MAX_RESIDENT` 硬上限约束。

#### transient

表示工作区**仅因当前活动**而渲染，切走即卸载。包含：活动但无 browser tab 的本地工作区、活动远程工作区、尚未水合完成的活动工作区（骨架态）。

#### active（工作区上下文）

由 `activeWorkspaceId` 表示，见 `src/renderer/src/stores/window.ts:39`。该值不能单独决定 workbench 是否可见：功能 Tab 激活时 `activeWorkspaceId` 仍保留原工作区上下文，见 `src/renderer/src/stores/window.ts:1-12`。

#### visible

```ts
const visible =
  activeStandaloneFeature === null &&
  activeOuter?.kind === 'workspace' &&
  activeOuter.ref.workspaceId === workspace.id &&
  activeWorkspaceId === workspace.id
```

`activeOuter` 当前由 `outer.find(activeOuterId)` 得到，见 `src/renderer/src/shell/AppShell.tsx:218`。remote / transient 层也必须用这个判据。

#### hydrating

非「无活动工作区」且 `byWorkspace[id] === undefined`。见 4.1.8。

### 5.2 状态流

```text
openWorkspace / activate
        │
        ▼
WindowStore.outer / activeOuterId / activeWorkspaceId / activeStandaloneFeature
        │
        ├── AppShell.ensureTabs(activeWorkspaceId) ── tombstone 守卫
        │
        ▼
TabsStore.byWorkspace[workspaceId]
        │
        ▼
stageLayers = dedupe(resident ∪ transient)   ← 纯推导 + workspaceId 去重 + append-only 排序 + resident 硬上限
        │
        ├── WorkspaceDockLayer（模块级 + memo + key=workspace.id）
        │       └── WorkspaceActiveContext.Provider { workspaceId, active }
        │
        └── visible 切换：CSS 隔离 / inert / 焦点 / portal 正常关闭 / mute 恢复 / 拖拽取消
```

### 5.3 订阅策略（v3.1 · M5 / D2 给示例）

当前 `AppShell` 已通过 `useWindowStore()` 和 `useTabsStore()` 订阅整个 store，见 `src/renderer/src/shell/AppShell.tsx:98-115`。**其中 `115` 行的 `ensureTabs` 用了 selector，其余为全量订阅**（v3.1 校正）。单 Dock 时尚可；N 个 stage 层后，每次 tab 写入都会先重渲染 AppShell，再重渲染所有 layer（`write()` 每次都做整表浅拷贝 + 单 ws 替换，见 `src/renderer/src/stores/tabs.ts:474-480`；`resizeDock` 会高频写入，见 `src/renderer/src/stores/tabs.ts:635-637`）。

**MVP 必须：**

1. `AppShell` 只订阅 stage 渲染集推导所需的原始值与 actions，**不订阅整个 `byWorkspace`**。
2. `WorkspaceDockLayer` 用 `React.memo`；props 只传原始值（`workspaceId` / `active` / `transient` + 稳定的 `fallbackModel` / `maxOutputTokens`），**不传 `workspace` 对象**，层内经 selector `s.workspaceTargets[workspaceId]` 按 id 取（D2）。
3. 每层只订阅自己的 right/bottom panel 状态。
4. `DockRoot` 继续通过 `dockOf(workspace.id)` 订阅自己的 Dock，见 `src/renderer/src/shell/Dock.tsx:20-29`。
5. `fallbackModel` 用 `useMemo` 稳定引用（当前在 `AppShell.tsx:605` 内联创建）。
6. **`runningSessionIds` 不沿 props 链传入层 / `DockRoot`**：由实际消费组件 `InnerTabBar.tsx:234` 直接 `useRunIndex` 精确订阅（D2）。理由：`App.tsx:222` 的 `useMemo(() => new Set(runIndex...), [runIndex])` 在任何 run 变化时都换新 Set，沿 props 链会击穿所有层的 `memo`。

**`useShallow` selector 示例**（仓库既有 `useShallow` 先例：`ChatView.tsx:12,109`）：

```ts
// 1) 订阅 outer：投影成 string[]（useShallow 对数组逐元素 Object.is，原始值安全）
const outerWorkspaceIds = useWindowStore(
  useShallow((s) =>
    s.outer.filter((t) => t.kind === 'workspace').map((t) => t.ref.workspaceId)
  )
)

// 2) 派生 Array<{ id, hasBrowser }>
const layers = useTabsStore(
  useShallow((s) =>
    outerWorkspaceIds
      .filter((id) => s.byWorkspace[id] !== undefined)
      .map((id) => ({ id, hasBrowser: hasBrowserTab(s.byWorkspace[id]) }))
  )
)
```

> ⚠️ **浅比较陷阱**：`useShallow` 对数组做逐元素 `Object.is`，上例中**每次 map 都新建对象**，因此元素恒不相等，`useShallow` 起不到抑制重渲染的作用。两种修法：
>
> - **（推荐）派生值只含原始值**：`.map((id) => \`${id}:${hasBrowser ? 1 : 0}\`)`，上层再 `useMemo` 解析成 `Array<{id, hasBrowser}>`；
> - 或把对象数组交给 `useMemo`（依赖 `layers` 的原始值数组）稳定引用后再消费。
>
> tabs store 的 `stateOf:527` / `tabsOf:531` / `activeIdOf:535` / `dockOf:539` 是 getter 而非订阅切片，**不能**当作 selector 使用。

---

## 6. 边界与风险

### 6.1 常驻范围收窄后的残留风险

v3 只让「含 browser tab 的本地工作区」失活后常驻，但仍可能同时常驻多个含终端/聊天的 workbench（只要它们有 browser tab）。已知持续运行的资源：

- **终端**：xterm 实例、WebGL addon、ResizeObserver、terminal data/exit 订阅，见 `src/renderer/src/views/terminal/TerminalView.tsx:74-143`；这些资源当前仅在卸载时释放，见 `src/renderer/src/views/terminal/TerminalView.tsx:200-212`。
  - 注意：PTY 本身不因视图卸载而退出（关闭 Tab 才 kill，见 `src/renderer/src/stores/tabs.ts:1010-1013`），且终端能从 buffer 恢复（`src/renderer/src/views/terminal/TerminalView.tsx:145-175`）。因此终端**没有**跨工作区切换保活的必要。
- **聊天**：per-session store 订阅 `src/renderer/src/views/chat/ChatView.tsx:108-129`；多个 effect `src/renderer/src/views/chat/ChatView.tsx:164,198,432-489`；Composer 的 modes/skills 订阅与自定义事件监听 `src/renderer/src/views/chat/Composer.tsx:386-427,644-652`；Thread 的 ResizeObserver `src/renderer/src/views/chat/Thread.tsx:145-166`。
- **文件树**：继续响应全局 `workspace-files-changed` 并刷新，见 `src/renderer/src/views/files/FilesView.tsx:278-297`。
- **插件 webapp**：另一个独立 `<webview>`，见 `src/renderer/src/views/plugins/PluginWebAppView.tsx:116-138`（同样受 4.8.2 的 CSS 规则覆盖）。
- **编辑器/iframe**：CodeMirror（`src/renderer/src/views/files/DocumentView.tsx:97`）、插件 iframe（`src/renderer/src/shell/PluginViewFrame.tsx:236`）。

**缓解：**

- 4.1.2 的 browser tab 过滤是第一道上限。
- 4.1.2 的 `MAX_RESIDENT` 硬上限（建议 3）是第二道上限（v3.1 · D5）。
- 4.5.5 + 4.1.5 的「browser tab 全关即释放（带去抖）」是第三道上限。

**已知接受项（v3.1 · D14）：** 隐藏层的聊天流式输出、隐藏终端持续写 xterm buffer **照常发生**——`memo` 不挡层内自身订阅（层内 store selector 与 effect 仍活跃），这是工作区级保活的固有代价。纳入 G11 观测项，为将来切方案 B 留数据依据。

### 6.2 多窗口

**v3.1 · D1：MVP 对多窗口不新增机制。** 多窗口 owner 机制整体移出 MVP（见 2.3.1 与 4.11，标注完整版）。

- 双窗口打开同一工作区时，`BrowserBindings` 对同一 BrowserTab 只保留一个绑定，**新 bind 会 `release()` 旧绑定**（`src/main/browser/bindings.ts:139`）。两个窗口互相抢 CDP handle 是**既有问题**，keepalive 不引入、不扩大。
- 多窗口下 resident 基于**本窗口 outer 快照**推导，不要求跨窗口一致——主进程**无 outer 变更广播**，本就没有跨窗口一致性的基础。
- renderer 侧 `windowId` 保持**零使用**（已核实），不新增下发链路。

相关既有实现：

- 额外主窗口创建：`src/main/index.ts:803-805`
- 主窗口注册为 `main`：`src/main/index.ts:421`
- bootstrap 按 windowKind 读取 outer：`src/main/ipc/app.ts:78-85`
- 多主窗共享 outer 分库键：`src/main/state/store.ts:630`
- 浏览器事件全窗口广播：`src/main/ipc/index.ts:943`
- 每窗口活动工作区记录：`src/main/window/registry.ts:116-141`
- bindings 单绑定语义：`src/main/browser/bindings.ts:133-140`
- renderer 全量 sync：`src/renderer/src/App.tsx:89-93`
- renderer 侧 `windowId` 使用：**零**（已核实）

### 6.3 隐藏方式的资源表现

外部核查：多个 `opacity:0` webview 仍占 GPU 合成 Surface 与渲染进程，随数量线性增长。

需要实现后观测并作为验收阈值：

- resident 工作区数量
- resident `<webview>` 数量
- xterm WebGL context 数
- 浏览器 renderer process 数
- 工作区切换后 CPU 占用
- GPU / renderer 进程内存

具体阈值当前没有仓库依据，均为 **待确认**，但必须作为 Gate（G11）的硬阈值在 MVP 前定标。

### 6.4 拖拽、DropOverlay 和 split 动画

见 4.10。隐藏层设置 `pointer-events-none` + `inert` + 较低 z-index，可阻止**新的**拖拽命中；已建立的 capture 需显式取消。

Dock 的拖拽处理集中在 `src/renderer/src/shell/Dock.tsx:206-239`，DropOverlay 位于 `src/renderer/src/shell/Dock.tsx:320-327`。

每工作区独立 Presence 确保 split 动画继续使用本层状态，见 `src/renderer/src/shell/Dock.tsx:60-150`。

### 6.5 浏览器 Tab 跨 DockGroup 移动

浏览器 Tab 从一个 DockGroup 移到另一个时，React 父级发生变化，guest 仍可能被卸载后重建。相关入口见 `src/renderer/src/shell/Dock.tsx:211-239`、`src/renderer/src/stores/tabs.ts:591-615`、`src/renderer/src/stores/tabs.ts:623-637`。

方案 A 不解决跨 DockGroup reparent，也不扩大该问题。若需解决，进入方案 B。

### 6.6 Agent 操作与隔离的关系（v3 · H3）

CDP `Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent` **直接投递给 guest renderer，不经过宿主的命中测试**，因此 4.8.2 的 `pointer-events: none` **不影响** Agent 对隐藏页面的点击/输入/截图能力。

- 这是本方案成立的关键前提之一，必须由 **Gate G16** 实测确认（Block）。
- 若 G16 不成立（宿主命中测试实际参与），则「隔离」与「Agent 后台操作」直接冲突，需回退到「隐藏层不做 `pointer-events:none`，改用 focus/mute 隔离」并重新评估。

---

## 7. 内存策略

### 7.1 MVP 不做 LRU

理由：

1. 自动驱逐会再次销毁 webContents，直接违背目标。
2. 页面状态无法通用序列化：JS 堆不可恢复；跨源 iframe 不可读取；WebSocket / Service Worker 上下文不可可靠复建；文件输入不可恢复；sessionStorage 与运行时身份绑定；CDP target 会改变。
3. 当前已有自然释放边界：关闭浏览器 Tab、关闭外层工作区 Tab、应用退出。
4. 在没有实际内存数据前加入 LRU，会把确定性正确性问题变成偶发数据丢失问题。

> ★ 「不做 LRU」成立的前提是 **4.1.2 的 `MAX_RESIDENT` 硬上限 + browser tab 过滤 + 4.5.5 的释放边界**。硬上限（v3.1 · D5）是这个论证成立的**真前提**：没有硬上限，无界常驻 + 不做 LRU = 无上限内存增长，该组合不可接受。

### 7.2 完整版 discard 状态预留

当前 `BrowserTabStatus` 只有 `'loading' | 'ready' | 'error'`，见 `src/shared/domain/browser.ts:8`。完整版可扩展 `discarded`，且必须与 `error` 分开：

- `error`：页面崩溃、绑定失败或 guest 异常消失。
- `discarded`：应用主动为资源治理释放，重新打开时会刷新。

### 7.3 Agent 页面豁免

BrowserTab 已包含 `ownerRunId`、`ownerSessionId`，见 `src/shared/domain/browser.ts:21-22`。主动 discard 时不得淘汰：

1. 当前可见页面。
2. `ownerRunId` 对应仍运行 run 的页面。
3. `ownerSessionId` 仍持有控制权的页面。
4. 正在执行 browser tool 的页面。

不能只依据 `source === 'agent'`，因为用户打开的页面可以被 Agent claim；Manager 的 claim 会写入 owner 字段，见 `src/main/browser/manager.ts:239-258`。

「ownerSessionId 存在多久后允许驱逐」目前没有明确释放协议，属于 **待确认**。

### 7.4 用户可见状态

主动 discard 后重新激活页面时，应明确显示「页面已为节省内存重新加载」，由 `BrowserTabStatus === 'discarded'` 驱动。具体文案和落点属于完整版。

### 7.5 bindings 主动释放

主动 discard 必须先调用 bindings 的 `release(tabId)` 再销毁 guest；`release()` 先从 page map 删除 entry 再关闭 handle，见 `src/main/browser/bindings.ts:324-330`。之后即使旧 guest 触发 `destroyed`，`dropIfCurrent()` 的 current-entry 守卫也不会再将它标记为异常，见 `src/main/browser/bindings.ts:376-378`。

MVP 不新增该 IPC。

### 7.6 观测点

#### renderer

- resident 工作区数量、`resident <webview>` 数量、resident DockGroup 数、resident terminal 数。
- 工作区切换耗时、React commit 时间。

#### main

- `BrowserBindings.pages.size`，容器定义于 `src/main/browser/bindings.ts:107`。
- 每个 workspace 的 BrowserManager tab 数，见 `src/main/browser/manager.ts:92`。
- Electron renderer 进程内存。

采集方式拟用 `app.getAppMetrics()` 或 `webContents.getProcessMemoryInfo()`，但仓库当前未发现现成采集路径，接入位置与采样频率均为 **待确认**；MVP 不为此引入常驻轮询，但 Gate G11 需要一次性定标数据。

---

## 8. 文件级改动清单

| 文件 | 改动类型 | 具体位置 | 说明 |
|---|---|---|---|
| `src/renderer/src/shell/AppShell.tsx` | 改 | `98-115` | 收敛 selector：只订阅 stage 渲染集推导所需原始值与 actions，不再全量订阅 window/tabs store（M5）。注意 `115` 行 `ensureTabs` 已是 selector，其余为全量（v3.1 校正）。 |
| `src/renderer/src/shell/AppShell.tsx` | 改 | `214-216` | `rightEdge` / `bottomEdge` 从顶层移出；`sidebar` Presence 保留。 |
| `src/renderer/src/shell/AppShell.tsx` | 改 | `218-220` | 保留 `activeOuter`；新增 stage 渲染集推导（resident ∪ transient、workspaceId 去重、append-only 排序、去抖移出、**resident 进入去抖**、`MAX_RESIDENT` 硬上限）、水合三态（含 `workspace === undefined`）、`baseShellActive` / `baseActive` 两个判据；`fallbackModel` 改 `useMemo`。 |
| `src/renderer/src/shell/AppShell.tsx` | 改 | `406-413` | 关闭外层 Tab 时，若含 browser tab，复用既有 `confirmDocumentChanges` 扩展提示「将关闭 N 个浏览器页面，页面运行时不可恢复」，只加文案与计数（D13）。 |
| `src/renderer/src/shell/AppShell.tsx` | 改 | `497-611` | `<main>` 保持 flex column；新增 `relative flex-1` stage；基础 shell 与 standalone 在 stage 内叠层；`ConnectionDialogs` 保持在 stage 外正常流。 |
| `src/renderer/src/shell/AppShell.tsx` | 改 | `597-607` | 单实例 `<DockRoot>` 改为 `WorkspaceDockLayer` 叠层（resident + transient）+ feature 覆盖 + 空态层。 |
| `src/renderer/src/shell/WorkspaceDockLayer.tsx` | **新增（必须）** | 新文件 | 命名统一为 `WorkspaceDockLayer`（废弃 `WorkspaceDeck`）。模块级组件：`React.memo`；props 只收 `workspaceId` / `active` / `transient` + 稳定原始值（**不传 `workspace` 对象、不传 `runningSessionIds`**，D2）；层内经 selector `s.workspaceTargets[workspaceId]` 按 id 取 workspace（`stores/window.ts:26`）；**append-only `seq` 顺序表并入本文件**（不单独建 `layerOrder.ts`）；per-workspace Presence、active/inert/aria-hidden、三个 `data-*` 钩子，并挂载 `WorkspaceActiveContext.Provider`。**不得**定义在 `AppShell` 函数体内。 |
| `src/renderer/src/shell/workspace-active.tsx` | **新增** | 新文件 | 模块级 `createContext` + `useWorkspaceActive()`；无 Provider 时默认 `{ workspaceId: '', active: true }`。沿用 `i18n/index.tsx:4181` / `MarkdownProvider.tsx:32` 范式。 |
| `src/renderer/src/styles/theme.css` | **新增规则** | 全局段（建议紧邻 `502-507` 的 `.app-drag` 段之后） | `[data-workspace-active='false'] webview { pointer-events: none; }`（B2 隔离唯一手段）。 |
| `src/renderer/src/stores/tabs.ts` | **改**（M1 简化） | `483-488`、`497-522`、`679-686`、`688-710`、`1249-1264` | tombstone 单机制：`forget` 清 `loading`/`pendingBrowser`/`pendingTitles` 并写 tombstone；`ensure` 入口查 tombstone；重开清 tombstone；`loadOrSeed`/`hydrate` 落地前查 tombstone，stale 不 `applyPendingBrowser`。**不做 generation；`syncBrowserTabs` 维持现状**（D4）。 |
| `src/renderer/src/views/browser/BrowserView.tsx` | 改 | `242-260`、`50-58` | 消费 `useWorkspaceActive()`：失活读 `isAudioMuted()` 存模块级 Map 再 `setAudioMuted(true)`，激活恢复该值（D6）；新增 `data-browser-tab-id`；`destroyed` 上报。**不新增占位分支；不新增 `inactive` props，不写 pointer-events（由 CSS 负责）。** |
| `src/renderer/src/views/chat/Composer.tsx` | 改 | `368-370` | 挂载聚焦 effect 改为依赖「本层是否 active」：变 active 时聚焦，失败降级聚焦本层根节点（`tabIndex=-1` 容器，M3）。 |
| `src/renderer/src/shell/InnerTabBar.tsx` | 改 | `234` | `runningSessionIds` 改由 `InnerTabBar` 直接 `useRunIndex` 精确订阅，不经 props 链（D2）。 |
| `src/renderer/src/views/registry.tsx` | **不改** | `84-98`、`100-105`、`157-158` | `InnerViewProps` 不加 active 字段；分发边界不变。 |
| `src/renderer/src/shell/Dock.tsx` | **改（签名清理，不改语义）** | `20/37/40/44/60/120/154/260` | 保留结构 key、split/ghost、拖拽、内层浏览器保活；**机械删除 `runningSessionIds` prop 透传链**（D2 前置，H1）；另加 4.10 的拖拽/pointer capture 取消。 |
| workspace-owned portal（5 处） | 改 | `components/ui/Dialog.tsx:98/142`、`ContextMenu.tsx:132/154`、`Select.tsx:91`、`views/chat/ImageLightbox.tsx:134/223`、`components/ui/Tooltip.tsx:155/191` | 失活时**触发一次正常关闭**（受控 `open && active` 或 effect `onOpenChange?.(false)`，D7）。app 级不接入：`WindowControls.tsx:54/108`、`UpdateIndicator.tsx:218/302`、`SearchPalette.tsx:166/267`、`ToastViewport.tsx:96/115`。完整版再纳入：`Submenu.tsx`、`ProviderModelMenu.tsx`、`TurnNavigationRail.tsx`。 |
| 多窗口 ownership（**完整版** · B3） | 改（**完整版，MVP 不做**） | `src/main/browser/bindings.ts:25-29`（`BoundPage` 加 `ownerWindowId`）、`117-201`（`bindIab` 入参 + `122-132` 校验）、`177-181`（entry 写入）、`src/main/ipc/index.ts:394-398`（传 `ctx.id`，需先加 `ctx` 参数） | **MVP 整体移出**（D1）：不改 `bindings.ts` / `ipc/index.ts`；`contract.ts:475`、`preload/index.ts:37-42`、`index.d.ts`、`bootstrap` 也不改。owner 窗口关闭后允许接管为完整版设计。 |
| `src/renderer/src/shell/__tests__/workspace-dock-layer.test.ts` | 新增 | 新文件（命名统一，替代 v2 的 `workspace-deck.test.ts`） | stage 渲染集推导纯函数 + React 挂载身份（模块级组件、append-only 顺序、transient↔resident 不重挂载、活动但无 browser tab 也渲染、resident 硬上限降级）。 |
| `src/renderer/src/stores/__tests__/hydration-tombstone.test.ts` | 新增 | 新文件 | `forget` 清 `loading`/`pendingBrowser`/`pendingTitles` + tombstone；`ensure` 查 tombstone 直接 return；重开后清 tombstone 可正常水合；关闭后晚到写入不复活（靠 tombstone）。**不含 generation 用例**（D4）。 |
| `src/renderer/src/stores/__tests__/browser-isolation.test.ts` | 改测试 | `42-62` | 扩展 per-workspace right/bottom panel 恢复断言。 |
| `src/renderer/src/stores/__tests__/browser-navigation.test.ts` | 改测试 | `56-150` | 保留 standalone 不改变工作区状态的断言；增加 view 层保持挂载的组件测试场景。 |
| E2E | 新增 | `scripts/e2e-webcontents-stable.mjs` | 单脚本（约 60 行），照抄 `scripts/office-editors-probe.mjs:35,120` 的 `playwright-core` + `_electron.launch` 先例：切换 / reorder / pin / unpin 后 `getWebContentsId()` 不变；新开 tab 触发 transient→resident 不重挂载；关闭外层 Tab 后旧 `webContents` destroyed（G22）。**不建 harness 全家桶、不引 Playwright test runner**（D10）。 |
| `src/renderer/src/stores/window.ts` | 不改 | `26-60`、`341-422`、`466-479`、`367-394` | 复用 outer、active、standalone、per-workspace panel 状态与排序能力。 |
| `src/renderer/src/lib/usePresence.ts` | 不改 | `22-81` | 每个 `WorkspaceDockLayer` 独立调用。 |
| `src/renderer/src/shell/dock-layout.ts` | 不改 | `17-42` | 继续负责边缘可见性投影。 |
| `src/main/browser/manager.ts` | 不改 | `87-100`、`260-275` | 继续只管理元数据。 |
| `src/main/browser/session.ts` | 不改 | `109-110` | Cookie/storage 清理逻辑不参与工作区切换。 |
| `src/shared/domain/browser.ts` | 不改（MVP） | `7-32`、`68-69` | 不新增 `discarded`；完整版再扩展。 |

---

## 9. 验证计划

### 9.1 手动验证

#### 场景一：webContentsId 保持不变

1. 打开本地工作区 A。
2. 新建浏览器 Tab，打开任意稳定测试页面。
3. 在 renderer DevTools 中定位：

   ```js
   document.querySelector('[data-workspace-layer-id="A"] webview[data-browser-tab-id]')
   ```

4. 记录 `webview.getWebContentsId()`。
5. 切换到含 browser tab 的工作区 B。
6. 再切回 A。
7. 再次读取同一节点的 `getWebContentsId()`。

期望：DOM 节点同一对象；`webContentsId` 不变；页面未触发完整 reload。

#### 场景二：sessionStorage、表单和滚动保留

1. 写入唯一 sessionStorage 值。
2. 在未提交表单中输入文本。
3. 滚动到明显位置。
4. 切换 A → B → A。

期望：sessionStorage、表单内容、滚动位置均保留；页面不出现重新加载动画。

Cookie 不作为主要判据，partition 本就持久化，见 `src/shared/domain/browser.ts:68-69`。

#### 场景三：Agent CDP 连续性（含 H3）

1. Agent 在 A 打开或认领一个浏览器页面。
2. 执行一次 snapshot，记录 ref。
3. 用户切到 B（A 的层此时 `pointer-events: none`）。
4. Agent 在 A 的同一 BrowserTab 上继续执行 snapshot / click / type。

期望：不出现 “The browser page is not attached”（报错位于 `src/main/browser/bindings.ts:370-373`）；click/type 作用于原页面；`pointer-events: none` 不影响 CDP 输入投递（Gate G16）。

#### 场景四：关闭后真正释放

1. 关闭内层浏览器 Tab（观测去抖：300ms 内不应卸载）。
2. 关闭包含浏览器的外层工作区 Tab。
3. 记录旧 `webContentsId`。
4. 通过主进程调试探针或日志确认旧 `webContents` 已 destroyed。

期望（对应 **G22**）：主进程侧旧 `webContents.isDestroyed() === true`，且 `BrowserBindings.pages` 中对应 entry 已移除；关闭后不再存在隐藏 `WorkspaceDockLayer`；CDP 操作失败；不存在仍可交互的透明 webview；BrowserTab 关闭路径仍正常广播。

关闭路径见 `src/renderer/src/stores/tabs.ts:640-654`、`src/renderer/src/stores/tabs.ts:1004-1016`。

#### 场景五：边缘面板隔离

1. A：右侧展开、底部关闭。
2. B：右侧关闭、底部展开。
3. 多次切换 A/B。

期望：各自恢复自己的 panel 状态；隐藏工作区的浏览器 guest 不因另一工作区面板关闭而销毁；动画只在目标层播放。

> 边界：若**用户**在 A 真实关闭右侧面板，A 的 edge 分支按既有逻辑卸载 —— 这是既有行为，不是回归。

现有 right panel 隔离测试位于 `src/renderer/src/stores/__tests__/browser-isolation.test.ts:42-62`。

#### 场景六：Dock 与 standalone 回归（含 H4）

每个 stage 层分别验证：水平/垂直 split、splitter 拖动、浏览器 Tab 排序、DropOverlay、右/底面板开合动画、standalone feature 打开关闭、设置/奖励/连接对话框覆盖 workbench、`ConnectionDialogs` 状态条位置正确。

**新增（H4 回归）：**

- 激活 **feature 外层 tab** 时：外层 Tab 条可见且可点击，能正常切回工作区（G17）。
- 打开 standalone（browser/extensions/scheduled/git）时：workbench 不被卸载（切回后 `webContentsId` 不变），`ConnectionDialogs` 状态条仍在正常流。

浏览器跨组移动仍允许重建 guest，属既有边界。

#### 场景七：隔离与媒体（含 D6 / D7）

1. 在 A 打开一个会播放音频的页面，切到 B。
2. 验证 A 的音频已静音；切回 A 后恢复**失活前的静音值**（D6：失活前若为静音则仍静音，若未静音则解除静音）。
3. 在 A 的页面上尝试点击/滚动（隐藏时应完全无响应，`theme.css` 的 `[data-workspace-active='false'] webview { pointer-events: none }` 生效）。
4. 在 A 打开 Dialog / 右键菜单 / 图片灯箱 / Select / Tooltip，切到 B。
5. 验证这些浮层被**正常关闭**、body 下无残留、无 keydown 响应（D7）。
6. 切回 A：验证焦点回到 A 最后焦点目标（元素仍存在时）；元素已失效时降级为聚焦本层根节点（`tabIndex=-1`，M3）。

#### 场景八：多窗口 owner 与接管（**完整版** · v3.1 移出 MVP）

> v3.1 · D1：本场景**不属 MVP 验证范围**。MVP 对多窗口不新增机制；双窗口 CDP handle 竞争是既有问题（6.2）。以下为完整版设计验证。

1. 窗口 W1 打开工作区 A 并开一个 browser tab，Agent 绑定成功。
2. 新建主窗口 W2，切到同一工作区 A 的同一 browser tab。
3. 期望：W2 对该 tab 渲染**占位**（bind 被拒），W1 的 guest 与 CDP handle 不被 `release()`；Agent 在 W1 侧操作仍成功。
4. 关闭 W2。
5. 期望：W1 绑定仍可用（关闭非 owner 窗口不影响 owner）。
6. 关闭 W1（owner 窗口），重新在另一个窗口打开同一 tab。
7. 期望：该 tab 变为「无主」，下一次 bind **接管成功**（写入新 `ownerWindowId`），不出现永久占位。

验证点：`src/main/browser/bindings.ts:122-132` 的 owner 校验、`BoundPage.ownerWindowId`（`bindings.ts:25-29`）、`src/main/ipc/index.ts:394-398` 传入的 `ctx.id`。

#### 场景九：portal 与焦点残留（D7 / D8）

1. 在 A 打开灯箱（`ImageLightbox.tsx:134/223`），按 Esc 前先用快捷键切到 B。
2. 期望：A 的灯箱被**正常关闭**（走自身 dismiss/Presence 退场），body 下无残留，`ImageLightbox.tsx:97-128` 的 window keydown 不再响应。
3. 对 ContextMenu（`132/154`）、Select（`91`）、Dialog（`98/142`）、Tooltip（`155/191`）重复同一操作。
4. 期望：`WindowControls`（`54/108`）、`UpdateIndicator`（`218/302`）、`SearchPalette`（`166/267`）、`ToastViewport`（`96/115`）**不受影响**（无 Provider 时默认 `active: true`）。完整版再覆盖 `Submenu` / `ProviderModelMenu` / `TurnNavigationRail`。
5. 焦点：在 A 的 Composer 输入后切到 B 再切回，期望输入框重新聚焦（`Composer.tsx:368-370` 的挂载副作用不再可靠，必须走 4.9 的依赖 active 路径）；聚焦失败时降级为聚焦本层根节点（`tabIndex=-1`，M3）。

#### 场景十：无水合竞态（M1 · tombstone）

1. 打开工作区 A 后立即关闭（在 `getInnerTabs` 返回前）。
2. 期望：`byWorkspace[A]` **不复活**；`loading`（`tabs.ts:483`）被 `forget` 清除；DevTools 中无 A 的层。
3. 关闭期间让主进程 `browser:changed` 事件晚到（`App.tsx:89-93` → `syncBrowserTabs` `1093-1193`）。
4. 期望：晚到的 `ensure` 因 tombstone 直接 return；晚到的 `loadOrSeed` / `hydrate` 结果因 tombstone 被丢弃，且**不**执行 `applyPendingBrowser`。
5. 重新打开 A。
6. 期望：清 tombstone 后可正常 `ensure()` 并应用最新 pending。

#### 场景十一：resident 增删不 detach（H2 / D5）

1. 依次打开 A、B、C（均含 browser tab），记录各自 `getWebContentsId()`。
2. 在 A 中**新开**一个 browser tab（A 从无 browser tab 转为 resident）。
3. 期望：B、C 的 `webContentsId` 不变（append-only 保证只 `appendChild`）。
4. 对 outer 做 reorder / pin / unpin（`window.ts:466-479`）。
5. 期望：三者 `webContentsId` 均不变，DOM 顺序不随 outer 变化。
6. 快速关闭并重新打开 A 的 browser tab（模拟广播分批）。
7. 期望：去抖窗口内 A 的层不卸载，`webContentsId` 不变。
8. 依次打开 A、B、C、D（均含 browser tab），超过 `MAX_RESIDENT = 3`。
9. 期望：seq 最小且非当前可见的旧 resident 被移出 stage 渲染集（卸载）；其余 resident 的 `webContentsId` 不变。

---

### 9.2 自动化测试

#### 9.2.1 stage 渲染集推导纯函数

文件：`src/renderer/src/shell/__tests__/workspace-dock-layer.test.ts`（命名统一，替代 v2 的 `workspace-deck.test.ts`）

覆盖点：

- outer 有 A/B，只有 A 已水合：仅 A 在 stage。
- A 已水合但 outer 已关闭：A 不在 stage。
- local 已水合但**无 browser tab**，且**非活动**：不在 stage。
- **local 已水合但无 browser tab，且为活动工作区：仍在 stage（标 `transient`）** ← B1 回归，v2 缺失。
- **活动工作区无 browser tab → 切走 → 不在 stage（transient 语义：切走即卸载）**。
- **活动工作区在 transient 期间新开 browser tab → 转为 resident，且 `key` 不变（同一实例）**。
- connection/unbound（非本地环境）已水合：仅在活动时以 transient 出现，不进 resident。
- 外层 feature 不进入 stage 渲染集。
- 重复 workspaceId：只出现一次。
- **DOM 顺序为 append-only**：先 A 后 B，则顺序恒为 [A, B]；再打开 C，顺序为 [A, B, C]；移除 B 后幸存者顺序仍为 [A, C]（不压缩、不重排）。
- **顺序与 outer 顺序无关**：outer 重排后顺序不变。
- **去抖移出**：`hasBrowser` 在去抖窗口内闪回时，层保留在 stage。
- **resident 硬上限**：第 4 个 resident 进入时，seq 最小且非可见的旧 resident 被移出 stage 渲染集（卸载）。
- 水合三态：`activeWorkspaceId === null` → 空态；`workspace === undefined`（活动 id 非空但工作区记录已删除）→ 空态；活动且 `byWorkspace[id] === undefined` → 骨架（**不**渲染空态文案）。

#### 9.2.2 React 挂载身份

文件：同上 `workspace-dock-layer.test.ts`

使用仓库现有 `createRoot` + `act` 范式（范式参考 `src/renderer/src/views/chat/__tests__/chat-view.test.ts:1-3`；另一先例 `src/renderer/src/components/__tests__/open-with-menu.test.ts:18`）。测试简化 `WorkspaceDockLayer`：

1. 渲染 A active、B hidden。
2. 子组件 mount effect 记录 mount/unmount 次数。
3. 改为 B active：断言 A 没有 unmount，B 没有重新 mount。
4. 从 outer 移除 A：断言 A 此时才 unmount。
5. **父级无关 state 更新后 A/B 均不重挂载**（验证模块级组件 + `memo`）。
6. **outer 重排后 DOM 顺序不变**。
7. **A 从 transient 转 resident 时不重挂载**（B1 关键）。

> 注意：`src/renderer/src/main.tsx:11-29` 启用了 `StrictMode`。dev 下 effect 会双调用；JSDOM 测试的 mount 计数需按 StrictMode 语义处理或在测试中关闭。

> JSDOM 可验证 React/DOM identity，但**不能**证明 Electron guest 进程与真实 CDP attachment 未变化 —— 后者只能靠 9.4 的 Electron 探针。

#### 9.2.3 Store 测试

文件：`src/renderer/src/stores/__tests__/hydration-tombstone.test.ts`

覆盖点：

- `forget(ws)` 后：`byWorkspace[ws]`、`dockCache`（`tabs.ts:387`）、`loading`（`483`）、`pendingBrowser`（`488`）、`pendingTitles`（`484`）全部清除；tombstone 写入。
- `forget` 后调用 `ensure(ws)`：因 tombstone 直接 return，不发起加载。
- **关闭后晚到写入不复活**：关闭期间晚到的 `loadOrSeed`（`497-522`）/ `hydrate`（`679-686`）结果因 tombstone 被丢弃，且**不**执行 `applyPendingBrowser`。
- **重新打开可正常水合**：清 tombstone → `ensure()` 成功 → 应用最新 pending。
- 重新打开后 `write`（`474-480`）产生的 `byWorkspace` 能被 stage 推导看到。
- **不含 generation 用例**；`syncBrowserTabs` 维持现状，不测「只存 pending」路径（D4）。

文件：`src/renderer/src/stores/__tests__/browser-isolation.test.ts`（改，原 `42-62`）

- 扩展 per-workspace right/bottom panel 恢复断言（活动用 `rightPanelOpen`，非活动用 `rightPanelOpenByWorkspace`，见 `window.ts:55-60`）。

文件：`src/renderer/src/stores/__tests__/browser-navigation.test.ts`（改，原 `56-150`）

- 保留「standalone 不改变 `outer` / `activeOuterId` / `activeWorkspaceId`」的断言（`56-72`）。
- 增加「feature 外层 tab 激活时 `baseShellActive === true`、`baseActive === false`」的判据单元测试（H4）。
- 增加 view 层保持挂载的组件测试场景。

#### 9.2.4 焦点与 portal 组件测试

v3.1 · D15：**不新建独立测试文件**（删除原计划的 `workspace-active.test.ts` 与 `workspace-focus.test.ts`）。相关行为以 9.1 场景七 / 场景九手动验证为主；如需组件级回归，就近并入既有 `browser-navigation.test.ts` 的最小增量，不单独起文件。

#### 9.2.5 必须手动 / Electron 探针验证的部分（JSDOM 覆盖不到）

以下**不能**用 vitest + jsdom 覆盖，只能靠 9.1 手动场景与 9.4 单脚本 Electron 探针：

- `webContentsId` 稳定性与 guest 是否 detach（G1、G2）。
- 反向销毁自动化部分：关闭外层 Tab 后 layer 节点移除、`destroyed` 计数 1、`getWebContentsId()` 抛错（G22 ①，轮询 1000ms）；`pages` entry 移除（G22 ②）走 9.1 场景四手动。
- 活动 transient 工作区新开 browser tab 转 resident 不重挂载，用 layer 根节点 `el.__probe` 观测（G23、H3）。
- `pointer-events: none` 对 OOPIF guest 命中测试的真实阻断效果（G3）。
- CDP `Input.dispatch*` 在 `pointer-events: none` 下仍生效（G16）。
- 祖先 `inert` 对 guest 无效（G4，设计前提）。
- `setAudioMuted` 实际生效（G13）。
- `app-drag` 在隐藏基础 shell 中的行为（G7）。
- 资源阈值与 resident 上限（G11、G15）。
- guest 无障碍树残留（G8）。
- 已聚焦 webview 的失焦路径（G9）。
- 完整版多窗口 owner 与接管（G12、G19，已移出 MVP）。

---

### 9.3 必须实测的 Gate 清单（v3 · 硬门禁）

> 以下为**必须实机验证**的行为，不得作为假设写进实现依据。标 **Block** 的项未通过则不得合入。Electron 版本应与仓库一致（当前 `package.json` 依赖 `electron ^44.1.1`）。
>
> **来源**列区分结论的可靠性：
> - **外部核查** —— 来自 Electron/Chromium 官方文档或公开行为核查，未在本仓实机验证。
> - **本机实测** —— 已在本仓代码或实机环境中核对/验证过。
> - **待实测** —— 无任何依据，必须实测后才能作为设计依据。

| ID | 行为 | 判据 | 级别 | 来源 |
|---|---|---|---|---|
| **G1** | A/B 切换、standalone 开关、feature 覆盖前后，同一 `<webview>` 的 `webContentsId` 不变 | 场景一 + 9.4 单脚本探针；`destroyed` 事件数为 0 | **Block** | 待实测 |
| **G2** | outer reorder / pin / unpin、**resident 成员新增/移出**（移动或重排含 `<webview>` 的祖先 DOM）后 guest 不 detach | 场景十一 + 9.4 单脚本探针；`destroyed` 事件数为 0 | **Block** | 外部核查（官方无契约，大概率安全） |
| **G3** | 隐藏 guest 的 `pointer-events:none` 能完全阻断点击/滚动/右键/拖放命中 | 场景七第 3 步；隐藏页无任何输入响应 | Block（回归） | 外部核查（✅ 已确认有效） |
| **G4** | 祖先 `inert` 对 OOPIF guest 无效（确认隔离必须落在 webview 元素/CSS 规则上） | 隐藏层内 guest 仍可被程序化 focus/输入 | Block（设计前提） | 外部核查（❌ 已确认无效） |
| **G5** | `opacity:0` 且有尺寸时：`visibilityState` = visible、`innerWidth/innerHeight` 真实、`capturePage()` 正常 | 探针读取 guest 内 `innerWidth`、`document.visibilityState`，对比 `capturePage()` 尺寸 | Block（回归） | 外部核查（✅ 已确认） |
| **G6** | 主窗口最小化/隐藏后 guest 被节流；`setBackgroundThrottling(false)` 的效果与功耗代价 | 探针测量后台 timer 触发频率 | **High**（v3 由 Block 降级：MVP 不做 throttling，仅服务完整版定标） | 外部核查（❌ 默认节流）+ 本机实测（renderer 零使用、唯一先例 `host-window.ts:142` 与 workspace guest 无关） |
| **G7** | 隐藏的基础 shell 中 `app-drag` 区域是否仍响应原生拖动 | 场景六；隐藏层窗口不可被拖动 | **Block** | 待实测（`theme.css:502-507`，`-webkit-app-region` 可继承，叠加 `app-no-drag` 的落点需实测） |
| **G8** | 隐藏 guest 是否仍可聚焦 / 无障碍树残留（WCAG） | a11y 树检查 + 程序化 focus 测试；缓解：失活时对 guest `blur()`（4.8.5），仍违规则记录为已知问题 | High（可降为完整版，但需记录） | 外部核查（❌ `aria-hidden` 不覆盖 guest） |
| **G9** | 已聚焦 `<webview>` / contentEditable 在层失活后的焦点归属；激活时恢复是否成功 | 场景九第 5 步 + 场景七第 6 步 | **Block** | 待实测（本机仅有 `ImageLightbox.tsx:97-128` 的 `document.contains` 失效判据先例） |
| **G10** | 隐藏 guest 的 snapshot / click / screenshot 可用，且 viewport 非零 | Agent 在隐藏页执行 snapshot + `capturePage()` | **Block** | 外部核查（✅ 截图/CDP 可用，timer 节流） |
| **G11** | 多个 `opacity:0` webview 的 GPU Surface / renderer 进程 / 内存随数量增长曲线；校验 `MAX_RESIDENT` 取值 | 递增 resident 数，采集进程内存与 GPU 指标 | **Block**（定阈值） | 外部核查（⚠️ 线性增长）；本仓阈值待实测 |
| **G12** | 双窗口：不互相抢 CDP binding；`ownerWindowId` 生效；非 owner 渲染占位 —— **完整版（v3.1 移出 MVP）** | 场景八（完整版）；`BoundPage.ownerWindowId` 不被覆盖，无 `release()` | 完整版（不属 MVP 门禁） | 待实测（`ctx.id` 可得，但 `contract.ts:475` res 为 void，占位做不出来） |
| **G13** | 隐藏 guest 音频是否继续播放；`setAudioMuted(true)` 与恢复失活前值（D6）生效 | 场景七第 1-2 步 | **Block**（隐藏页持续出声是秒感知回归） | 外部核查（❌ 不自动静音）+ 本机实测（renderer 零使用 `setAudioMuted`） |
| **G14** | 拖动 splitter / Dock Tab 期间切换工作区，隐藏层不继续接收 pointer 事件 | 场景六；`Dock.tsx:334-347` 的 capture 被释放 | High | 待实测 |
| **G15** | xterm WebGL context 在多层常驻时的上限与回退表现 | 递增 resident 数，观察 WebGL context 创建失败与回退；受 `MAX_RESIDENT` 约束 | **Block**（context 上限约 16，触顶静默降级） | 待实测 |
| **G16** | `pointer-events:none` 下 CDP `Input.dispatchMouseEvent` / `insertText` / `dispatchKeyEvent` 仍直接投递 guest、生效 | 场景三第 4 步；隐藏页 click/type 产生预期 DOM 变化 | **Block** | 外部核查（✅ 不经宿主命中测试）；本仓待实测 |
| **G17** | feature 外层 tab 激活时，外层 Tab 条保持可见可交互（`baseShellActive` 与 `baseActive` 分离生效） | 场景六新增项；feature 页可见时点击工作区 Tab 能切回 | **Block**（回归） | 本机实测（已核实 `baseActive` 在 `kind==='feature'` 为 false，若不分离则 Tab 条被 inert） |
| **G18** | **B1 回归**：活动但无 browser tab 的工作区仍正常渲染（transient）；切走即卸载；在其内新开 browser tab 时转 resident 且不重挂载 | 9.2.1 / 9.2.2 组件测试 + 场景十一第 2 步 | **Block**（回归） | 本机实测（v2 定义会导致该工作区不被渲染） |
| **G19** | owner 窗口关闭后，tab 变无主并允许任意窗口接管；接管不释放 CDP handle —— **完整版（v3.1 移出 MVP）** | 场景八第 6-7 步（完整版） | 完整版（不属 MVP 门禁） | 待实测（完整版接管策略） |
| **G20** | **D7**：workspace-owned 浮层在失活时被**正常关闭**、body 无残留、无 keydown 响应；app 级浮层不受影响 | 场景九第 1-4 步 | **Block** | 本机实测（Context 跨 portal 生效为 React 契约；portal 位置已核实） |
| **G21** | **M1**：关闭期间晚到的 `ensure` / `loadOrSeed` / `hydrate` / browser event 不复活 `byWorkspace`；重新打开能正常水合 | 场景十 + 9.2.3 Store 测试 | **High**（v3.1 由 Block 降级：改为 tombstone 单机制，覆盖面缩小） | 本机实测（`forget` `1249-1264` 不清 `loading`/pending 已核实） |
| **G22** | **D3 反向销毁**（拆两半）：① **自动化**：关闭外层 Tab / 关闭最后一个 browser tab（过去抖窗口）后，layer 节点从 DOM 移除、`destroyed` 事件计数为 1、再次 `getWebContentsId()` 抛错；**轮询 1000ms 内达成即通过**（webview 移除后 guest 销毁非同步，避免误判）。② **主进程**：`BrowserBindings.pages` 对应 entry 移除 —— 无只读 IPC，探针观测不到，降级为 9.1 场景四第 4 步手动/一次性定标（或完整版开 dev-only 调试 IPC）。 | 场景四 + 9.4 单脚本探针（仅 ①） | **Block**（①） | 待实测 |
| **G23** | **transient→resident 不重挂载**：活动 transient 工作区内新开 browser tab 转 resident 时，层不重挂载。**观测手段（H3）**：转换前在 layer 根节点打 expando `el.__probe = 1`，转换后断言 `document.querySelector('[data-workspace-layer-id="A"]').__probe === 1`（transient 阶段还没有 webview，不能以 `webContentsId` 作判据）。 | 场景十一第 2 步 + 9.4 单脚本探针 | **Block** | 待实测 |

---

### 9.4 Electron 单脚本探针（v3.1 · D10 收敛）

#### 9.4.1 技术选型：一个脚本，不建 harness

仓库现状（已核实）：vitest + jsdom，**无 `e2e/`、无 `*.spec.ts`、无 `playwright.config`**；`playwright-core` 仅被 `scripts/office-editors-probe.mjs:35,120` 用 `_electron.launch` 做 Electron 进程探针。

**决策（D10）：只新增 1 个 `scripts/e2e-webcontents-stable.mjs`（约 60 行）**，照抄上述先例：`_electron.launch` 启动 → 打开工作区 A + browser tab → 记录 `getWebContentsId()` → 切 B 切回 → 断言 id 不变；reorder / pin / unpin 后断言不变；新开 tab 触发 transient→resident 转换，用 layer 根节点 expando 断言不重挂载；关闭外层 Tab 后轮询 1000ms 断言 layer 节点移除 + `destroyed` 计数 1 + `getWebContentsId()` 抛错（G22 自动化部分）。任一等式不成立则退出码非 0。

- **不引入 Playwright test runner**，不建 `harness.mjs` / `assert.mjs` / `probe-webcontents.mjs`，不建 6 用例目录，不做双窗口驱动与资源采样接入。
- 其余 Gate 走 9.1 手动场景 + 一次性定标。

#### 9.4.2 脚本能力与覆盖

| 能力 | 说明 |
|---|---|
| 启动/关闭 | `_electron.launch`（`scripts/office-editors-probe.mjs:35,120` 先例），`webviewTag: true`（`src/main/index.ts:288-299`）；结束 `app.close()` |
| 读 `webContentsId` | renderer 侧 `document.querySelector('[data-workspace-layer-id="<wsId>"] webview[data-browser-tab-id]').getWebContentsId()` |
| 断言 | 极简 `assert` + 退出码；不引 expect 库 |

| 覆盖 Gate | 步骤 |
|---|---|
| **G1 / G2 / G23** | A 开 browser tab → 记录 id → 切 B 切回 / reorder / pin / unpin → 断言 id 不变；A 内新开 tab（transient→resident）用 `el.__probe` 断言不重挂载（H3） |
| **G22（仅自动化部分）** | 关闭外层 Tab → 轮询 1000ms 内断言 layer 节点从 DOM 移除、`destroyed` 计数 1、`getWebContentsId()` 抛错；`pages` entry 移除走场景四手动/一次性定标（H2/H5） |
| （手动补） | G3/G4/G5/G7/G8/G9/G10/G11/G13/G14/G16/G20/G21 走 9.1 手动场景 + 一次性定标 |

> `src/main/browser/__tests__/bindings.test.ts:113-133` 已覆盖「guest 销毁后绑定失效」，但不覆盖 renderer 工作区切换时 guest 是否保持存活 —— 这正是本脚本要补的。
>
> **风险提示：** Electron 在 CI/无头环境跑真实 webview 的可行性未验证；若不可行，G1/G2/G22/G23 只能靠本地手动 + 一次性定标，交付前必须明确记录未覆盖项。**是否进 CI 待确认**（仓库当前无 e2e CI 先例）。

---

## 10. MVP 与完整版分界 + 后续演进

### 10.1 MVP 范围

MVP 包含：

- **stage 渲染集 = `dedupe(resident ∪ transient)`**；活动但无 browser tab 的工作区照常渲染（B1）；transient ↔ resident 用同一 `key={workspace.id}`，转换不重挂载。
- resident = 含 browser tab 的本地已水合工作区；**不含 browser tab 的工作区失活后不常驻**；**resident 数量硬上限 `MAX_RESIDENT = 3`**（模块级常量，第 4 个进入时降级 seq 最小且非可见的旧 resident，D5）。
- 每工作区稳定 `key={workspace.id}`，`WorkspaceDockLayer` **模块级 + `React.memo`**；props 只传原始值（**不传 workspace 对象、不传 runningSessionIds**，D2）。
- **append-only DOM 顺序**（首次进入 stage 的插入顺序），不跟随 outer、不按 `workspace.id` 排序；成员移除不重排幸存者；seq 表并入 `WorkspaceDockLayer.tsx`（H2）。
- **移出去抖**（建议 300ms，待 G2/G11 调整），规避广播分批导致的「消失又回来」（H2）。
- 非活动层：opacity / pointer-events / inert / aria-hidden（embedder 侧）+ **`theme.css` 全局 `[data-workspace-active='false'] webview { pointer-events: none }`**（B2）。
- **失活 `setAudioMuted(true)`、激活恢复失活前读到的值**（模块级 Map，无记录默认 false）；不做「记住用户静音偏好」（D6）。
- **不做 `setBackgroundThrottling`**，明确接受后台 guest timer 被节流（B4）。
- **模块级 `WorkspaceActiveContext`** + `useWorkspaceActive()`（无 Provider 默认 `true`）；**5 类 workspace-owned 浮层**（Dialog / ContextMenu / Select / ImageLightbox / Tooltip）失活时**触发一次正常关闭**；4 类 app 级不纳入（D7）。
- **焦点**：`Composer` 挂载聚焦 effect 改为依赖 active（变 active 时聚焦，失败降级聚焦本层根节点 `tabIndex=-1`）；其余复用 `document.contains`；**不建 `workspaceFocus.ts`**（D8/M3）；实现前完成 mount-time effect 前置检查单。
- 每工作区独立 right/bottom Presence。
- feature 与 standalone 覆盖而不卸载 workbench；`ConnectionDialogs` 保持在 stage 外正常流；`<StatusBar />` 在 `<main>` 外；**`baseShellActive` 与 `baseActive` 分离，feature 外层 tab 激活时 Tab 条保持可交互**（H4）。
- **hydration tombstone 单机制**：`forget` 清 `loading`/`pendingBrowser`/`pendingTitles` 并写 tombstone；`ensure` 查 tombstone；重开清 tombstone；**不做 generation，`syncBrowserTabs` 维持现状**（D4）。
- **selector 收敛（`useShallow`）+ `React.memo`**（M5）。
- **拖拽 / pointer capture 取消**（4.10 第 1 条；删除 mutation 校验，D9）。
- **关闭含 browser tab 的外层 Tab 时扩展确认文案**（复用既有 `confirmDocumentChanges`，D13）。
- `BrowserView` 最小增量改动（消费 Context 做音频恢复、`data-browser-tab-id`、`destroyed` 上报），**不新增占位分支，不改 `registry.tsx`，不改 `Dock.tsx` 语义**（D1/D6）。
- 远程工作区保持 transient 渲染，且使用完整 visible 判据。
- 关闭 outer / browser tab 全关（带去抖）后释放；**G22 验证旧 `webContents` destroyed**。
- **多窗口不新增机制**：维持既有 bind 语义（新 bind `release()` 旧绑定）；`ownerWindowId` 整体移出 MVP（D1）。
- **1 个单脚本 E2E**（`scripts/e2e-webcontents-stable.mjs`），不建 harness 全家桶（D10）。
- 通过 9.3 全部 **Block** 级 Gate（G12 / G19 已移出，G22 / G23 在列）。

### 10.2 完整版项目

1. resident 数量与 Electron 进程内存观测的常驻采集。
2. `discarded` BrowserTabStatus 与主动 release 后再销毁 guest 的 suspend 协议。
3. Agent owner 页面豁免与「已为节省内存重新加载」用户可见状态。
4. **per-tab 静音偏好持久化**：MVP 已恢复「失活前运行时值」（D6），完整版进一步记录**跨会话的用户静音偏好**并在激活时恢复（见 4.8.3）。
5. **后台节流策略**：若产品要求后台不节流，按 4.8.4 的开启/恢复时机实现，并由 G6 定标。
6. guest 侧无障碍处理（注入 `aria-hidden` 或等效手段）。
7. 远程工作区连接租约与后台常驻。
8. 多窗口唯一所有权的完整形态：`ownerWindowId` + 非 owner 占位 + 接管（v3 原案，含 owner 迁移 UI、跨窗口接管提示；MVP 已整体移出，见 2.3.1 / 4.11）。
9. 页面级而非工作区级的保活/驱逐（含 LRU 的前提：先有真实内存数据）。
10. 跨 DockGroup 移动不重建 guest（方案 B）。
11. 显式 pin-to-resident（用户标记常驻）。

### 10.3 迁移到方案 B 的触发条件

满足任一条件时，考虑 renderer 全局 `<webview>` 池：

- profiler 证明主要额外成本来自常驻聊天、文档、xterm，而非 webContents 本身（G11/G15 数据支撑）。
- resident 工作区数量通常较多且已触及 G11 阈值。
- xterm WebGL context 数量成为限制。
- 必须解决浏览器 Tab 跨 DockGroup 移动重建。
- 需要按浏览器页面而不是整个工作区进行独立 discard。

### 10.4 迁移到方案 C 的触发条件

满足以下产品要求时，才考虑主进程 `WebContentsView`：

- renderer 刷新/HMR/崩溃后页面仍必须存活。
- Agent 必须在没有任何 renderer 工作区槽位时创建和操作可视浏览器。
- 页面运行时需要由主进程统一控制。
- 团队愿意同时处理原生 View 覆盖、bounds 同步、Dialog/DropOverlay、CUA 指示器和多窗口所有权。

`WebContentsView` 不是降低浏览器页面内存的手段；只要页面运行时保持存活，Chromium webContents 的主要成本仍然存在。

---

## 11. 未决问题

1. **远程工作区是否需要保活**：MVP 排除所有非本地工作区的后台常驻（仅活动时 transient 渲染）。若要保活，必须先定义 activation ticket 能否在后台长期持有。`src/renderer/src/stores/window.ts:219-252`。**待确认**。

2. **standalone feature 是否纳入 MVP**：**已定案 —— 纳入**（见 4.4.2）。此项不再属于未决问题。

3. **resident / stage 数量硬上限**：**已定案（MVP）**——采用模块级常量 `MAX_RESIDENT = 3`（D5）。是否按设备/产品可调、上限取值是否需按 G11 定标调整：**待确认**。

4. **去抖窗口取值**：`residentExitDebounceMs` 初值 300ms 为经验值，需按一次 `browser:changed` 广播批次 + 一帧的实际时长调整（G2/G11）。**待确认**。

5. **owner 接管的竞争与可见性（完整版）**：owner 窗口关闭后 tab 变「无主」，若两个窗口同时 bind，谁接管（先到先得是否可接受、是否需要 UI 提示）。v3 原案为「先到先得、无需确认」；MVP 已整体移出（D1）。**待确认（完整版）**。

6. **主进程 owner 状态的观测通道（完整版）**：MVP 无 owner 机制（D1），本项随之移入完整版。完整版若需观测 `BoundPage.ownerWindowId`，是否开 dev-only 调试 IPC 或扩展 `browser:bind` 的 res：**待确认**。

7. **多窗口是否允许同时显示同一 BrowserTab（完整版）**：v3 原案只允许 owner 显示、非 owner 显示占位；MVP 不做占位（res 为 void，D1）。产品是否接受「第二窗口看不到该页面内容」：**待确认**。

8. **后台 browser 事件的内存治理**：MVP 维持 `syncBrowserTabs` 现状（缺失 ws 仍 `ensure`），不引入 pending-only（D4），因此不存在 pending 无界增长路径。若完整版再引入延迟水合，需同时定义 pending 清理时机与上限：**待确认（完整版）**。

9. **隐藏 webview 的节流与可见性**：MVP 明确接受后台 guest timer 被节流。产品是否接受「后台页面的轮询/动画/心跳变慢甚至暂停」（例如长连接保活失败）：**待确认**。

10. **音频策略**：MVP 失活强制静音、激活恢复失活前运行时值（D6）；跨会话的 per-tab 静音偏好持久化属完整版。是否需要用户可配置「后台保持音频」：**待确认**。

11. **关闭外层工作区后 `BrowserManager` 元数据是否继续保留**：`WindowStore.close()` 只 `forget()` renderer tabs（`src/renderer/src/stores/window.ts:424-455`）；删除工作区记录才调用 `browserManager.closeWorkspace()`（`src/main/ipc/index.ts:350-353`）。是否需要独立的「关闭 UI runtime，但保留持久化布局」协议：**待确认**。

12. **guest 侧无障碍残留**：取决于 G8 实测。若确认违规，MVP 是否接受并在完整版修复：**待确认**。

13. **正式 telemetry 接入**：MVP 用开发日志/profiler；正式 telemetry 的采样频率、隐私范围和存储位置：**待确认**。

14. **诊断观测接入点**：`app.getAppMetrics()` / `webContents.getProcessMemoryInfo()` 的接入位置与采样频率仓库内无现成路径：**待确认**（G11 需要一次性定标数据）。

15. **E2E 是否进 CI**：Electron 在无头/CI 环境跑真实 webview 与 GPU 的可行性未验证（9.4.1）：**待确认**。

16. **文件行菜单 / `OpenWithMenu` 是否属 workspace 内**：决定是否纳入 `useWorkspaceActive()`（4.7.3）。**待确认**。

17. **`plugin-ui/view.tsx:155` 的 `appendChild` 到 body**：不走 React portal，不受 Context 约束。插件视图是否只在工作区 Dock 内渲染，从而需要额外治理：**待确认**。

18. **resident 是否扩展到「无 browser tab 但用户显式标记保活」的工作区**：当前不支持（只有 transient）。是否加显式 pin-to-resident：**待确认**（属完整版）。

19. **`seq` 顺序表的遗忘策略**：4.1.4 的 `Map<workspaceId, seq>` 随工作区首次进入 stage 单调增长，若长期运行且工作区反复开关，是否需要随 tombstone 清除同步 `delete`：**待确认**（当前实现为不清除，属已知简化）。

---

## 关键文件索引

**Renderer · shell / 结构**

- `src/renderer/src/main.tsx:4`：唯一全局样式入口 `import './styles/theme.css'`（新增隔离规则落点）。
- `src/renderer/src/main.tsx:11-29`：`StrictMode` 与 I18nProvider 包裹（影响 mount 计数测试）。
- `src/renderer/src/App.tsx:89-93`：`browser:changed` 全窗口同步入口。
- `src/renderer/src/App.tsx:222`：`useMemo(() => new Set(runIndex...), [runIndex])`（run 变化即换新 Set，勿沿 props 链传入层，D2）。
- `src/renderer/src/shell/AppShell.tsx:98-115`：AppShell 对 window/tabs store 的当前订阅（v3.1 需收敛；`115` 行 `ensureTabs` 已用 selector，其余全量）。
- `src/renderer/src/shell/AppShell.tsx:214-216`：当前 sidebar/right/bottom Presence。
- `src/renderer/src/shell/AppShell.tsx:218`：activeOuter 的 `outer.find(activeOuterId)`。
- `src/renderer/src/shell/AppShell.tsx:218-220`：activeOuter、active workspace 和 panel toggle。
- `src/renderer/src/shell/AppShell.tsx:269-273`：活动工作区触发内层 tabs 水合。
- `src/renderer/src/shell/AppShell.tsx:406-413`：关闭外层 Tab 前确认及资源释放入口。
- `src/renderer/src/shell/AppShell.tsx:497-611`：`<main>` 整体区域（v3 统一引用）。
- `src/renderer/src/shell/AppShell.tsx:498-505`：standalone feature 分支（直接替换整块）。
- `src/renderer/src/shell/AppShell.tsx:506-609`：else 基础 shell。
- `src/renderer/src/shell/AppShell.tsx:515-591`：外层 Tab 条（带 `app-drag`）。
- `src/renderer/src/shell/AppShell.tsx:597-607`：content 区（v3 统一引用）。
- `src/renderer/src/shell/AppShell.tsx:598-599`：`activeOuter.kind==='feature'` → `FeatureView`。
- `src/renderer/src/shell/AppShell.tsx:600-603`：空态判据 `workspace === undefined || activeWorkspaceId === null`。
- `src/renderer/src/shell/AppShell.tsx:604-606`：当前单工作区 `<DockRoot>` 渲染点。
- `src/renderer/src/shell/AppShell.tsx:605`：`fallbackModel` 内联创建（需 `useMemo`）。
- `src/renderer/src/shell/AppShell.tsx:610`：`<ConnectionDialogs>` 位置（保持在 stage 外）。
- `src/renderer/src/shell/AppShell.tsx:618`：`<StatusBar />`（在 `<main>` 之外，不受 stage 叠层影响）。
- `src/renderer/src/shell/FeatureFrame.tsx:64-78`（根为 `:71`）：feature 页根 `flex min-h-0 flex-1 flex-col`。
- `src/renderer/src/shell/ConnectionDialogs.tsx:37-50`：连接状态条（正常流元素，自身 `shrink-0`）。
- `src/renderer/src/styles/theme.css:502-507`：`.app-drag` / `.app-no-drag`（`-webkit-app-region` 可继承）。
- `src/renderer/src/shell/WorkspaceDockLayer.tsx`：**v3.1 新增**（模块级 + memo + Context Provider；append-only `seq` 顺序表并入本文件，**不单独建 `layerOrder.ts`**）。
- `src/renderer/src/shell/workspace-active.tsx`：**v3.1 新增**（`WorkspaceActiveContext` + `useWorkspaceActive`）。

**Renderer · Dock / 视图分发 / 浏览器**

- `src/renderer/src/shell/Dock.tsx:20-37`：DockRoot、结构投影及 root key（不改）。
- `src/renderer/src/shell/Dock.tsx:60-69`、`60-150`：split live/ghost/absent 与动画。
- `src/renderer/src/shell/Dock.tsx:62-65`、`131-149`：`absent` 分支不渲染（内层保活的边界）。
- `src/renderer/src/shell/Dock.tsx:166-175`：DragZone 的 document 监听。
- `src/renderer/src/shell/Dock.tsx:206-239`、`211-239`：Dock tab 拖放。
- `src/renderer/src/shell/Dock.tsx:291-315`：内层浏览器 Tab 保活（opacity + pointer-events）。
- `src/renderer/src/shell/Dock.tsx:307-311`：注释说明销毁 guest 会断开 CDP target。
- `src/renderer/src/shell/Dock.tsx:320-327`：DropOverlay。
- `src/renderer/src/shell/Dock.tsx:334-347`：splitter 的 `setPointerCapture`。
- `src/renderer/src/shell/dock-layout.ts:17-29`、`17-42`：Dock 可见性和 `edgeHidden` 判定。
- `src/renderer/src/lib/usePresence.ts:22-36`：Presence 状态定义。
- `src/renderer/src/lib/usePresence.ts:39-81`、`73-78`：Presence 开合与延迟卸载。
- `src/renderer/src/views/registry.tsx:84-98`：`InnerViewProps` 定义（无 active 字段，不改）。
- `src/renderer/src/views/registry.tsx:100-105`、`100-163`：`InnerView` 分发边界。
- `src/renderer/src/views/registry.tsx:157-158`：browser 分支 `<BrowserView tab workspace/>`。
- `src/renderer/src/views/browser/BrowserView.tsx:50-58`：本地状态不重建。
- `src/renderer/src/views/browser/BrowserView.tsx:66-82`：Manager 对账 effect。
- `src/renderer/src/views/browser/BrowserView.tsx:84-141`：`did-attach` 与导航监听。
- `src/renderer/src/views/browser/BrowserView.tsx:242-260`：实际 `<webview>` 元素（v3.1 改：音频恢复失活前值、`data-browser-tab-id`、`destroyed` 上报；**不新增占位分支**）。
- `src/renderer/src/views/browser/BrowserView.tsx:251-258`：`src` 与 partition 来源。
- `src/renderer/src/views/browser/BrowserView.tsx:262-280`：CUA 指针层。
- `src/renderer/src/views/browser/BrowserFeature.tsx:39-40`：`BrowserView` 直接 `useWindowStore` 读状态的先例。
- `src/renderer/src/views/chat/Composer.tsx:357-370`、`368-370`：挂载即聚焦及其「挂载即可见」不变量。
- `src/renderer/src/views/chat/Composer.tsx:386-427`、`644-652`：modes/skills 订阅与自定义事件监听。
- `src/renderer/src/views/chat/ChatView.tsx:12`、`109`：`useShallow` 先例。
- `src/renderer/src/views/chat/ChatView.tsx:108-129`、`164`、`198`、`432-489`：per-session store 订阅与 effects。
- `src/renderer/src/views/chat/Thread.tsx:145-166`：Thread 的 ResizeObserver。
- `src/renderer/src/views/files/FilesView.tsx:278-297`：文件树的全局事件订阅与刷新。
- `src/renderer/src/views/files/DocumentView.tsx:97`：CodeMirror。
- `src/renderer/src/views/terminal/TerminalView.tsx:74-143`：xterm、WebGL、ResizeObserver 和事件订阅。
- `src/renderer/src/views/terminal/TerminalView.tsx:145-175`：终端从 buffer 恢复。
- `src/renderer/src/views/terminal/TerminalView.tsx:200-212`：终端视图卸载清理。
- `Thread.tsx:145`、`ChatView.tsx:164/198`、`MentionInput.tsx:108`、`TerminalView.tsx:74`、`FilesView.tsx:216/237/278`：mount-time effect 高危候选（4.9 前置检查单，D8）。
- `src/renderer/src/views/plugins/PluginWebAppView.tsx:116-138`：插件 webapp 的独立 `<webview>`。
- `src/renderer/src/shell/PluginViewFrame.tsx:236`：插件 iframe。

**Renderer · portal 与 Context**

- `src/renderer/src/components/ui/Dialog.tsx:98`、`142`：Dialog portal 到 body（**纳入**）。
- `src/renderer/src/components/ui/ContextMenu.tsx:132`、`154`：ContextMenu portal（**纳入**；document keydown/pointerdown 见 `:120-128`）。
- `src/renderer/src/components/ui/Submenu.tsx:75`、`96`：Submenu portal（**完整版纳入**）。
- `src/renderer/src/components/ui/Select.tsx:91`：Radix Select Portal（**纳入**）。
- `src/renderer/src/components/ui/ToastViewport.tsx:96`、`115`（**app 级，不纳入**）。
- `src/renderer/src/components/ui/Tooltip.tsx:155`、`191`（**v3.1 纳入**：trigger 大量位于 Dock 子树内）。
- `src/renderer/src/components/ProviderModelMenu.tsx:182`、`197`（**完整版纳入**）。
- `src/renderer/src/shell/WindowControls.tsx:54`、`108`（**app 级，不纳入**）。
- `src/renderer/src/shell/UpdateIndicator.tsx:218`、`302`（**app 级，不纳入**）。
- `src/renderer/src/shell/SearchPalette.tsx:166`、`267`（**app 级，不纳入**）。
- `src/renderer/src/views/chat/ImageLightbox.tsx:134`、`223`：灯箱 portal（**纳入**）。
- `src/renderer/src/views/chat/ImageLightbox.tsx:97-128`：`restoreRef` + `document.contains(el)` 失效判据（焦点恢复先例）。
- `src/renderer/src/views/chat/TurnNavigationRail.tsx:94`、`112`（**完整版纳入**）。
- `src/renderer/src/shell/InnerTabBar.tsx:386-472`：内层 Tab 右键 ContextMenu。
- `src/renderer/src/shell/InnerTabBar.tsx:234`：`useRunIndex` 精确订阅落点（runningSessionIds，D2）。
- `src/renderer/src/plugin-ui/view.tsx:155`：直接 `appendChild` 到 body（不走 portal，**待确认**）。
- `src/renderer/src/i18n/index.tsx:4181`：模块级 Context Provider 范式先例。
- `src/renderer/src/components/markdown/MarkdownProvider.tsx:32`：模块级 Context Provider 范式先例。

**Renderer · stores**

- `src/renderer/src/stores/window.ts:1-12`：activeWorkspaceId 与外层功能视图的关系。
- `src/renderer/src/stores/window.ts:26-60`：outer、active、standalone 和 panel 状态字段。
- `src/renderer/src/stores/window.ts:27`、`36`、`37`、`39`、`46`：`workspaceTargets` / `outer` / `activeOuterId` / `activeWorkspaceId` / `activeStandaloneFeature`。
- `src/renderer/src/stores/window.ts:55-60`：`rightPanelOpenByWorkspace` / `bottomPanelOpenByWorkspace`。
- `src/renderer/src/stores/window.ts:215-218`、`219-252`：`needsPrepare` 与远程激活流程。
- `src/renderer/src/stores/window.ts:308-333`：窗口状态水合（不去重 outer）。
- `src/renderer/src/stores/window.ts:341-356`、`341-364`、`341-365`：切换外层 Tab 与 panel 恢复。
- `src/renderer/src/stores/window.ts:367-394`：`openWorkspace`（v3 统一引用）。
- `src/renderer/src/stores/window.ts:396-407`、`396-422`、`420-422`：standalone feature。
- `src/renderer/src/stores/window.ts:424-455`：关闭外层工作区及 `forget`。
- `src/renderer/src/stores/window.ts:466-479`：outer 移动与 pin（会触发 DOM 重排）。
- `src/renderer/src/stores/window.ts:486-500`、`502-510`、`513-537`：每工作区 right/bottom panel 状态写入路径。
- `src/renderer/src/stores/tabs.ts:173`：`byWorkspace` 字段定义。
- `src/renderer/src/stores/tabs.ts:387`：`dockCache`。
- `src/renderer/src/stores/tabs.ts:474-480`：`write`（整表浅拷贝 + 单 ws 替换）。
- `src/renderer/src/stores/tabs.ts:483`、`484`、`488`：`loading` / `pendingTitles` / `pendingBrowser`。
- `src/renderer/src/stores/tabs.ts:497-522`：`loadOrSeed`（三分支，不校验工作区是否仍打开）。
- `src/renderer/src/stores/tabs.ts:525`：`byWorkspace` 初始值。
- `src/renderer/src/stores/tabs.ts:527`、`531`、`535`、`539`：`stateOf` / `tabsOf` / `activeIdOf` / `dockOf`（getter，非订阅切片）。
- `src/renderer/src/stores/tabs.ts:591-615`、`623-637`：Dock 结构变更与 tab 移动。
- `src/renderer/src/stores/tabs.ts:635-637`：`resizeDock` 高频写入。
- `src/renderer/src/stores/tabs.ts:640-654`、`1004-1016`：关闭 tab 的终端/浏览器清理。
- `src/renderer/src/stores/tabs.ts:1010-1013`：关闭 Tab 才 kill PTY。
- `src/renderer/src/stores/tabs.ts:679-686`：`hydrate`（**无生产调用方，仅测试使用**；v3.1 不加 generation 校验）。
- `src/renderer/src/stores/tabs.ts:688-710`：`ensure`（全局 `loading` Set + `finally`）。
- `src/renderer/src/stores/tabs.ts:1093-1193`：`syncBrowserTabs`（v3 统一引用）。
- `src/renderer/src/stores/tabs.ts:1094-1098`：缺失 ws → 存 pending + `ensure` + return。
- `src/renderer/src/stores/tabs.ts:1100`：`remoteIds`（prune 依赖）。
- `src/renderer/src/stores/tabs.ts:1147-1159`：push。
- `src/renderer/src/stores/tabs.ts:1162-1168`：prune。
- `src/renderer/src/stores/tabs.ts:1184`：整段 `write`。
- `src/renderer/src/stores/tabs.ts:1249-1264`：`forget`（不清 loading/pending）。

**Shared / 契约 / 主进程**

- `src/shared/domain/tab.ts:12-14`：外层 workspace/feature Tab 类型。
- `src/shared/domain/browser.ts:7-9`、`7-32`、`8`：BrowserTabStatus 与 BrowserTab。
- `src/shared/domain/browser.ts:16-32`：`owner` 字段段位。
- `src/shared/domain/browser.ts:21-22`：`ownerRunId` / `ownerSessionId`。
- `src/shared/domain/browser.ts:68-69`：工作区/Profile partition。
- `src/shared/domain/environment.ts:140-142`：本地环境判定。
- `src/shared/ipc/contract.ts:475`：`'browser:bind'` 契约（**v3.1 不改**；res 为 `void`，故非 owner 占位做不出来）。
- `src/preload/index.ts:37-42`：preload 类型由 contract 泛型自动派生（**v3.1 不改**）。
- `src/main/window/registry.ts:28-32`：`WindowContext { id; kind; sender }`，`id = sender.id`。
- `src/main/window/registry.ts:116-141`：每窗口活动工作区记录。
- `src/main/state/store.ts:630`：`outerTabKey(windowKind)` 按 kind 分库。
- `src/main/ipc/index.ts:350-353`：删除工作区记录时清理 BrowserManager。
- `src/main/ipc/index.ts:394-398`：`browser:bind` handler（现状只解构 `req`；完整版若需 owner 才加 `ctx`）。
- `src/main/ipc/index.ts:410`、`433`：显式清理 partition storage 的调用点。
- `src/main/ipc/index.ts:943`：BrowserManager 变更 reconcile 和全窗口广播。
- `src/main/ipc/app.ts:78-85`：bootstrap 按 windowKind 读取 outer 状态。
- `src/main/browser/bindings.ts:25-29`：`BoundPage`（**完整版**才加 `ownerWindowId`）。
- `src/main/browser/bindings.ts:107`：`pages` 容器。
- `src/main/browser/bindings.ts:117-201`：`bindIab`（**完整版**才加 owner 入参与校验）。
- `src/main/browser/bindings.ts:122-132`：现有校验段（完整版 owner 校验落点）。
- `src/main/browser/bindings.ts:133-138`、`133-140`、`139`：单绑定语义与 `release()` 旧绑定。
- `src/main/browser/bindings.ts:148-151`、`148-180`、`162-170`：viewport / screenshot / CDP handle。
- `src/main/browser/bindings.ts:177-181`：entry 赋值（**完整版**才写入 owner）。
- `src/main/browser/bindings.ts:183-188`、`183-201`：guest 销毁监听及绑定失败处理。
- `src/main/browser/bindings.ts:324-330`：主动 `release`。
- `src/main/browser/bindings.ts:360-367`、`360-379`、`370-373`、`376-379`：shutdown、`dropIfCurrent`、未绑定错误。
- `src/main/browser/manager.ts:87-94`、`87-100`、`92`：只保存元数据。
- `src/main/browser/manager.ts:239-258`：BrowserTab claim 与 owner。
- `src/main/browser/manager.ts:260-275`：关闭 BrowserTab/工作区元数据。
- `src/main/browser/manager.ts:292-306`：作用域切换不清 Cookie。
- `src/main/browser/session.ts:109-110`：显式清理 partition storage。
- `src/main/plugin/host-window.ts:142`：`backgroundThrottling:false`（全仓唯一相关，插件宿主窗口，非 workspace guest）。
- `src/main/index.ts:288-299`：主窗口 webPreferences 与 `webviewTag: true`。
- `src/main/index.ts:421`：主窗口注册为 `main` kind。
- `src/main/index.ts:803-805`：创建额外主窗口。
- `src/main/index.ts:984-1000`：应用退出时关闭 BrowserBindings。

**测试与脚本**

- `src/renderer/src/views/chat/__tests__/chat-view.test.ts:1-3`：组件测试范式（`createRoot` / `act` / JSDOM）。
- `src/renderer/src/components/__tests__/open-with-menu.test.ts:18`：React `createRoot` 测试范式。
- `src/renderer/src/stores/__tests__/browser-isolation.test.ts:42-62`：工作区右侧面板隔离测试。
- `src/renderer/src/stores/__tests__/browser-navigation.test.ts:56-72`、`74-91`、`93-110`、`56-150`：standalone feature 状态测试。
- `src/main/browser/__tests__/bindings.test.ts:113-133`：guest 销毁后绑定失效测试。
- `scripts/office-editors-probe.mjs:35`、`120`：`playwright-core` + `_electron.launch` 的 Electron 进程探针先例。
- `src/renderer/src/shell/__tests__/workspace-dock-layer.test.ts`：**v3.1 新增**（命名统一）。
- `src/renderer/src/stores/__tests__/hydration-tombstone.test.ts`：**v3.1 新增**。
- `scripts/e2e-webcontents-stable.mjs`：**v3.1 新增**（单脚本，照抄 `office-editors-probe.mjs` 先例，不引入 Playwright test runner）。
