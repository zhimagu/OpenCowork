/**
 * 浏览器 loading 状态探针（一次性诊断，源自用户反馈「页面渲染完但一直转圈」）。
 *
 * 跑法：npm run build && node scripts/e2e-loading-state.mjs
 *
 * 对照实验设计：
 *   /clean —— 正常页（无挂起资源）    → 期望：加载角标出现后清掉
 *   /hang  —— 内容立即渲染，但带一个永不返回的 <script src>（模拟挂起请求）
 *                                   → 期望：角标持续显示（与 Chrome 行为一致）
 * 再覆盖地址栏导航路径（用户输入 → navigate() → setLoading(true) → 是否复位）。
 * 判据元素：BrowserView 的加载角标（i18n「加载中」/「Loading」文本 + Spinner）。
 */
/* global window, document */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import http from 'node:http'
import electron from 'electron'
import { _electron } from 'playwright-core'

const projectRoot = process.cwd()
let failed = false
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}
async function until(label, fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn().catch(() => null)
    if (value !== null && value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error(`超时等待「${label}」`)
    await sleep(100)
  }
}
async function within(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await fn().catch(() => false)) return true
    if (Date.now() > deadline) return false
    await sleep(100)
  }
}

/** 对照页服务器：/clean 正常；/hang 内容秒回但 /hang.js 永不响应。 */
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/hang.js')) return // 故意不响应——连接挂着
      if (req.url.startsWith('/hang')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><meta charset="utf-8"><title>loadhang</title><h1 id="ok">hang content ok</h1><script src="/hang.js"></script>')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>loadclean</title><h1 id="ok">clean content ok</h1>')
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

