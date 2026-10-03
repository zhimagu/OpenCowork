/**
 * 工作区 workbench 层 —— 每个 resident / transient 工作区一个稳定槽位。
 *
 * ## 为什么必须是模块级组件
 *
 * ★ 定义在 `AppShell` 函数体内时，父级每次 render 都会得到一个新的组件类型，
 * React 会把整棵子树卸载重挂 —— `<webview>` 连同 guest `webContents` 一起销毁，
 * 与「切换工作区保活」的目标直接冲突。所以它独立成文件、模块级 + `React.memo`。
 *
 * ## props 只收原始值
 *
 * `workspaceId` / `active` / `transient` + fallback 模型的原始字段 + `maxOutputTokens`。
 * **不收 `workspace` 对象**（层内经 selector `s.workspaceTargets[workspaceId]` 按 id 取，
 * identity 天然稳定）、**不收 `runningSessionIds`**（那是一个每次 run 变化都换新引用的
 * Set，沿 props 链会击穿所有层的 memo；由实际消费组件 `InnerTabBar` 自行订阅）。
 *
 * ## 隐藏方式
 *
 * `absolute inset-0 + opacity-0 + pointer-events-none + inert + aria-hidden`。
 * 禁止 `display:none` / 零尺寸 / 条件渲染移除 resident 层 —— 那会让 guest 宿主尺寸
 * 归零或直接销毁 guest。
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InnerTabState } from '../../../shared/domain/tab'
import { cn } from '../lib/cn'
import { usePresence } from '../lib/usePresence'
import { useWindowStore } from '../stores/window'
import { DockRoot } from './Dock'
import type { FallbackModel } from '../views/chat/Composer'
import { WorkspaceActiveContext } from './workspace-active'

/** resident 数量硬上限（设计 §4.1.2 / v3.1 D5）。常量，非配置。 */
export const MAX_RESIDENT = 3

/**
 * 面板开合时长。**必须与 `AppShell` 的 `PANEL_MS` 同一个数** —— 侧边栏、右/底部
 * 两条 dock 边、内层 split 的动画是同一条曲线，只要有一条不同步看着就是「分好几批到位」。
 */
const PANEL_MS = 280

/**
 * append-only 顺序表（设计 §4.1.4 / H2）。
 *
 * ★ **resident 层的 DOM 顺序不得跟随 outer，也不得按 `workspace.id` 排序。**
 * outer 可 `move()` / `togglePin()` 重排；按 id 排序时新成员可能插到既有成员之前，
 * React 会 `insertBefore` **移动**含 `<webview>` 的祖先节点 —— 而移动含 webview 的
 * DOM 在 Electron 无官方契约保证 guest 不 detach。append-only 保证既有节点只发生
 * appendChild，永不移动。
 *
 * ★ **seq 复用是安全的**：关闭后重开同一工作区沿用旧 seq。重开时它是全新挂载的
 * 节点，只会以新节点落地，不会移动任何既有含 `<webview>` 的祖先。
 *
 * ★ **map 写入发生在 `orderOf` 内**，而调用方（`AppShell`）把它包在 `useMemo` 里：
 * render 期副作用在并发渲染下可能被丢弃（React 可重放或放弃 render），把顺序表的
 * 惰性写入散落在 render 顶层会引入不确定性；放进 `useMemo` 后即使某次 render 被
 * 丢弃，也只是个别 id 提前占了一个 seq，**只影响顺序、不影响身份**，无害。
 *
 * ★ **seq 分配单点（H1）**：写入只发生在 `orderOf` 内（stage useMemo 是唯一调用方）。
 * `capResident` 通过下面的 `seqOfId` 只读查询，不再自己调 `orderOf` —— 两个写入方
 * 会让「谁先进入」的判定依赖调用顺序，且可能给本不该参与淘汰的 id 分配 seq。
 *
 * ponytail: 顺序表常驻内存，仅随工作区首次进入 stage 增长；若未来需要彻底遗忘，
 * 可在 tombstone 清除时同步 delete seq（未决问题 19）。
 */
