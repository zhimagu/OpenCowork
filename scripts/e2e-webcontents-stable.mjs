/**
 * 工作区保活 Electron 单脚本探针（v3.1 §9.4 / D10）。
 *
 * 跑法（不自动 build，构建产物由运行者负责）：
 *   npm run build
 *   node scripts/e2e-webcontents-stable.mjs
 *
 * 覆盖：G1（切 B 切回 id 不变）、G2（pin/unpin 重排后 id 与层 DOM 顺序不变）、
 * G23（transient→resident 用层根 expando 断言不重挂载）、G22 自动化部分（关外层
 * Tab 后 layer 节点移除）。其余 Gate 走 9.1 手动场景。
 *
 * 驱动方式：渲染层 zustand store 未暴露到 window，`page.evaluate` 够不到 store，
 * 故外层 Tab 切换 / pin / unpin / 关闭全走真实 UI；browser tab 用 `browser:open`
 * IPC 创建（主进程广播 `browser:changed` → renderer `syncBrowserTabs`），再点内层
 * Tab 激活以挂载 webview。第二个工作区需要目录对话框，脚本在主进程把
 * `dialog.showOpenDialog` 换成自动返回临时目录。
 */
/* global window, document */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import electron from 'electron'
import { _electron } from 'playwright-core'

const projectRoot = process.cwd()
let failed = false
/** 页面就绪后由主流程赋值，供超时诊断抓 DOM 概况。 */
let probePage = null
/**
 * 定位失败诊断：列出 body 内可见可点元素的 role + 可访问名（截断 10 条）。
 * 文案/菜单改动导致 getByRole 落空时，这条信息能直接指出「现在页面上有什么」。
 */
async function domSummary() {
  if (probePage === null) return '(页面尚未就绪)'
  try {
    return await probePage.evaluate(() => {
      const nodes = [...document.querySelectorAll('button, [role="menuitem"], [role="tab"], [role="separator"]')]
        .filter((el) => {
          const box = el.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        })
        .slice(0, 10)
        .map((el) => {
          const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
          return `${role}:${name}`
        })
      return nodes.length === 0 ? '(无可点元素)' : nodes.join(' | ')
    })
  } catch {
    return '(读取 DOM 失败)'
  }
}
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}
/** 轮询到 fn 返回非 null/undefined/false 为止；超时抛中文错（附当前 DOM 概况）。 */
async function until(label, fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn().catch(() => null)
    if (value !== null && value !== undefined && value !== false) return value
    if (Date.now() > deadline) throw new Error(`超时等待「${label}」；当前可点元素 ≈ ${await domSummary()}`)
    await sleep(100)
  }
}
/** 固定窗口内轮询，返回是否达成（G22 的 1000ms 判据用）。 */
async function within(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await fn().catch(() => false)) return true
    if (Date.now() > deadline) return false
    await sleep(50)
  }
}

