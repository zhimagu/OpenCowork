// @vitest-environment jsdom
/**
 * 地址栏跟随实证:页面自身导航(did-navigate / did-navigate-in-page)后,
 * 地址栏与 `LocalBrowserView` 的 url 状态是否同步。
 *
 * 数据链路复刻:`tabs store → Dock → tab prop` 用一个 10 行的外部 store 模拟
 * (setBrowser 补丁会换 `tab.ref` 引用,和真 store 一致);主进程 manager 用一个
 * 同步状态对象模拟 —— open/navigate 同步改 url、list 读当前值,与真实 IPC
 * 「navigate 先发先处理」的顺序一致。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { act, createElement, useSyncExternalStore, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nProvider } from '../../../i18n'
import { BrowserView } from '../BrowserView'

const h = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let ref: { url: string; browserId?: string; profileId?: string } = { url: '' }
  const actions = {
    setBrowser: (_ws: string, tabId: string, patch: { url?: string; browserId?: string; profileId?: string }) => {
      if (tabId !== 'tab-1') return
      ref = { ...ref, ...patch }
      listeners.forEach((l) => l())
    }
  }
  return {
    listeners,
    actions,
    getRef: () => ref,
    reset: (browserId?: string) => { ref = browserId === undefined ? { url: '' } : { url: '', browserId } }
  }
})

const svc = vi.hoisted(() => {
  const state = { managerUrl: '', managerId: 'remote-1', exists: false }
  const tab = () => ({
    id: state.managerId, workspaceId: 'ws1', source: 'user' as const, backend: 'iab' as const,
    clientTabId: 'tab-1', url: state.managerUrl, title: 'x', status: 'ready' as const, createdAt: 0, updatedAt: 0
  })
  return {
    state,
    list: vi.fn(async () => (state.exists ? [tab()] : [])),
    open: vi.fn(async (_ws: unknown, url: string) => {
      state.exists = true
      state.managerUrl = url
      return tab()
    }),
    navigate: vi.fn(async (_ws: unknown, _id: unknown, url: string) => {
      state.managerUrl = url
      return tab()
    }),
    close: vi.fn(async () => {}),
    bind: vi.fn(async () => {}),
    cua: vi.fn(() => () => {})
  }
})

vi.mock('../../../stores/tabs', () => ({
  useTabsStore: (selector: (state: unknown) => unknown) =>
    useSyncExternalStore(
      (cb) => { h.listeners.add(cb); return () => { h.listeners.delete(cb) } },
      () => selector(h.actions),
      () => selector(h.actions)
    )
}))

vi.mock('../../../services/browser', () => ({
  listBrowserTabs: svc.list,
  openBrowserTab: svc.open,
  navigateBrowserTab: svc.navigate,
  closeBrowserTab: svc.close,
  bindBrowserView: svc.bind,
  onBrowserCua: svc.cua
}))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const workspace = {
  id: 'ws1', name: 'w', rootPath: 'C:\\t', settings: {}, createdAt: 0, lastOpenedAt: 0,
  environment: { kind: 'local' }
} as never

function TabHost(): ReactNode {
  const ref = useSyncExternalStore(
    (cb) => { h.listeners.add(cb); return () => { h.listeners.delete(cb) } },
    () => h.getRef(),
    () => h.getRef()
  )
  return createElement(I18nProvider, null, createElement(BrowserView, {
    tab: { id: 'tab-1', kind: 'browser', pane: 'main', title: '浏览器', ref },
    workspace
  }))
}

const roots: Root[] = []

async function mount(initialBrowserId?: string): Promise<HTMLElement> {
  h.reset(initialBrowserId)
  svc.state.managerUrl = ''
  svc.state.managerId = 'remote-1'
  svc.state.exists = false
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(createElement(TabHost)) })
  return container
}

afterAll(() => { for (const r of roots) r.unmount() })

/** 提交地址栏:受控 input 走原生 setter,form 手动派发 submit。 */
async function submitAddress(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector('input')
  if (input === null) throw new Error('地址栏 input 不存在')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter === undefined) throw new Error('native value setter 不存在')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const form = input.closest('form')
  if (form === null) throw new Error('地址栏 form 不存在')
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

/** 模拟 guest 页面自己导航:在 webview 元素上派发 Electron 事件。 */
async function guestNavigate(container: HTMLElement, url: string, type = 'did-navigate'): Promise<void> {
  const view = container.querySelector('webview')
  if (view === null) throw new Error('webview 未挂载')
  await act(async () => {
    const ev = new Event(type) as Event & { url?: string }
    ev.url = url
    view.dispatchEvent(ev)
  })
}

const addressInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector('input')
  if (input === null) throw new Error('地址栏 input 不存在')
  return input as HTMLInputElement
}

/** 等 effect 链(setBrowser 补丁 → 重渲 → effect 重跑)彻底落地。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve() })
}

describe('BrowserView 地址栏跟随', () => {
  it('S1 全新 Tab:输入网址打开后,页面内点击导航,地址栏跟随', async () => {
    const container = await mount()
    expect(container.querySelector('webview')).toBeNull()

    await submitAddress(container, 'a.example')
    await flush()
    expect(svc.open).toHaveBeenCalledTimes(1)
    const view = container.querySelector('webview')
    expect(view).not.toBeNull()
    expect(view?.getAttribute('src')).toBe('https://a.example/')

    await guestNavigate(container, 'https://a.example/page2')
    expect(addressInput(container).value).toBe('https://a.example/page2')

    await guestNavigate(container, 'https://a.example/page2#/hash', 'did-navigate-in-page')
    expect(addressInput(container).value).toBe('https://a.example/page2#/hash')
  })

  /*
    曾有的 bug(已修):渲染层重载后,空 Tab(browserId 已存在、url 为空)输入网址
    打开页面,页内点击导航地址栏不跟随。根因是挂监听的 effect 在 webview 晚挂载时
    永不重跑 —— 现在监听 effect 依赖 webview 节点本身,元素一挂载监听即补上。
  */
  it('S2 挂载时 browserId 已存在、url 为空(渲染层重载后的空 Tab):输入网址打开后,页面内点击导航,地址栏跟随', async () => {
    const container = await mount('remote-pre')
    svc.state.exists = true
    svc.state.managerId = 'remote-pre'
    svc.state.managerUrl = ''

    await submitAddress(container, 'a.example')
    expect(svc.navigate).toHaveBeenCalledTimes(1)
    expect(container.querySelector('webview')).not.toBeNull()

    await guestNavigate(container, 'https://a.example/page2')
    expect(addressInput(container).value).toBe('https://a.example/page2')
  })
})
