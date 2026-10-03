import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InnerTab, OuterTab } from '../../../../shared/domain/tab'
import { DEFAULT_WORKSPACE_SETTINGS } from '../../../../shared/domain/workspace'

vi.mock('../../services/app', () => ({
  getInnerTabs: vi.fn(),
  persistInnerTabs: vi.fn(),
  persistOuterTabs: vi.fn()
}))

vi.mock('../../services/browser', () => ({
  closeBrowserTab: vi.fn(async () => undefined)
}))

import { useTabsStore } from '../tabs'
import { useWindowStore } from '../window'

const windowInitial = useWindowStore.getState()
const tabsInitial = useTabsStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  useWindowStore.setState(windowInitial, true)
  useWindowStore.getState().updateWorkspaces(['workspace-a', 'workspace-b'].map((id) => ({ id, name: id, rootPath: `/tmp/${id}`, settings: DEFAULT_WORKSPACE_SETTINGS, createdAt: 1, lastOpenedAt: 1 })))
  useTabsStore.setState(tabsInitial, true)
})

const workspaceTab = (id: string, workspaceId: string): OuterTab => ({
  id,
  kind: 'workspace',
  ref: { workspaceId }
})

const chatTab = (id: string): InnerTab => ({
  id,
  kind: 'chat',
  pane: 'main',
  title: 'Chat',
  ref: { sessionId: `session-${id}` }
})

describe('browser workspace isolation', () => {
  it('后台工作区请求展开右侧面板时，不改变当前工作区；切过去后恢复展开态', () => {
    useWindowStore.setState({
      outer: [workspaceTab('outer-a', 'workspace-a'), workspaceTab('outer-b', 'workspace-b')],
      activeOuterId: 'outer-a',
      activeWorkspaceId: 'workspace-a',
      rightPanelOpen: false,
      rightPanelOpenByWorkspace: {}
    })

    useWindowStore.getState().setRightPanelForWorkspace('workspace-b', true)

    expect(useWindowStore.getState().activeWorkspaceId).toBe('workspace-a')
    expect(useWindowStore.getState().rightPanelOpen).toBe(false)
    expect(useWindowStore.getState().rightPanelOpenByWorkspace['workspace-b']).toBe(true)

    useWindowStore.getState().activate('outer-b')

    expect(useWindowStore.getState().activeWorkspaceId).toBe('workspace-b')
    expect(useWindowStore.getState().rightPanelOpen).toBe(true)
  })

  it('per-workspace right/bottom 面板：活动用投影字段，后台写入 byWorkspace，切换后各自恢复', () => {
    useWindowStore.setState({
      outer: [workspaceTab('outer-a', 'workspace-a'), workspaceTab('outer-b', 'workspace-b')],
      activeOuterId: 'outer-a',
      activeWorkspaceId: 'workspace-a',
      rightPanelOpen: false,
      bottomPanelOpen: false,
      rightPanelOpenByWorkspace: {},
      bottomPanelOpenByWorkspace: {}
    })

    // 活动 A：开关走投影字段（rightPanelOpen / bottomPanelOpen），同时写入 byWorkspace。
    useWindowStore.getState().toggleRightPanel()
    useWindowStore.getState().toggleBottomPanel()
    expect(useWindowStore.getState().rightPanelOpen).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpen).toBe(true)
    expect(useWindowStore.getState().rightPanelOpenByWorkspace['workspace-a']).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpenByWorkspace['workspace-a']).toBe(true)

    // 后台 B：定向写入只落 byWorkspace，不改变活动 A 的投影。
    useWindowStore.getState().setRightPanelForWorkspace('workspace-b', true)
    useWindowStore.getState().setBottomPanelForWorkspace('workspace-b', true)
    expect(useWindowStore.getState().activeWorkspaceId).toBe('workspace-a')
    expect(useWindowStore.getState().rightPanelOpen).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpen).toBe(true)
    expect(useWindowStore.getState().rightPanelOpenByWorkspace['workspace-b']).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpenByWorkspace['workspace-b']).toBe(true)

    // 切到 B：恢复 B 自己的开合态。
    useWindowStore.getState().activate('outer-b')
    expect(useWindowStore.getState().rightPanelOpen).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpen).toBe(true)

    // 在 B 关掉底部：只影响 B，A 的记录仍是开。
    useWindowStore.getState().toggleBottomPanel()
    expect(useWindowStore.getState().bottomPanelOpen).toBe(false)
    expect(useWindowStore.getState().bottomPanelOpenByWorkspace['workspace-b']).toBe(false)
    expect(useWindowStore.getState().bottomPanelOpenByWorkspace['workspace-a']).toBe(true)

    // 切回 A：恢复 A 自己的开合态，而不是沿用 B 的。
    useWindowStore.getState().activate('outer-a')
    expect(useWindowStore.getState().rightPanelOpen).toBe(true)
    expect(useWindowStore.getState().bottomPanelOpen).toBe(true)
  })

  it('Agent 标签只写入目标工作区，并成为该工作区右侧面板的活动标签', () => {
    const a = chatTab('chat-a')
    const b = chatTab('chat-b')
    const files: InnerTab = {
      id: 'files-b',
      kind: 'files',
      pane: 'right',
      title: 'Files',
      ref: { path: '' }
    }
    useTabsStore.getState().hydrate('workspace-a', { tabs: [a], activeTabId: a.id })
    useTabsStore.getState().hydrate('workspace-b', {
      tabs: [b, files],
      activeTabId: b.id,
      rightActiveTabId: files.id
    })
    // 落一份 Dock 快照 —— 有快照以后 legacy 的 rightActiveTabId 就不再是权威，
    // 这正是真实运行时的状态，也是这条用例要守住的分支。
    useTabsStore.getState().activate('workspace-b', b.id)

    useTabsStore.getState().syncBrowserTabs('workspace-b', [{
      id: 'remote-agent-tab',
      url: 'https://example.com/',
      title: 'Example',
      source: 'agent'
    }])

    expect(useTabsStore.getState().stateOf('workspace-a').tabs).toEqual([a])
    const target = useTabsStore.getState().stateOf('workspace-b')
    const browser = target.tabs.find((tab) => tab.kind === 'browser')
    expect(browser).toMatchObject({
      kind: 'browser',
      pane: 'right',
      ref: { browserId: 'remote-agent-tab' }
    })
    expect(target.rightActiveTabId).toBe(browser?.id)
    // 右侧那一组默认停在「工作区文件」上；Agent 打开的页面必须顶到前面，
    // 否则右侧面板掀开后看到的还是文件树。
    const dock = useTabsStore.getState().dockOf('workspace-b')
    const group = dock.root.type === 'split' ? dock.root.second : dock.root
    expect(group.type === 'group' && group.activeTabId).toBe(browser?.id)
  })
})