let app = null
let profile = null
try {
  profile = await mkdtemp(join(tmpdir(), 'ncw-e2e-loading-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  delete env.ELECTRON_RENDERER_URL
  const server = await startServer()
  const port = server.address().port
  const cleanUrl = `http://127.0.0.1:${port}/clean`
  const hangUrl = `http://127.0.0.1:${port}/hang`
  const cleanUrl2 = `http://127.0.0.1:${port}/clean?via=addressbar`

  app = await _electron.launch({
    executablePath: electron,
    args: [projectRoot, `--user-data-dir=${join(profile, 'ud')}`],
    cwd: projectRoot,
    env
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 })
  page.on('crash', () => console.log('💥 渲染器 crash'))
  page.on('pageerror', (e) => console.log(`💥 pageerror: ${e.message}\n${e.stack ?? '(无堆栈)'}`))
  // 临时诊断：捕获渲染器的 loading 状态机事件时间线（定位「一直加载中」后随源码日志一并移除）
  const loadingLogs = []
  page.on('console', (m) => {
    const text = m.text()
    if (text.includes('[browser-loading]')) loadingLogs.push(text)
  })
  const dumpLoadingLogs = (label) => console.log(`ℹ️ [${label}] loading 事件时间线:\n  ${loadingLogs.join('\n  ') || '(无)'}`)

  /** 失败诊断：层 / 内层 tab / 外层 tab / preload 存活 / 页面文本快照。 */
  const dumpState = async (label) => {
    const state = await page.evaluate(() => ({
      layers: [...document.querySelectorAll('[data-workspace-layer-id]')].map((el) => el.getAttribute('data-workspace-layer-id')),
      tabs: [...document.querySelectorAll('[data-workspace-layer-id] [role="tab"]')].map((el) => el.getAttribute('title')),
      outerTabs: [...document.querySelectorAll('[data-outer-tab-id]')].length,
      hasPreload: typeof window.nextcowork === 'object',
      bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160)
    })).catch((e) => ({ dumpError: String(e) }))
    console.log(`ℹ️ [${label}] ${JSON.stringify(state)}`)
  }

  await until('preload 就绪', () => page.evaluate(() => typeof window.nextcowork === 'object'))
  const offline = page.getByRole('button', { name: /免登录使用|Continue offline/ })
  await until('登录页或外壳', async () => (await offline.count()) > 0 || (await page.getByRole('button', { name: /打开工作区|Open workspace/ }).count()) > 0)
  if ((await offline.count()) > 0) await offline.first().click()
  await page.evaluate(async () => { await window.nextcowork.invoke('settings:update', { locale: 'zh-CN' }) })

  await until('工作区层挂载', async () => (await page.locator('[data-workspace-layer-id]').count()) > 0)
  const A = (await page.locator('[data-workspace-layer-id]').getAttribute('data-workspace-layer-id'))
  const invoke = (channel, req) => page.evaluate(async ([c, r]) => {
    const result = await window.nextcowork.invoke(c, r)
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.message }
  }, [channel, req])

  // 加载角标 = BrowserView 的 loading 覆盖层（t('browser.loading')）
  const pill = page.getByText(/加载中|Loading/, { exact: true })
  const pillVisible = async () => (await pill.count()) > 0 && (await pill.first().isVisible())

  const openAndActivate = async (url, titleKey) => {
    const opened = await invoke('browser:open', { workspaceId: A, url, title: titleKey })
    check(`browser:open ${titleKey} 成功`, opened.ok, opened.ok ? '' : opened.error)
    const tabs = page.locator(`[data-workspace-layer-id="${A}"] [role="tab"]`)
    await until(`内层 tab ${titleKey} 出现`, () => page.locator(`[data-workspace-layer-id="${A}"] [role="tab"][title*="${titleKey}"]`).count())
    await dumpState('tab 出现后、点击前')
    // browser tab 在种子 chat tab 之后追加，取最后一个；点击失败时 dump 全部状态辅助定位
    await tabs.last().click({ timeout: 10_000 }).catch(async (error) => {
      await dumpState('点击超时后')
      dumpLoadingLogs('点击超时')
      throw new Error(`点击内层 tab 失败；原因：${error.message.split('\n')[0]}`)
    })
    await until(`webview ${titleKey} 挂载`, () => page.locator(`[data-workspace-layer-id="${A}"] webview[data-browser-tab-id]`).count())
  }

  // ── 1. 正常页（src 挂载路径）：角标先出现，加载完成后必须清掉 ──
  // 注意：bind 完成后主进程会用页面 <title> 回写 tab 标题，定位用子串匹配防改名竞态。
  await openAndActivate(cleanUrl, 'loadclean')
  const appeared = await within(pillVisible, 5000)
  console.log(`ℹ️ 1a 正常页加载中角标出现 = ${appeared}（页面太快可能错过，不判死）`)
  const cleared = await within(async () => !(await pillVisible()), 8000)
  check('1b 正常页加载完成后角标清除', cleared, cleared ? '' : '❗ 8s 后角标仍在——loading 未复位')
  const idOk = await until('正常页 webContentsId', async () => {
    const v = await page.evaluate(() => {
      const wv = document.querySelector('[data-workspace-layer-id] webview[data-browser-tab-id]')
      try { return wv?.getWebContentsId?.() ?? null } catch { return null }
    })
    return typeof v === 'number' && v > 0 ? v : null
  })
  check('1c 正常页 guest 存活', idOk > 0, String(idOk))

  // ── 2. 地址栏导航路径：setLoading(true) → did-navigate/stop 必须复位 ──
  const address = page.locator('input[spellcheck="false"]')
  await address.fill(cleanUrl2)
  await address.press('Enter')
  await sleep(500)
  const cleared2 = await within(async () => !(await pillVisible()), 8000)
  check('2 地址栏导航后角标清除', cleared2, cleared2 ? '' : '❗ 8s 后角标仍在——navigate() 路径 loading 未复位')

  // ── 3. 挂起资源页：内容渲染但 isLoading 恒真 → 角标持续（与 Chrome 一致）──
  await address.fill(hangUrl)
  await address.press('Enter')
  await sleep(500)
  check('3a 挂起页角标出现', await within(pillVisible, 5000))
  const stillSpinning = await within(pillVisible, 3000)
  check('3b 挂起页角标持续（语义与 Chrome 一致，非 bug）', stillSpinning)
  const guestLoading = await page.evaluate(() => {
    const wv = document.querySelector('webview')
    try { return wv?.isLoading?.() ?? null } catch { return 'throw' }
  })
  check('3c guest isLoading() === true（后端真没加载完）', guestLoading === true, String(guestLoading))

  dumpLoadingLogs('结束')
  console.log(`\n${failed ? 'FAIL' : 'PASS'} — loading 状态探针`)
} catch (error) {
  failed = true
  console.error(`探针挂了：${error.stack ?? error}`)
} finally {
  await app?.close().catch(() => undefined)
  if (profile !== null) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  process.exit(failed ? 1 : 0)
}
