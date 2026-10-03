/**
 * WorkspaceDockLayer —— stage 推导纯函数 + React 挂载身份（设计 §9.2.1 / §9.2.2）。
 *
 * ## 能单测什么 / 不能单测什么
 *
 * 本文件覆盖 `WorkspaceDockLayer.tsx` 导出的纯函数 `orderOf` / `hasBrowserTab` /
 * `MAX_RESIDENT` / `capResident` / `seqOfId`、hook `useResidentDebounce`，以及
 * 「模块级组件 + memo + 相同 key 不重挂载」的 React 语义。
 *
 * ★ `capResident` / `useResidentDebounce` 原先是 AppShell 的组件内闭包，为修复
 * B1/H1 已整体搬到 `WorkspaceDockLayer.tsx` 并导出（可测纯逻辑/hook，不是 AppShell
 * 私有物）。AppShell 里真正的 stage 推导（resident = outer ∩ byWorkspace ∩ local ∩
 * hasBrowserTab、水合三态）仍由 9.1 手动场景 + 9.4 Electron 探针覆盖
 * （webContentsId 稳定性、guest 不 detach 本就不是 JSDOM 能证明的）。
 *
 * ## 模块级 seq 状态
 *
 * `orderOf` 的 `seqOf` / `nextSeq` 是模块级单例，跨用例残留。本文件不导出重置手段
 * （任务禁止为测试改生产文件），因此**每个 orderOf 用例使用互不重叠的 id 前缀**，
 * 只断言相对顺序、不断言绝对 seq。
 */
import { StrictMode, act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InnerTab, InnerTabState } from '../../../../shared/domain/tab'
import { DEFAULT_WORKSPACE_SETTINGS, type Workspace } from '../../../../shared/domain/workspace'

/*
  stores/window 会连带 import tabs store 与 service 层。与既有 store 测试同一套 mock
  （见 stores/__tests__/browser-isolation.test.ts / hydration-tombstone.test.ts）。
*/
vi.mock('../../services/app', () => ({
  getInnerTabs: vi.fn(),
  persistInnerTabs: vi.fn(),
  persistOuterTabs: vi.fn()
}))
vi.mock('../../services/browser', () => ({
  closeBrowserTab: vi.fn(async () => undefined)
}))
vi.mock('../../services/terminal', () => ({
  killTerminal: vi.fn(async () => undefined)
}))

/*
  DockRoot 会把整条 registry / BrowserView / xterm 依赖链拉进来，而本文件只关心
  「层这个槽位的 React 身份」。这里把它替换成一颗探针：每个 workspace 的探针子树
  mount / unmount 各记一次，用来证明层没有重挂载。探针组件在工厂闭包里定义一次，
  组件类型稳定，不会因为 DockRoot 重渲染而自己重挂载。
*/
const probe = vi.hoisted(() => ({
  mounts: new Map<string, number>(),
  unmounts: new Map<string, number>()
}))

vi.mock('../Dock', async () => {
  const React = await import('react')
  const Probe = ({ id }: { id: string }): ReactNode => {
    React.useEffect(() => {
      probe.mounts.set(id, (probe.mounts.get(id) ?? 0) + 1)
      return () => {
        probe.unmounts.set(id, (probe.unmounts.get(id) ?? 0) + 1)
      }
    }, [id])
    return React.createElement('span', { 'data-dock': id })
  }
  const DockRoot = ({ workspace }: { workspace: Workspace }): ReactNode =>
    React.createElement(Probe, { id: workspace.id })
  return { DockRoot }
})

import { MAX_RESIDENT, WorkspaceDockLayer, capResident, hasBrowserTab, orderOf, seqOfId, useResidentDebounce } from '../WorkspaceDockLayer'
import { useWindowStore } from '../../stores/window'

const windowInitial = useWindowStore.getState()

const ws = (id: string): Workspace => ({
  id,
  name: id,
  rootPath: `/tmp/${id}`,
  settings: DEFAULT_WORKSPACE_SETTINGS,
  createdAt: 1,
  lastOpenedAt: 1
})

const chat = (id: string): InnerTab => ({
  id,
  kind: 'chat',
  pane: 'main',
  title: 'Chat',
  ref: { sessionId: `session-${id}` }
})

const browser = (id: string): InnerTab => ({
  id,
  kind: 'browser',
  pane: 'main',
  title: 'Browser',
  ref: { url: 'https://example.com/' }
})