let app = null
let profile = null
try {
  profile = await mkdtemp(join(tmpdir(), 'ncw-e2e-webcontents-'))
  // data: 被协议闸拒绝（main/browser/manager.ts:52），用稳定的 file:// 本地页面。
  const pageDir = join(profile, 'page')
  await mkdir(pageDir, { recursive: true })
  const pageFile = join(pageDir, 'probe.html')
  await writeFile(pageFile, '<!doctype html><meta charset="utf-8"><title>probe</title><h1>stable</h1>')
  const pageUrl = pathToFileURL(pageFile).href
  const secondRoot = join(profile, 'workspace-b')
  await mkdir(secondRoot, { recursive: true })

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  delete env.ELECTRON_RENDERER_URL
  app = await _electron.launch({
    executablePath: electron,
    args: [projectRoot, `--user-data-dir=${join(profile, 'ud')}`],
    cwd: projectRoot,
    env
  })
  // 目录选择对话框无法在无头下人工点击 —— 换成「自动返回临时目录」（先例：office-editors-probe.mjs 换 showMessageBox）。
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
  }, secondRoot)

  const page = await app.firstWindow()
  probePage = page
  await page.setViewportSize({ width: 1400, height: 900 })
  const logs = []
  page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  page.on('dialog', (d) => { void d.accept() }) // D13 关闭确认
  globalThis.__probeLogs = logs

  const invoke = (channel, req) => page.evaluate(async ([c, r]) => {
    const result = await window.nextcowork.invoke(c, r)
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error.message }
  }, [channel, req])
  const layerIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-workspace-layer-id]')].map((el) => el.getAttribute('data-workspace-layer-id')))
  const outerTabIds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-outer-tab-id]')].map((el) => el.getAttribute('data-outer-tab-id')))
  const outerTabIdOf = (rootPath) => page.evaluate((p) => {
    const el = [...document.querySelectorAll('[data-outer-tab-id]')].find((e) => e.getAttribute('title') === p)
    return el?.getAttribute('data-outer-tab-id') ?? null
  }, rootPath)
  const probeOf = (ws) => page.evaluate((id) => document.querySelector(`[data-workspace-layer-id="${id}"]`)?.__probe ?? null, ws)
  /** 诊断：每个层节点的 id / active / transient / probe 快照（定位 resident 身份丢失的时刻）。 */
  const layerInfo = (label) => page.evaluate(() =>
    [...document.querySelectorAll('[data-workspace-layer-id]')].map((el) =>
      `${el.getAttribute('data-workspace-layer-id')}(active=${el.getAttribute('data-workspace-active')},transient=${el.getAttribute('data-workspace-transient')},probe=${el.__probe ?? null})`)
  ).then((info) => console.log(`ℹ️ [${label}] stage = ${info.join(' ') || '(空)'}`))
  const webviewIdOf = (ws) => page.evaluate((id) => {
    const wv = document.querySelector(`[data-workspace-layer-id="${id}"] webview[data-browser-tab-id]`)
    try { return wv?.getWebContentsId?.() ?? null } catch { return null }
  }, ws)

  await until('preload 就绪', () => page.evaluate(() => typeof window.nextcowork === 'object'))
  // 全新 user-data-dir 会停在登录页（先例 office-editors-probe.mjs）。
  const offline = page.getByRole('button', { name: /免登录使用|Continue offline/ })
  const shell = page.getByRole('button', { name: /打开工作区|Open workspace/ })
  await until('登录页或工作区外壳', async () => (await offline.count()) > 0 || (await shell.count()) > 0)
  if ((await offline.count()) > 0) await offline.first().click()
  await invoke('settings:update', { locale: 'zh-CN' })
  // 关闭含 browser tab 的外层 Tab 会走 window.confirm（AppShell.tsx:638）—— 直接放行。
  await page.evaluate(() => { window.confirm = () => true })

  // ── 1. 首窗就绪，A = 默认打开的工作区 ──
  await until('工作区层挂载', async () => (await layerIds()).length > 0)
  const A = (await layerIds())[0]
  const bootstrap = await invoke('app:getBootstrap', undefined)
  const wsA = bootstrap.data.workspaces.find((w) => w.id === A)
  if (wsA === undefined) throw new Error(`bootstrap 里找不到工作区 A（${A}）的 rootPath`)
  console.log(`工作区 A = ${A}（${wsA.rootPath}）`)

  // ── 2. 在 A 里开 browser tab 并记录 webContentsId ──
  const openedA = await invoke('browser:open', { workspaceId: A, url: pageUrl, title: 'probe-a' })
  check('A 的 browser:open 成功', openedA.ok, openedA.ok ? '' : openedA.error)
  const innerA = page.locator(`[data-workspace-layer-id="${A}"] [role="tab"][title="probe-a"]`)
  await until('A 内层 browser tab 出现', () => innerA.count())
  // syncBrowserTabs 只挂 Tab 不激活（tabs.ts:1205）——点它才会挂载 BrowserView/webview。
  await innerA.click()
  await until('A 的 webview 挂载', () => page.locator(`[data-workspace-layer-id="${A}"] webview[data-browser-tab-id]`).count())
  const id1 = await until('A 的 webContentsId', async () => {
    const v = await webviewIdOf(A)
    return typeof v === 'number' && v > 0 ? v : null
  })
  check('记录 A 的 webContentsId', true, String(id1))
  await page.evaluate((id) => { document.querySelector(`[data-workspace-layer-id="${id}"]`).__probe = 1 }, A)
  // 进入去抖是 300ms：等到超过窗口后再快照，才能区分「A 从未提交 resident」与「提交后被移出」。
  await sleep(450)
  await layerInfo('A 开 tab 后 +450ms（应 transient=false）')

  // ── 3. 经 UI 创建并打开第二个工作区 B（对话框已在主进程被替换）──
  // 定位策略：结构优先（role），文案兜底为 zh/en 双语正则。耦合点分别是
  // i18n 的 nav.openWorkspace / nav.openFolder；菜单项的 role=menuitem 由
  // MenuItem 组件保证，改文案不会动结构。
  await page.getByRole('button', { name: /打开工作区|Open workspace/ }).click()
  await page.getByRole('menuitem', { name: /打开现有文件夹|Open existing folder/ }).click()
  await until('工作区 B 打开', async () => (await layerIds()).some((id) => id !== A))
  const B = (await layerIds()).find((id) => id !== A)
  const listB = await invoke('workspace:list', undefined)
  const wsB = listB.data.find((w) => w.id === B)
  if (wsB === undefined) throw new Error(`workspace:list 里找不到工作区 B（${B}）`)
  console.log(`工作区 B = ${B}（${wsB.rootPath}）`)
  await layerInfo('B 打开后')
  // B 此刻是 transient（活动、无 browser tab）：打 expando 供 G23 判据（H3）。
  await page.evaluate((id) => { document.querySelector(`[data-workspace-layer-id="${id}"]`).__probe = 1 }, B)

  // ── 4. G23：B 内新开 browser tab，transient → resident 不重挂载 ──
  const openedB = await invoke('browser:open', { workspaceId: B, url: pageUrl, title: 'probe-b' })
  check('G23 在 B 新开 browser tab', openedB.ok, openedB.ok ? '' : openedB.error)
  await until('B 出现 webview', () => page.locator(`[data-workspace-layer-id="${B}"] webview[data-browser-tab-id]`).count())
  check('G23 transient→resident 未重挂载（__probe === 1）', (await probeOf(B)) === 1, String(await probeOf(B)))
  await sleep(450)
  await layerInfo('B 开 tab 后 +450ms（B 应 transient=false，A 应仍在）')

  // ── 5. G1：切回 A，id / expando 不变 ──
  const tabA = await outerTabIdOf(wsA.rootPath)
  const tabB = await outerTabIdOf(wsB.rootPath)
  if (tabA === null || tabB === null) throw new Error(`找不到外层 Tab（A=${tabA}, B=${tabB}）`)
  const layerOrderBefore = await layerIds()
  await layerInfo('切回 A 前（B 活动中，A 应仍在 stage）')
  await page.locator(`[data-outer-tab-id="${tabA}"]`).click()
  await sleep(300)
  await layerInfo('切回 A 后')
  check('G1 切 B 再切回 A 后 webContentsId 不变', (await webviewIdOf(A)) === id1, `${id1} → ${await webviewIdOf(A)}`)
  check('G1 A 层未重挂载（__probe === 1）', (await probeOf(A)) === 1, String(await probeOf(A)))

  // ── 6. G2：pin / unpin B（走 UI 右键菜单 → store.togglePin → orderOuterTabs 重排）──
  // 定位策略：role=menuitem 结构定位 + 双语正则兜底（耦合 i18n 的 nav.pinTab /
  // nav.unpinTab）。同一时刻菜单里只会出现 pin 或 unpin 其中一项，正则不会歧义。
  await page.locator(`[data-outer-tab-id="${tabB}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /置顶标签页|Pin tab/ }).click()
  await sleep(300)
  const orderAfterPin = await outerTabIds()
  check('G2 pin 后外层 Tab 重排（B 置顶）', orderAfterPin[0] === tabB, orderAfterPin.join(','))
  check('G2 pin 后 A 的 webContentsId 不变', (await webviewIdOf(A)) === id1, `${id1} → ${await webviewIdOf(A)}`)
  await page.locator(`[data-outer-tab-id="${tabB}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /取消置顶|Unpin tab/ }).click()
  await sleep(300)
  check('G2 unpin 后 A 的 webContentsId 不变', (await webviewIdOf(A)) === id1, `${id1} → ${await webviewIdOf(A)}`)
  check('G2 层 DOM 顺序不变（append-only）', (await layerIds()).join(',') === layerOrderBefore.join(','), `${layerOrderBefore} → ${await layerIds()}`)

  // ── 7. G22（自动化部分）：关闭 A 的外层 Tab，轮询 1000ms 断言节点移除 ──
  // 先留住 webview 元素引用并监听 destroyed：节点移除后 getWebContentsId 仍可调用。
  await page.evaluate((id) => {
    const wv = document.querySelector(`[data-workspace-layer-id="${id}"] webview[data-browser-tab-id]`)
    window.__probeWv = wv
    window.__probeDestroyed = 0
    wv?.addEventListener('destroyed', () => { window.__probeDestroyed += 1 })
  }, A)
  await page.locator(`[data-outer-tab-id="${tabA}"]`).hover()
  // 关闭按钮改为结构定位：先锁定 A 的外层 Tab 容器，再找其中的
  // data-outer-tab-close（OuterTabBar.tsx 给关闭键加的稳定属性）。
  // 不再依赖 `nav.closeTab` 的中文文案「关闭 X」，i18n/工作区改名都不会脆断。
  await page.locator(`[data-outer-tab-id="${tabA}"] [data-outer-tab-close]`).click()
  const removed = await within(async () => !(await layerIds()).includes(A), 1000)
  check('G22 关闭外层 Tab 后 A 的 layer 节点移除', removed)
  const destroyed = await page.evaluate(() => window.__probeDestroyed ?? 0)
  const threw = await page.evaluate(() => {
    try { window.__probeWv?.getWebContentsId?.(); return false } catch { return true }
  })
  // DOM 已移除时 destroyed 计数 / getWebContentsId 抛错可能读不到，按任务说明以「节点移除」为判据。
  console.log(`ℹ️ destroyed 事件计数=${destroyed}（期望 1）、再次 getWebContentsId 抛错=${threw}（期望 true）`)

  console.log(`\n${failed ? 'FAIL' : 'PASS'} — 控制台日志 ${logs.length} 条`)
  if (failed) for (const line of logs.slice(-15)) console.log(`  [日志尾巴] ${line}`)
} catch (error) {
  failed = true
  console.error(`探针挂了：${error.stack ?? error}`)
  for (const line of (globalThis.__probeLogs ?? []).slice(-40)) console.error(line)
} finally {
  await app?.close().catch(() => undefined)
  if (profile !== null) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  process.exit(failed ? 1 : 0)
}
