/**
 * 水合墓碑(hydration tombstone)—— 方案 §4.5.4 / §9.2.3。
 *
 * `ensure` 挂在 effect 上,`loadOrSeed` 又跨了一次 IPC,关闭工作区与晚到的
 * 水合结果之间有真实的竞态窗口。没有墓碑的话,关闭 A 之后晚到的
 * `getInnerTabs(A)` 会把 `byWorkspace[A]` 复活 —— 渲染层靠 outer 交集看不见它,
 * 但「关闭工作区 = 退出内存」已经失败。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InnerTab, InnerTabState } from '../../../../shared/domain/tab'
import { DEFAULT_WORKSPACE_SETTINGS } from '../../../../shared/domain/workspace'

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

import { getInnerTabs, persistInnerTabs } from '../../services/app'
import { useTabsStore } from '../tabs'
import { useWindowStore } from '../window'

const tabsInitial = useTabsStore.getState()
const windowInitial = useWindowStore.getState()

/** 微任务 + 一次宏任务:足够让 `loadOrSeed` 的 then/catch/finally 全部跑完 */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const chatTab = (id: string): InnerTab => ({
  id,
  kind: 'chat',
  pane: 'main',
  title: 'Chat',
  ref: { sessionId: `session-${id}` }
})

beforeEach(() => {
  vi.clearAllMocks()
  useWindowStore.setState(windowInitial, true)
  useTabsStore.setState(tabsInitial, true)
})

describe('hydration tombstone', () => {
  it('forget 清掉工作区状态并写墓碑:ensure 直接 return,不发起加载', async () => {
    const ws = 'ws-forget'
    useTabsStore.getState().hydrate(ws, { tabs: [chatTab('a')], activeTabId: 'a' })
    expect(useTabsStore.getState().byWorkspace[ws]).toBeDefined()

    useTabsStore.getState().forget(ws)

    expect(useTabsStore.getState().byWorkspace[ws]).toBeUndefined()

    useTabsStore.getState().ensure(ws)
    await settle()
    expect(getInnerTabs).not.toHaveBeenCalled()
    expect(useTabsStore.getState().byWorkspace[ws]).toBeUndefined()
  })

  it('关闭期间晚到的 loadOrSeed 结果被丢弃,byWorkspace 不复活', async () => {
    const ws = 'ws-late-load'
    let release!: (s: InnerTabState) => void
    vi.mocked(getInnerTabs).mockReturnValue(new Promise((r) => { release = r }))

    useTabsStore.getState().ensure(ws)
    // 这一趟 IPC 在途时工作区被关掉
    useTabsStore.getState().forget(ws)

    release({ tabs: [chatTab('late')], activeTabId: 'late' })
    await settle()

    expect(useTabsStore.getState().byWorkspace[ws]).toBeUndefined()
    // 丢弃路径不落盘
    expect(persistInnerTabs).not.toHaveBeenCalled()
  })

  it('关闭期间晚到的 hydrate 结果被丢弃,byWorkspace 不复活', () => {
    const ws = 'ws-late-hydrate'
    useTabsStore.getState().forget(ws)

    useTabsStore.getState().hydrate(ws, { tabs: [chatTab('late')], activeTabId: 'late' })

    expect(useTabsStore.getState().byWorkspace[ws]).toBeUndefined()
  })

  it('墓碑期间的 browser 事件只进 pending;revive 后 ensure 落地时才应用', async () => {
    const ws = 'ws-pending'
    let release!: (s: InnerTabState) => void
    vi.mocked(getInnerTabs).mockReturnValueOnce(new Promise((r) => { release = r }))

    useTabsStore.getState().ensure(ws)
    useTabsStore.getState().forget(ws)
    // 关闭之后才到达的 browser 事件:进 pending,ensure 被墓碑挡住
    useTabsStore.getState().syncBrowserTabs(ws, [
      { id: 'remote-1', url: 'https://example.com/', title: 'Example', source: 'agent' }
    ])

    release({ tabs: [chatTab('a')], activeTabId: 'a' })
    await settle()
    expect(useTabsStore.getState().byWorkspace[ws]).toBeUndefined()

    // 重新打开:清墓碑 → ensure 正常水合 → 应用最新 pending
    vi.mocked(getInnerTabs).mockResolvedValue({ tabs: [chatTab('b')], activeTabId: 'b' })
    useTabsStore.getState().revive(ws)
    useTabsStore.getState().ensure(ws)
    await settle()

    const tabs = useTabsStore.getState().stateOf(ws).tabs
    expect(tabs.some((tab) => tab.kind === 'browser' && tab.ref.browserId === 'remote-1')).toBe(true)
  })

  it('revive 后 ensure 能正常发起加载并落地', async () => {
    const ws = 'ws-revive'
    vi.mocked(getInnerTabs).mockResolvedValue({ tabs: [chatTab('a')], activeTabId: 'a' })

    useTabsStore.getState().forget(ws)
    useTabsStore.getState().ensure(ws)
    await settle()
    expect(getInnerTabs).not.toHaveBeenCalled()

    useTabsStore.getState().revive(ws)
    useTabsStore.getState().ensure(ws)
    await settle()

    expect(getInnerTabs).toHaveBeenCalledTimes(1)
    expect(useTabsStore.getState().stateOf(ws).tabs.map((tab) => tab.id)).toEqual(['a'])
  })

  it('openWorkspace 重新打开工作区时清墓碑,之后能正常水合', async () => {
    const ws = 'ws-revive-open'
    vi.mocked(getInnerTabs).mockResolvedValue({ tabs: [chatTab('a')], activeTabId: 'a' })

    useTabsStore.getState().forget(ws)
    useTabsStore.getState().ensure(ws)
    await settle()
    expect(getInnerTabs).not.toHaveBeenCalled()

    useWindowStore.getState().updateWorkspaces([
      { id: ws, name: ws, rootPath: `/tmp/${ws}`, settings: DEFAULT_WORKSPACE_SETTINGS, createdAt: 1, lastOpenedAt: 1 }
    ])
    await useWindowStore.getState().openWorkspace(ws)

    useTabsStore.getState().ensure(ws)
    await settle()

    expect(getInnerTabs).toHaveBeenCalledTimes(1)
    expect(useTabsStore.getState().stateOf(ws).tabs.map((tab) => tab.id)).toEqual(['a'])
  })
})