const state = (tabs: InnerTab[]): InnerTabState => ({ tabs, activeTabId: tabs[0]?.id ?? null })

beforeEach(() => {
  probe.mounts.clear()
  probe.unmounts.clear()
  useWindowStore.setState(windowInitial, true)
})

describe('MAX_RESIDENT', () => {
  it('是常量 3（设计 §4.1.2 / D5）', () => {
    expect(MAX_RESIDENT).toBe(3)
  })
})

describe('hasBrowserTab', () => {
  it('undefined（未水合）→ false', () => {
    expect(hasBrowserTab(undefined)).toBe(false)
  })

  it('只有 chat / terminal → false', () => {
    expect(hasBrowserTab(state([chat('c1')]))).toBe(false)
    expect(hasBrowserTab(state([chat('c1'), chat('c2')]))).toBe(false)
  })

  it('存在 kind === browser → true', () => {
    expect(hasBrowserTab(state([browser('b1')]))).toBe(true)
    expect(hasBrowserTab(state([chat('c1'), browser('b1')]))).toBe(true)
  })

  it('空 tabs → false', () => {
    expect(hasBrowserTab(state([]))).toBe(false)
  })
})

describe('orderOf append-only 顺序', () => {
  it('新增只 append；移除幸存者不重排；重新加入沿用旧 seq 插回原位', () => {
    // 前缀 ap- 独占本用例，避免与同文件其他 orderOf 用例的模块级 seq 相互污染。
    const input1 = ['ap-a', 'ap-b']
    expect(orderOf(input1)).toEqual(['ap-a', 'ap-b'])
    // 不修改入参
    expect(input1).toEqual(['ap-a', 'ap-b'])

    expect(orderOf(['ap-a', 'ap-b', 'ap-c'])).toEqual(['ap-a', 'ap-b', 'ap-c'])

    // 移除 ap-b：幸存者 [ap-a, ap-c] 顺序不变，seq 不压缩。
    expect(orderOf(['ap-a', 'ap-c'])).toEqual(['ap-a', 'ap-c'])

    // 重新加入 ap-b：沿用旧 seq，插回 ap-a 与 ap-c 之间（证明 seq 未被压缩）。
    expect(orderOf(['ap-a', 'ap-c', 'ap-b'])).toEqual(['ap-a', 'ap-b', 'ap-c'])
  })

  it('顺序只由首次进入顺序决定，与传入顺序无关', () => {
    // 首次以乱序传入：分配顺序即首次出现顺序。
    expect(orderOf(['or-b', 'or-a', 'or-c'])).toEqual(['or-b', 'or-a', 'or-c'])
    // 后续任意排列都稳定回到 seq 升序，等价于 outer 重排后顺序不变。
    expect(orderOf(['or-c', 'or-a', 'or-b'])).toEqual(['or-b', 'or-a', 'or-c'])
    expect(orderOf(['or-b', 'or-c', 'or-a'])).toEqual(['or-b', 'or-a', 'or-c'])
  })

  it('空集返回空数组', () => {
    expect(orderOf([])).toEqual([])
  })
})

/* ───────────────────────── seqOfId / capResident（H1） ───────────────────────── */