describe('browser tab reconciliation', () => {
  it('用 clientTabId 将主进程事件合并回原标签，不按 URL 猜测或创建副本', () => {
    const chat = chatTab('chat')
    const optimistic: InnerTab = {
      id: 'client-browser-tab',
      kind: 'browser',
      pane: 'bottom',
      title: 'New tab',
      ref: { url: '' }
    }
    useTabsStore.getState().hydrate('workspace-a', {
      tabs: [chat, optimistic],
      activeTabId: chat.id,
      bottomActiveTabId: optimistic.id
    })

    useTabsStore.getState().syncBrowserTabs('workspace-a', [{
      id: 'remote-user-tab',
      clientTabId: optimistic.id,
      url: 'https://example.com/',
      title: 'Example',
      source: 'user'
    }])

    const browserTabs = useTabsStore.getState().stateOf('workspace-a').tabs.filter(
      (tab) => tab.kind === 'browser'
    )
    expect(browserTabs).toHaveLength(1)
    expect(browserTabs[0]).toMatchObject({
      id: optimistic.id,
      pane: 'bottom',
      ref: { browserId: 'remote-user-tab', url: 'https://example.com/' }
    })
  })

  it('远端关闭活动浏览器后修复活动项，并保证主区仍有可用标签', () => {
    const browser: InnerTab = {
      id: 'browser-only',
      kind: 'browser',
      pane: 'main',
      title: 'Example',
      ref: { url: 'https://example.com/', browserId: 'remote-old' }
    }
    useTabsStore.getState().hydrate('workspace-a', {
      tabs: [browser],
      activeTabId: browser.id
    })

    useTabsStore.getState().syncBrowserTabs('workspace-a', [])

    const state = useTabsStore.getState().stateOf('workspace-a')
    expect(state.tabs.some((tab) => tab.id === browser.id)).toBe(false)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]?.kind).toBe('chat')
    expect(state.activeTabId).toBe(state.tabs[0]?.id)
  })
})