const seqOf = new Map<string, number>()
let nextSeq = 0

/** 按「首次进入 stage 渲染集的插入顺序」升序返回；已在表中的复用原 seq。 */
export function orderOf(ids: readonly string[]): string[] {
  for (const id of ids) if (!seqOf.has(id)) seqOf.set(id, nextSeq++)
  return [...ids].sort((a, b) => seqOf.get(a)! - seqOf.get(b)!)
}

/**
 * 只读查询某 id 的 append-only seq（H1）。
 *
 * 未分配的返回 `MAX_SAFE_INTEGER`：它排最后，**不会成为淘汰目标**（淘汰的是 seq 最小者）。
 * seq 分配的唯一写入点是 stage useMemo 里的 `orderOf`；`capResident` 只读这里，不再写。
 */
export function seqOfId(id: string): number {
  return seqOf.get(id) ?? Number.MAX_SAFE_INTEGER
}

/** 已水合的工作区里是否还存在 `kind === 'browser'` 的内层 Tab（resident 的必要条件）。 */
export function hasBrowserTab(state: InnerTabState | undefined): boolean {
  return state !== undefined && state.tabs.some((tab) => tab.kind === 'browser')
}

/**
 * resident 数量硬上限降级（设计 §4.1.2 / v3.1 D5）。
 *
 * 可见工作区永远保留、不参与淘汰；其余按 append-only seq 升序，**移出 seq 最小者**
 * （保留 seq 最大的若干）。被移出者沿用旧 seq，重新成为 resident 后仍是 seq 最小、
 * 下次优先被移出 —— 这是「不做 LRU」论证成立的真前提。
 *
 * ★ **H1：这里只读 `seqOfId`，不调用 `orderOf`。** seq 分配的唯一写入点收敛在
 * stage useMemo 的 `orderOf`，避免出现第二个写入方。未分配 seq 的 id 视为最新、
 * 排最后，因此**不会成为淘汰目标**（淘汰的是 seq 最小者）。
 *
 * 措辞：这里做的是「移出 stage 渲染集（卸载）」，不是「降级为 transient」——
 * transient 的定义是「仅因当前活动而渲染」，被移出者本就非可见，两者不等价。
 */
export function capResident(stable: ReadonlySet<string>, visibleId: string | null): ReadonlySet<string> {
  if (stable.size <= MAX_RESIDENT) return stable
  const ordered = [...stable].sort((a, b) => seqOfId(a) - seqOfId(b)) // seq 升序；只读，不写
  const visible = visibleId !== null && stable.has(visibleId) ? visibleId : null
  const evictable = ordered.filter((id) => id !== visible)
  const keep = Math.max(0, MAX_RESIDENT - (visible === null ? 0 : 1))
  const kept = new Set<string>(evictable.slice(Math.max(0, evictable.length - keep)))
  if (visible !== null) kept.add(visible)
  return kept
}

/**
 * resident 候选集的进入/移出双向去抖。候选集只在**成员真正变化**时才重排
 * （用排序后 join 出的 key 做依赖，避免每次 render 新 Set 触发 effect）。
 *
 * ★ **B1：effect 只随候选集成员变化（`key`）重跑；committed 推进不重跑**，
 * 避免计时器被无关提交打断 —— 否则 resident 的提交时机取决于 committed 的变化
 * 历史，而不是候选集自身的稳定窗口。已提交集通过 `committedRef` 读最新值，
 * 不进依赖数组。
 *
 * 计时器随卸载清理（设计 §4.1.5 规则 4）。去抖窗口内该层保持挂载。
 */