describe('seqOfId 只读查询', () => {
  it('已分配返回原值、未分配返回 MAX_SAFE_INTEGER', () => {
    orderOf(['sq-a', 'sq-b']) // 分配 seq（等价 stage useMemo 的唯一写入点）
    const a = seqOfId('sq-a')
    const b = seqOfId('sq-b')
    expect(a).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(b).toBeLessThan(Number.MAX_SAFE_INTEGER)
    expect(a).toBeLessThan(b) // 首次出现顺序决定大小
    expect(seqOfId('sq-never-assigned')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('capResident MAX_RESIDENT 降级（只读 seq）', () => {
  it('4 个 resident 进入 → seq 最小且非可见者被移出，其余保留', () => {
    // 前缀 cap1- 独占，避免与同文件其他 orderOf 用例的模块级 seq 相互污染。
    orderOf(['cap1-a', 'cap1-b', 'cap1-c', 'cap1-d'])
    const kept = capResident(new Set(['cap1-a', 'cap1-b', 'cap1-c', 'cap1-d']), null)
    expect(kept.has('cap1-a')).toBe(false)
    expect([...kept].sort()).toEqual(['cap1-b', 'cap1-c', 'cap1-d'])
  })

  it('可见者永不淘汰（哪怕 seq 最小）', () => {
    orderOf(['cap2-a', 'cap2-b', 'cap2-c', 'cap2-d'])
    const kept = capResident(new Set(['cap2-a', 'cap2-b', 'cap2-c', 'cap2-d']), 'cap2-a')
    expect(kept.has('cap2-a')).toBe(true)
    expect(kept.has('cap2-b')).toBe(false)
    expect([...kept].sort()).toEqual(['cap2-a', 'cap2-c', 'cap2-d'])
  })

  it('未分配 seq 的 id（seqOfId=MAX_SAFE_INTEGER）不成为淘汰目标', () => {
    orderOf(['cap3-a', 'cap3-b', 'cap3-c'])
    const kept = capResident(new Set(['cap3-a', 'cap3-b', 'cap3-c', 'cap3-new']), null)
    expect(kept.has('cap3-new')).toBe(true) // 未分配 → 排最后 → 保留
    expect(kept.has('cap3-a')).toBe(false) // seq 最小者被淘汰
    expect([...kept].sort()).toEqual(['cap3-b', 'cap3-c', 'cap3-new'])
  })

  it('被移出者重进后沿用旧 seq、下次优先淘汰', () => {
    orderOf(['cap4-a', 'cap4-b', 'cap4-c', 'cap4-d'])
    const first = capResident(new Set(['cap4-a', 'cap4-b', 'cap4-c', 'cap4-d']), null)
    expect(first.has('cap4-a')).toBe(false)
    // 重新进入：沿用旧 seq（最小），仍优先被淘汰。
    const second = capResident(new Set(['cap4-b', 'cap4-c', 'cap4-d', 'cap4-a']), null)
    expect(second.has('cap4-a')).toBe(false)
    expect([...second].sort()).toEqual(['cap4-b', 'cap4-c', 'cap4-d'])
  })
})

/* ───────────────────────── React 挂载身份（§9.2.2） ───────────────────────── */

function setupDom(): { container: HTMLElement; root: Root; cleanup: () => Promise<void> } {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  const container = dom.window.document.getElementById('root') as unknown as HTMLElement
  const root = createRoot(container)
  return {
    container,
    root,
    cleanup: async () => {
      await act(async () => root.unmount())
      dom.window.close()
      vi.unstubAllGlobals()
    }
  }
}

/** 测试替身舞台：按 outer 传入顺序 map，key 固定为 workspaceId（与 AppShell 同构）。 */
function Stage({ ids, activeId, transientId, marker }: {
  ids: string[]
  activeId: string | null
  transientId?: string
  marker?: number
}): ReactNode {
  return createElement(
    'div',
    null,
    ids.map((id) =>
      createElement(WorkspaceDockLayer, {
        key: id,
        workspaceId: id,
        active: id === activeId,
        transient: id === transientId,
        fallbackModelId: 'model',
        maxOutputTokens: 1
      })
    ),
    marker === undefined ? null : createElement('span', { 'data-marker': String(marker) })
  )
}

/** 用 orderOf 决定渲染顺序的舞台，模拟 AppShell 的 append-only DOM 顺序。 */
function OrderedStage({ ids, activeId }: { ids: string[]; activeId: string | null }): ReactNode {
  const ordered = orderOf(ids)
  return createElement(
    'div',
    null,
    ordered.map((id) =>
      createElement(WorkspaceDockLayer, {
        key: id,
        workspaceId: id,
        active: id === activeId,
        fallbackModelId: 'model',
        maxOutputTokens: 1
      })
    )
  )
}

const layerOrder = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-workspace-layer-id]')].map(
    (el) => el.getAttribute('data-workspace-layer-id') ?? ''
  )

describe('WorkspaceDockLayer React 挂载身份', () => {
  it('active A/B 切换：A 不 unmount，B 不重新 mount', async () => {
    const { container, root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('layer-a'), ws('layer-b')])
      await act(async () => root.render(createElement(Stage, { ids: ['layer-a', 'layer-b'], activeId: 'layer-a' })))
      expect(probe.mounts.get('layer-a')).toBe(1)
      expect(probe.mounts.get('layer-b')).toBe(1)
      expect(container.querySelector('[data-workspace-layer-id="layer-a"]')?.getAttribute('data-workspace-active')).toBe('true')

      await act(async () => root.render(createElement(Stage, { ids: ['layer-a', 'layer-b'], activeId: 'layer-b' })))

      expect(probe.mounts.get('layer-a')).toBe(1)
      expect(probe.unmounts.get('layer-a') ?? 0).toBe(0)
      expect(probe.mounts.get('layer-b')).toBe(1)
      expect(container.querySelector('[data-workspace-layer-id="layer-a"]')?.getAttribute('data-workspace-active')).toBe('false')
      expect(container.querySelector('[data-workspace-layer-id="layer-b"]')?.getAttribute('data-workspace-active')).toBe('true')
    } finally {
      await cleanup()
    }
  })

  it('父级无关 state 更新（marker 变化）不触发子树重挂载', async () => {
    const { container, root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('parent-a'), ws('parent-b')])
      await act(async () => root.render(createElement(Stage, { ids: ['parent-a', 'parent-b'], activeId: 'parent-a', marker: 0 })))
      await act(async () => root.render(createElement(Stage, { ids: ['parent-a', 'parent-b'], activeId: 'parent-a', marker: 1 })))

      expect(container.querySelector('[data-marker]')?.getAttribute('data-marker')).toBe('1')
      expect(probe.mounts.get('parent-a')).toBe(1)
      expect(probe.mounts.get('parent-b')).toBe(1)
      expect(probe.unmounts.get('parent-a') ?? 0).toBe(0)
      expect(probe.unmounts.get('parent-b') ?? 0).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it('从 outer 移除 A 时 A 才 unmount', async () => {
    const { root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('rm-a'), ws('rm-b')])
      await act(async () => root.render(createElement(Stage, { ids: ['rm-a', 'rm-b'], activeId: 'rm-a' })))
      await act(async () => root.render(createElement(Stage, { ids: ['rm-b'], activeId: 'rm-b' })))

      expect(probe.unmounts.get('rm-a')).toBe(1)
      expect(probe.mounts.get('rm-b')).toBe(1)
      expect(probe.unmounts.get('rm-b') ?? 0).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it('transient → resident（同一 key、active 不变）不重挂载', async () => {
    const { container, root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('tr-a')])
      await act(async () => root.render(createElement(Stage, { ids: ['tr-a'], activeId: 'tr-a', transientId: 'tr-a' })))
      expect(container.querySelector('[data-workspace-layer-id="tr-a"]')?.getAttribute('data-workspace-transient')).toBe('true')

      await act(async () => root.render(createElement(Stage, { ids: ['tr-a'], activeId: 'tr-a' })))

      expect(container.querySelector('[data-workspace-layer-id="tr-a"]')?.getAttribute('data-workspace-transient')).toBe('false')
      expect(probe.mounts.get('tr-a')).toBe(1)
      expect(probe.unmounts.get('tr-a') ?? 0).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it('outer 重排（orderOf 稳定）后 DOM 顺序与层身份均不变', async () => {
    const { container, root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('ord-a'), ws('ord-b')])
      await act(async () => root.render(createElement(OrderedStage, { ids: ['ord-a', 'ord-b'], activeId: 'ord-a' })))
      expect(layerOrder(container)).toEqual(['ord-a', 'ord-b'])

      // outer 重排：传入顺序反转，但 orderOf 保持 append-only seq。
      await act(async () => root.render(createElement(OrderedStage, { ids: ['ord-b', 'ord-a'], activeId: 'ord-b' })))

      expect(layerOrder(container)).toEqual(['ord-a', 'ord-b'])
      expect(probe.mounts.get('ord-a')).toBe(1)
      expect(probe.mounts.get('ord-b')).toBe(1)
      expect(probe.unmounts.get('ord-a') ?? 0).toBe(0)
      expect(probe.unmounts.get('ord-b') ?? 0).toBe(0)
    } finally {
      await cleanup()
    }
  })

  it('StrictMode：effect 双调用计数按 dev 语义翻倍，切换 active 不增加 mount', async () => {
    // 生产 main.tsx:11-29 启用了 StrictMode，dev 下 mount effect 会「挂载→清理→再挂载」。
    // 这里显式包 StrictMode 钉住该语义：初始计数允许 1（非 StrictMode 构建）或 2（dev 双调用），
    // 但后续 active 切换不得再产生任何新的 mount / unmount。
    const { root, cleanup } = setupDom()
    try {
      useWindowStore.getState().updateWorkspaces([ws('sm-a'), ws('sm-b')])
      await act(async () => root.render(createElement(StrictMode, null, createElement(Stage, { ids: ['sm-a', 'sm-b'], activeId: 'sm-a' }))))
      const aInitial = probe.mounts.get('sm-a') ?? 0
      expect([1, 2]).toContain(aInitial)

      await act(async () => root.render(createElement(StrictMode, null, createElement(Stage, { ids: ['sm-a', 'sm-b'], activeId: 'sm-b' }))))

      expect(probe.mounts.get('sm-a')).toBe(aInitial)
      expect(probe.unmounts.get('sm-a') ?? 0).toBeLessThanOrEqual(1)
      expect(probe.mounts.get('sm-b') ?? 0).toBeLessThanOrEqual(2)
    } finally {
      await cleanup()
    }
  })
})

/* ───────────────────────── useResidentDebounce 双向去抖（B1） ───────────────────────── */

/** 最小宿主：把 hook 的返回值投影到 DOM 属性，供断言。 */
function DebounceHost({ candidates }: { candidates: ReadonlySet<string> }): ReactNode {
  const committed = useResidentDebounce(candidates, 300)
  return createElement('span', { 'data-committed': [...committed].sort().join(',') })
}

const committedText = (container: HTMLElement): string =>
  container.querySelector('[data-committed]')?.getAttribute('data-committed') ?? ''

function setupTimerDom(): ReturnType<typeof setupDom> {
  const base = setupDom()
  vi.useFakeTimers()
  return base
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useResidentDebounce 双向去抖', () => {
  it('两个候选在去抖窗口内先后进入 → 各自在自己的 300ms 后提交，互不重置', async () => {
    // B1 的钉子：A 进入后 200ms 时 B 进入，A 仍在原时刻提交、B 在 B+300 提交。
    const { container, root, cleanup } = setupTimerDom()
    try {
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db-a']) })))
      await act(async () => { vi.advanceTimersByTime(200) }) // t=200，A 的计时器将于 300 到点
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db-a', 'db-b']) })))
      await act(async () => { vi.advanceTimersByTime(99) }) // t=299
      expect(committedText(container)).toBe('')
      await act(async () => { vi.advanceTimersByTime(1) }) // t=300 → A 提交
      expect(committedText(container)).toBe('db-a')
      await act(async () => { vi.advanceTimersByTime(199) }) // t=499，B 还没到点
      expect(committedText(container)).toBe('db-a')
      await act(async () => { vi.advanceTimersByTime(1) }) // t=500 → B 提交
      expect(committedText(container)).toBe('db-a,db-b')
    } finally {
      await cleanup()
    }
  })

  it('候选短暂离开又回来 → 计时器重启（完整重计 300ms）', async () => {
    const { container, root, cleanup } = setupTimerDom()
    try {
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db2-a']) })))
      await act(async () => { vi.advanceTimersByTime(200) }) // t=200，原计时器 300 到点
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set<string>() }))) // 离开 → 取消
      await act(async () => { vi.advanceTimersByTime(50) }) // t=250
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db2-a']) }))) // 回来 → 重启
      await act(async () => { vi.advanceTimersByTime(299) }) // t=549，未到重启后的 300
      expect(committedText(container)).toBe('')
      await act(async () => { vi.advanceTimersByTime(1) }) // t=550 → 提交
      expect(committedText(container)).toBe('db2-a')
    } finally {
      await cleanup()
    }
  })

  it('已提交者离开候选 → 300ms 后移除；窗口内回来 → 取消移除', async () => {
    const { container, root, cleanup } = setupTimerDom()
    try {
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db3-a']) })))
      await act(async () => { vi.advanceTimersByTime(300) }) // 提交
      expect(committedText(container)).toBe('db3-a')

      // 离开，但在 300ms 内回来 → 取消移除
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set<string>() })))
      await act(async () => { vi.advanceTimersByTime(200) })
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db3-a']) })))
      await act(async () => { vi.advanceTimersByTime(500) })
      expect(committedText(container)).toBe('db3-a')

      // 再次离开并等满 300ms → 移除
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set<string>() })))
      await act(async () => { vi.advanceTimersByTime(300) })
      expect(committedText(container)).toBe('')
    } finally {
      await cleanup()
    }
  })

  it('卸载 → 计时器清理（advance 后无 setCommitted 调用）', async () => {
    const { root, cleanup } = setupTimerDom()
    try {
      await act(async () => root.render(createElement(DebounceHost, { candidates: new Set(['db4-a']) })))
      expect(vi.getTimerCount()).toBeGreaterThan(0)
      await act(async () => root.unmount())
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await cleanup()
    }
  })
})
