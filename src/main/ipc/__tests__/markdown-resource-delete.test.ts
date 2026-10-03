/**
 * 删除自定义子代理/命令的**落点复核**在 Windows 上不能误杀。
 *
 * 修复前 `deleteResource` 用 `realRoot + '/'`(正斜杠)做字符串前缀判断,而
 * Windows 上 `fs.realpath` 返回反斜杠 —— 前缀永远匹配不上,合法的删除被误判成
 * 「文件位置无效」。这条用例在真实临时目录里走完整条删除路径,把那次回归钉住。
 *
 * ★★ **判别力是 win32 专属的**:那个 bug 只在反斜杠平台复现,POSIX 上旧代码
 * (两种路径形态同形)对这些断言本来就绿。所以在非 Windows 的 CI 上,这份用例
 * 是行为冒烟(删除路径不回归),**不是**那次 bug 的回归哨兵 —— 别误以为它在那边
 * 也守着同一个洞。要跨平台判别得把内联的包含判断抽成可独立断言的纯函数,
 * 收益配不上改动,没做。
 *
 * mock 只替掉运行时单例(`getHost` 给一个真实存在的临时 userData)和窗口广播;
 * `realpath` / `rm` 走真 fs,否则测不出路径形态的问题。mock 写法照 `skill-gate.test.ts`。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: '',
  emit: vi.fn()
}))

vi.mock('../../runtime', () => ({
  getHost: () => ({ paths: { userData: () => mocks.userData } }),
  getEnvironments: () => { throw new Error('unused') },
  getWorkspaceEnvironment: () => { throw new Error('unused') },
  getTools: () => { throw new Error('unused') }
}))
vi.mock('../../window/registry', () => ({ windows: { emitToAll: mocks.emit } }))

const { deleteResource } = await import('../markdown-resource')

let userData = ''

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'nextcowork-md-resource-'))
  mocks.userData = userData
})

afterEach(() => {
  mocks.emit.mockClear()
  rmSync(userData, { recursive: true, force: true })
})

describe('deleteResource 的落点复核(Windows 路径形态)', () => {
  it('★ 删除全局自定义子代理:文件真的被删掉,而不是报「文件位置无效」', async () => {
    mkdirSync(join(userData, 'agents'))
    writeFileSync(join(userData, 'agents', 'foo.md'), '---\nname: foo\ndescription: d\n---\n正文')

    await expect(deleteResource({ kind: 'agent', scope: 'global', name: 'foo' })).resolves.toBeUndefined()

    expect(existsSync(join(userData, 'agents', 'foo.md'))).toBe(false)
    expect(mocks.emit).toHaveBeenCalledWith('agents:changed', undefined)
  })

  it('删除全局自定义命令同理,并广播 commands:changed', async () => {
    mkdirSync(join(userData, 'commands'))
    writeFileSync(join(userData, 'commands', 'foo.md'), '---\nname: foo\ndescription: d\n---\n正文')

    await expect(deleteResource({ kind: 'command', scope: 'global', name: 'foo' })).resolves.toBeUndefined()

    expect(existsSync(join(userData, 'commands', 'foo.md'))).toBe(false)
    expect(mocks.emit).toHaveBeenCalledWith('commands:changed', undefined)
  })
})