export function useResidentDebounce(candidates: ReadonlySet<string>, ms: number): ReadonlySet<string> {
  const [committed, setCommitted] = useState<ReadonlySet<string>>(() => new Set<string>())
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  const committedRef = useRef(committed)
  committedRef.current = committed
  const key = useMemo(() => [...candidates].sort().join('|'), [candidates])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const target = candidatesRef.current
    const current = committedRef.current
    // 先按最新候选集修正挂起中的计时器：
    // - 未提交且已离开候选 → 取消「进入」计时器
    // - 已提交且回到候选 → 取消「移出」计时器
    for (const [id, timer] of timers.current) {
      const inTarget = target.has(id)
      const isCommitted = current.has(id)
      if ((!isCommitted && !inTarget) || (isCommitted && inTarget)) {
        clearTimeout(timer)
        timers.current.delete(id)
      }
    }
    // 进入：需在窗口内稳定持有 browser tab 才计入 resident
    for (const id of target) {
      if (current.has(id) || timers.current.has(id)) continue
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id)
        setCommitted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }, ms))
    }
    // 移出：窗口内重新出现则取消（browser:changed 分批导致的闪回）
    for (const id of current) {
      if (target.has(id) || timers.current.has(id)) continue
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id)
        setCommitted((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, ms))
    }
  }, [key, ms])

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  return committed
}

export const WorkspaceDockLayer = memo(function WorkspaceDockLayer(props: {
  workspaceId: string
  active: boolean
  transient?: boolean
  /** 应用级默认模型的原始字段（在层内 useMemo 成 FallbackModel，稳定引用）。 */
  fallbackModelId: string
  fallbackModelProviderId?: string
  maxOutputTokens: number
}): ReactNode {
  /*
    ★ 层内按 id 取 workspace：`workspaceTargets` 只在 `workspace:changed` 时换引用，
    selector 结果引用稳定（0.2.1 B1 行）。workspace 为 undefined 时由 stage 渲染集
    保证不会出现，这里只兜底。
  */
  const workspace = useWindowStore((s) => s.workspaceTargets[props.workspaceId])

  /*
    ★ 每个工作区独立的 right/bottom panel 状态（设计 §4.3.4）。
    活动工作区用投影 `rightPanelOpen`，后台工作区用 `rightPanelOpenByWorkspace`。
    兼容所有现有写入路径（当前区按钮切换 / 后台定向设置）。
  */
  const rightOpen = useWindowStore((s) =>
    s.activeWorkspaceId === props.workspaceId ? s.rightPanelOpen : s.rightPanelOpenByWorkspace[props.workspaceId] ?? false
  )
  const bottomOpen = useWindowStore((s) =>
    s.activeWorkspaceId === props.workspaceId ? s.bottomPanelOpen : s.bottomPanelOpenByWorkspace[props.workspaceId] ?? false
  )
  // ★ Presence 状态必须每层独立：共享会把隐藏层的 edge 分支误判为 absent 而卸载 webview。
  const right = usePresence(rightOpen, PANEL_MS)
  const bottom = usePresence(bottomOpen, PANEL_MS)

  const fallbackModel = useMemo<FallbackModel>(
    () => ({ model: props.fallbackModelId, modelProviderId: props.fallbackModelProviderId }),
    [props.fallbackModelId, props.fallbackModelProviderId]
  )

  // ★ Provider 挂在 layer 根：Context 跨 createPortal 生效，失活时浮层走自身 dismiss。
  const activeCtx = useMemo(
    () => ({ workspaceId: props.workspaceId, active: props.active }),
    [props.workspaceId, props.active]
  )

  // outer 已移除的兜底：stage 渲染集由 outer ∩ byWorkspace 推导，正常不会走到这里。
  if (workspace === undefined) return null

  return (
    <WorkspaceActiveContext.Provider value={activeCtx}>
      <div
        data-workspace-layer-id={props.workspaceId}
        data-workspace-active={props.active ? 'true' : 'false'}
        data-workspace-transient={props.transient === true ? 'true' : 'false'}
        aria-hidden={props.active ? undefined : true}
        /* inert 只作 embedder 侧兜底（Tab 顺序、焦点、文本选择），不跨 OOPIF 覆盖 guest；
            guest 的隔离由 theme.css 的 [data-workspace-active='false'] webview 规则承担。 */
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
          fallbackModel={fallbackModel}
          maxOutputTokens={props.maxOutputTokens}
        />
      </div>
    </WorkspaceActiveContext.Provider>
  )
})
