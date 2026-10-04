import { ArrowLeft, ArrowRight, ExternalLink, Globe, Keyboard, MousePointer2, RotateCw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { InnerTab } from '../../../../shared/domain/tab'
import type { Workspace } from '../../../../shared/domain/workspace'
import { isLocalEnvironment } from '../../../../shared/domain/environment'
import { browserPartition, type BrowserCuaEvent } from '../../../../shared/domain/browser'
import {
  bindBrowserView,
  closeBrowserTab,
  listBrowserTabs,
  navigateBrowserTab,
  onBrowserCua,
  openBrowserTab
} from '../../services/browser'
import { useI18n } from '../../i18n'
import { useTabsStore } from '../../stores/tabs'
import { IconButton } from '../../components/ui/IconButton'
import { cn } from '../../lib/cn'
import { Spinner } from '../../components/ui/Spinner'
import { useWorkspaceActive } from '../../shell/workspace-active'
import { isAddressableUrl, isExternalOpenableUrl, resolveAddress } from './address'

interface BrowserElement extends HTMLElement {
  loadURL?: (url: string) => Promise<void>
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  openDevTools?: () => void
  getWebContentsId?: () => number
  isAudioMuted?: () => boolean
  setAudioMuted?: (muted: boolean) => void
  /** guest 是否仍在加载。注册监听前 guest 可能已经开转/停转，用它对齐一次状态。 */
  isLoading?: () => boolean
}

/**
 * 失活前读到的 guest 静音值（设计 §4.8.3）。不持久化、不进 store —— 读的是
 * Electron 运行时现值，激活时恢复原值，避免「切回工作区瞬间突然出声」。
 * key = clientTabId（即 tab.id）。
 */
const audioMutedByTab = new Map<string, boolean>()

interface CuaIndicator extends BrowserCuaEvent {
  visible: boolean
}

/**
 * 隔离的浏览器标签视图。
 *
 * 每个工作区使用独立的 Electron session partition；页面只能通过 webview 加载
 * http(s) 与 file:// 地址（原先是「永远只能 http(s)」，2026-09-22 按工作区所有者
 * 要求放开本地页面 —— 需求与风险见 `main/kernel/tool/builtin/ssrf.ts` 的
 * `allowFileUrls`，协议闸在 `main/index.ts` 的 `browserUrlProtocol`），
 * 不能导航到应用的 ncw:// 或脚本协议。
 */
export function BrowserView({ tab, workspace }: { tab: Extract<InnerTab, { kind: 'browser' }>; workspace: Workspace }): ReactNode {
  const { t } = useI18n()
  if (!isLocalEnvironment(workspace.environment)) return <div role="status" className="flex min-h-0 flex-1 items-center justify-center p-6 text-[13px] text-fg-muted">{t('ssh.browserUnavailable')}</div>
  return <LocalBrowserView tab={tab} workspace={workspace} />
}

function LocalBrowserView({ tab, workspace }: { tab: Extract<InnerTab, { kind: 'browser' }>; workspace: Workspace }): ReactNode {
  const { t } = useI18n()
  const setBrowser = useTabsStore((state) => state.setBrowser)
  const [url, setUrl] = useState(tab.ref.url)
  const [draft, setDraft] = useState(tab.ref.url)
  /*
    src 与显示地址分家(闪屏根因):此前 webview 的 `src` 直接绑显示 url,而
    did-navigate / reconcile / `browser:changed` 广播都会回写 url —— guest 自己
    导航后,store 的滞后旧值会把 src 拉回旧地址 = 整页重载;重载又触发导航事件
    再回写,主文档带一次性参数的(如 OAuth 回调)二次提交就报「token 无效」,
    两个写入方各持一个地址时形成自激循环,表现是持续闪屏。
    `srcUrl` 只在「无 guest(src 未挂载)」时跟随 store、或用户显式提交时变化;
    guest 存在后 src 冻结,store/广播只影响地址栏显示,再也滚不动页面。
  */
  const [srcUrl, setSrcUrl] = useState(tab.ref.url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cuaIndicator, setCuaIndicator] = useState<CuaIndicator | null>(null)
  const viewRef = useRef<BrowserElement | null>(null)
  /*
    webview 元素本体进状态:挂监听的 effect 必须跟着「元素何时存在」重跑。
    渲染层重载后的空 Tab(browserId 已存在、url 为空)输入网址时走的是
    `browserId !== undefined` 分支,tab.ref.browserId 不变 —— 若 effect 只依赖
    store 字段,webview 后挂载时监听永远补不上,地址栏就冻结在输入值。
    事件处理器(返回/前进/刷新/静音)仍走 viewRef,读的是点击瞬间的最新节点。
  */
  const [viewNode, setViewNode] = useState<BrowserElement | null>(null)
  /*
    主文档是否已就绪（dom-ready 已到）。用于兜住 `onAttach` 的 loading 对齐：页面有挂起
    子资源时 `isLoading()` 恒为 true，若主文档早已就绪（dom-ready 已错过），effect 重跑
    时不能凭 `isLoading()` 把角标重新点亮，否则角标会再次卡死。每次新导航（onStart /
    navigate）置 false，dom-ready / did-stop-loading 置 true。
  */
  const domReadyRef = useRef(false)
  const { active } = useWorkspaceActive()
  // did-attach 监听闭包拿不到最新的 active，用 ref 兜住，供 attach 后对齐静音。
  const activeRef = useRef(active)
  activeRef.current = active

  /*
    媒体隔离（设计 §4.8.3）：失活时先读一次运行时静音值存入模块级 Map，再静音；
    激活时恢复该值（无记录默认 false）。MVP 不调用 setBackgroundThrottling。
    webview ref 可能为空（url 为空分支不渲染）或尚未 attach —— attach 前调用会抛，
    与 getWebContentsId 同理，用 try/catch 吞掉，等下次 active 变化再处理。
  */
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (!active) {
      let muted: boolean
      try {
        muted = view.isAudioMuted?.() ?? false
      } catch {
        muted = false
      }
      audioMutedByTab.set(tab.id, muted)
      try {
        view.setAudioMuted?.(true)
      } catch {
        // Guest 尚未 attach：Electron 在 did-attach 前调用会抛。
      }
      return
    }
    const restore = audioMutedByTab.get(tab.id) ?? false
    try {
      view.setAudioMuted?.(restore)
    } catch {
      // Guest 尚未 attach。
    }
  }, [active, tab.id])

  // 模块级 Map 以 tab.id 为键且永不自动清理；组件卸载（tab 生命周期结束）时删除，避免泄漏。
  useEffect(() => () => { audioMutedByTab.delete(tab.id) }, [tab.id])

  // Tab 切换(含渲染层重载后的挂接):三个地址一起复位,guest 重建。
  useEffect(() => {
    setUrl(tab.ref.url)
    setDraft(tab.ref.url)
    setSrcUrl(tab.ref.url)
    setError(null)
  }, [tab.id])

  /*
    同一 Tab 内 store 地址变化(页面自身导航回写、Agent 驱动导航、reconcile):
    只跟显示/地址栏;src 仅在还没有 guest(空地址)时接管,此后冻结,
    旧值再也滚不回已加载的页面(闪屏根因见 srcUrl 声明处注释)。
    例外:browserId 变了 = manager 侧重建过标签,旧 guest 已作废,src 接管新地址。
  */
  const browserIdRef = useRef(tab.ref.browserId)
  useEffect(() => {
    setUrl(tab.ref.url)
    setDraft(tab.ref.url)
    if (browserIdRef.current !== tab.ref.browserId) {
      browserIdRef.current = tab.ref.browserId
      setSrcUrl(tab.ref.url)
    } else {
      setSrcUrl((prev) => (prev === '' ? tab.ref.url : prev))
    }
  }, [tab.ref.url, tab.ref.browserId])

  /*
    换浏览器 tab：registry 的 browser 分支不挂 key，同一渲染位会复用组件实例，ref 会跨
    tab 保留，必须显式复位。★ 只在 `tab.id` 变化时复位——站内 hash 跳转也会改
    `tab.ref.url`，若跟着 url 复位，会把刚由 dom-ready 置位的「已就绪」标志撤销，反而
    让有挂起子资源的页面在下一次 effect 重跑时重新卡住。新文档的复位由 onStart 负责。
  */
  useEffect(() => { domReadyRef.current = false }, [tab.id])

  useEffect(() => {
    if (tab.ref.url === '') return
    let alive = true
    void listBrowserTabs(workspace.id).then((tabs) => {
      const known = tabs.find(
        (item) => item.id === tab.ref.browserId || (item.source === 'user' && item.clientTabId === tab.id)
      )
      if (known !== undefined) return known
      return openBrowserTab(workspace.id, tab.ref.url, tab.title, tab.ref.profileId, tab.id)
    }).then((remote) => {
      if (!alive) return
      /*
        只补 browserId,不回写 url:此 effect 触发时本地已有地址(url 非空才进这里),
        manager 那份 url 可能滞后(页面刚自导航、navigate IPC 还在路上)。无条件写回
        会把地址栏/显示打回旧值,叠上 src 回滚就是闪屏循环的一半(见 srcUrl 声明处)。
        guest 的实际位置以 did-navigate 事件为准,Agent 导航也走 guest 事件同步。
      */
      setBrowser(workspace.id, tab.id, { browserId: remote.id })
    }).catch(() => {
      if (alive) setError(t('browser.operationFailed'))
    })
    return () => { alive = false }
  }, [setBrowser, tab.id, tab.ref.browserId, tab.ref.profileId, tab.ref.url, tab.title, t, workspace.id])

  useEffect(() => {
    const view = viewNode
    if (view === null) return
    let alive = true

    const onAttach = (): void => {
      const browserId = tab.ref.browserId
      let webContentsId: number | undefined
      try {
        webContentsId = view.getWebContentsId?.()
      } catch {
        // Before did-attach Electron throws instead of returning an absent id.
        return
      }
      /*
        attach 后对齐静音，防 G13 回归（隐藏页持续出声）：若失活发生在 attach
        之前，上面的静音 effect 调用 setAudioMuted 会因 guest 未 attach 抛错被吞，
        隐藏页可能持续出声。这里在 attach 确认后补一次对齐，并照常记录运行时静音值。
      */
      if (!activeRef.current) {
        let muted: boolean
        try {
          muted = view.isAudioMuted?.() ?? false
        } catch {
          muted = false
        }
        audioMutedByTab.set(tab.id, muted)
        try {
          view.setAudioMuted?.(true)
        } catch {
          // 仍可能未就绪；后续 active 变化会再对齐。
        }
      }
      if (browserId === undefined || typeof webContentsId !== 'number' || !Number.isInteger(webContentsId) || webContentsId <= 0) return
      /*
        attach 后对齐 loading（与上面的静音对齐同范式）：监听注册可能晚于 guest 的
        加载事件（层重挂载时 webview 挂上就开始加载），错过 did-start/stop-loading
        会让转圈卡在错误状态（不停或该转不转）。attach 确认后用元素真实状态对齐一次，
        事件只负责后续增量。★ 不能在 effect 里直接调——webview 方法在 attach 前调用
        会 throw（"must be attached to the DOM"），未捕获会把整棵 React 树卸载。
      */
      try {
        // 主文档已就绪时，即便 isLoading() 仍为 true（挂起子资源），也不能凭它把角标
        // 重新点亮——否则 effect 重跑会让角标再次卡死（dom-ready 已错过、不会再来）。
        setLoading(domReadyRef.current ? false : (view.isLoading?.() ?? false))
      } catch {
        // 理论上 attach 后不会抛；兜底保持现状，后续事件会对齐。
      }
      void bindBrowserView(workspace.id, browserId, webContentsId).catch(() => {
        if (alive) setError(t('browser.operationFailed'))
      })
    }
    const onNavigate = (event: Event): void => {
      const next = (event as Event & { url?: string }).url
      if (typeof next !== 'string' || !isAddressableUrl(next)) return
      setUrl(next)
      setDraft(next)
      setBrowser(workspace.id, tab.id, { url: next })
      // Keep the shared manager authoritative when a page navigates itself
      // (link click, history API, or redirect) instead of only updating the
      // optimistic renderer tab. This is what lets another window and Agent
      // tools observe the same URL without waiting for the address bar form.
      if (tab.ref.browserId !== undefined && tab.ref.browserId !== '') {
        void navigateBrowserTab(workspace.id, tab.ref.browserId, next).catch(() => undefined)
      }
      // 这里不复位 loading：Chrome 的转圈要到 did-stop-loading（子资源全部加载完）才停，
      // did-navigate 只是提交。提前复位会让「子资源还挂着」的页面被当成加载完成
      // （探针 3a/3b 实证：isLoading()=true 而角标已消失）。失败由 did-fail-load 复位。
    }
    const onStart = (): void => { domReadyRef.current = false; setLoading(true) }
    const onStop = (): void => { domReadyRef.current = true; setLoading(false) }
    /*
      兜底复位：did-stop-loading 要等 onload（子资源全部加载完）才触发。页面主体已渲染、
      但某个子资源（外链追踪图、头像、字体、dev server 的动态模块…）永不返回时，onload
      永不触发，角标会一直挂着（探针实证：/hangimg 页 readyState=interactive、loadEnd=0）。
      dom-ready（DOMContentLoaded）在主文档解析完成时触发——用户此刻已能看到界面，正是
      「加载完了」的语义。解析阻塞型挂起（<script> 永不返回）dom-ready 也不触发，此时
      角标继续挂，与 Chrome 一致。
    */
    const onDomReady = (): void => { domReadyRef.current = true; setLoading(false) }
    const onFail = (): void => {
      setLoading(false)
      setError(t('browser.loadFailed'))
    }
    /*
      guest 自愈观测（设计 §4.1.4 规则 5）：保活后 guest 被意外销毁必须不静默。
      仅上报，不在此处做自愈动作。
    */
    const onDestroyed = (): void => {
      console.warn('[browser] webview guest destroyed', { tabId: tab.id, workspaceId: workspace.id })
    }

    view.addEventListener('did-attach', onAttach)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('dom-ready', onDomReady)
    view.addEventListener('did-fail-load', onFail)
    view.addEventListener('destroyed', onDestroyed)
    onAttach()
    return () => {
      alive = false
      view.removeEventListener('did-attach', onAttach)
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigate)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('dom-ready', onDomReady)
      view.removeEventListener('did-fail-load', onFail)
      view.removeEventListener('destroyed', onDestroyed)
    }
  }, [setBrowser, tab.id, tab.ref.browserId, workspace.id, t, viewNode])

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    let removeTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = onBrowserCua((event) => {
      if (event.workspaceId !== workspace.id || event.tabId !== tab.ref.browserId) return
      if (hideTimer !== null) clearTimeout(hideTimer)
      if (removeTimer !== null) clearTimeout(removeTimer)
      setCuaIndicator({ ...event, visible: true })
      hideTimer = setTimeout(() => {
        setCuaIndicator((current) => current === null ? null : { ...current, visible: false })
      }, 200)
      removeTimer = setTimeout(() => setCuaIndicator(null), 400)
    })
    return () => {
      unsubscribe()
      if (hideTimer !== null) clearTimeout(hideTimer)
      if (removeTimer !== null) clearTimeout(removeTimer)
    }
  }, [tab.ref.browserId, workspace.id])

  const navigate = async (): Promise<void> => {
    const raw = draft.trim()
    if (raw === '') return
    /*
      需求：本地页面也能从地址栏打开（file://，2026-09-22 —— 见 address.ts 头注）。
      解析失败/协议不认直接给 invalidUrl，不再混进下面的通用 catch —— 那条路会把
      「地址填错了」显示成「操作失败」，用户会以为是浏览器坏了而不是自己拼错了。
    */
    const href = resolveAddress(raw)
    if (href === null) {
      setError(t('browser.invalidUrl'))
      return
    }
    setError(null)
    // 新导航：就绪标志复位，直到新文档 dom-ready / did-stop-loading 再置回。
    domReadyRef.current = false
    setLoading(true)
    try {
      if (tab.ref.browserId === undefined) {
        const remote = await openBrowserTab(workspace.id, href, tab.title, tab.ref.profileId, tab.id)
        setBrowser(workspace.id, tab.id, { browserId: remote.id, url: remote.url })
      } else {
        await navigateBrowserTab(workspace.id, tab.ref.browserId, href)
        setBrowser(workspace.id, tab.id, { url: href })
      }
      setUrl(href)
      setDraft(href)
      // 用户显式提交是唯一能推动页面加载的入口(store 回写不在此列,见 srcUrl 声明处)。
      // guest 已在:loadURL 导航、src 不动(src 与 loadURL 都动 = 加载两遍);
      // guest 尚未 attach 时 loadURL 会抛,退回改 src(guest 不在/未挂时改 src 即挂载加载);
      // 其余失败(ERR_ABORTED 等)若 src 本就等于目标值,setSrcUrl 是空操作 ——
      // 没有新导航就不会有后续事件复位角标(ERR_ABORTED 的 did-fail-load 被 Electron 吞掉),
      // 必须就地复位并报错,否则重复提交同一地址会留下永久空转。
      if (viewNode !== null) {
        try {
          await viewRef.current?.loadURL?.(href)
        } catch {
          if (href === srcUrl) {
            setLoading(false)
            setError(t('browser.operationFailed'))
          } else {
            setSrcUrl(href)
          }
        }
      } else {
        setSrcUrl(href)
      }
    } catch {
      setLoading(false)
      setError(t('browser.operationFailed'))
    }
  }

  const openExternal = (): void => {
    if (!isExternalOpenableUrl(url)) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-hairline px-2">
        <IconButton label={t('browser.back')} size={26} onClick={() => viewRef.current?.goBack?.()}>
          <ArrowLeft size={14} />
        </IconButton>
        <IconButton label={t('browser.forward')} size={26} onClick={() => viewRef.current?.goForward?.()}>
          <ArrowRight size={14} />
        </IconButton>
        <IconButton label={t('browser.reload')} size={26} onClick={() => viewRef.current?.reload?.()}>
          <RotateCw size={14} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
        </IconButton>
        <form
          className="flex min-w-0 flex-1 items-center rounded-[8px] border border-hairline bg-surface px-2"
          onSubmit={(event) => {
            event.preventDefault()
            void navigate()
          }}
        >
          <Globe size={13} className="mr-1.5 shrink-0 text-fg-faint" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('browser.addressPlaceholder')}
            aria-label={t('browser.address')}
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
          <ShieldAlert size={13} className="shrink-0 text-fg-faint" aria-label={t('browser.isolated')} />
        </form>
        <IconButton label={t('browser.openExternal')} size={26} onClick={openExternal}>
          <ExternalLink size={14} />
        </IconButton>
      </div>

      {error !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline bg-danger/8 px-3 py-2 text-[12px] text-danger">
          <ShieldAlert size={14} />
          <span className="min-w-0 flex-1 truncate">{error}</span>
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        {srcUrl === '' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-canvas text-fg-faint">
            <Globe size={34} strokeWidth={1.4} />
            <p className="text-[13px]">{t('browser.emptyTitle')}</p>
            <p className="text-[12px]">{t('browser.emptyHint')}</p>
          </div>
        ) : (
          /* React has no built-in webview type; Electron upgrades this custom element. */
          <webview
            ref={(node) => {
              viewRef.current = node as BrowserElement | null
              setViewNode(node as BrowserElement | null)
            }}
            data-browser-tab-id={tab.id}
            src={srcUrl}
            partition={browserPartition(workspace.id, tab.ref.profileId)}
            allowpopups={false}
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
            className="h-full w-full border-0"
          />
        )}
        {cuaIndicator !== null && (
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute z-20 text-accent transition-opacity duration-200 motion-reduce:transition-none',
              cuaIndicator.visible ? 'opacity-100' : 'opacity-0'
            )}
            style={{ left: cuaIndicator.x, top: cuaIndicator.y }}
          >
            <MousePointer2 size={22} className="-translate-x-[2px] -translate-y-[2px] fill-canvas drop-shadow-sm" />
            {cuaIndicator.kind === 'click' && (
              <span className="absolute left-0 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-accent motion-reduce:animate-none" />
            )}
            {cuaIndicator.kind === 'type' && (
              <span className="absolute left-4 top-4 rounded border border-accent/40 bg-canvas/90 p-1 shadow-sm">
                <Keyboard size={12} />
              </span>
            )}
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-pill bg-canvas/90 px-2 py-1 text-[11px] text-fg-muted shadow-sm">
            <Spinner size="xs" className="mr-1 inline" />
            {t('browser.loading')}
          </div>
        )}
      </div>
    </div>
  )
}

/** Called by tab cleanup when an Agent-owned tab is closed from the UI. */
export async function closeManagedBrowserTab(workspaceId: string, tab: Extract<InnerTab, { kind: 'browser' }>): Promise<void> {
  if (tab.ref.browserId !== undefined) await closeBrowserTab(workspaceId, tab.ref.browserId)
}
