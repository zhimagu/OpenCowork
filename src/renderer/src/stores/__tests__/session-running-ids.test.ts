// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAttentionSessionIds, useRunIndex, useRunningSessionIds, type RunIndexEntry } from '../session'

/*
  运行中 / 待处理会话集合的引用稳定性 —— 保活层 memo 的命门(D2/H1):
  集合成员不变时引用必须保持(最好连重渲染都不发生),成员变化时必须换新。
  引用一旦随无关广播(pendingInteractions 更新、别家工作区的启停)换新,
  沿 props 下传就会击穿 memo,就地订阅也会多出无关重渲染。
*/

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  root?.unmount()
  root = null
  container?.remove()
  container = null
  useRunIndex.setState([], true)
})

/** 渲染一个探针,把 hook 每次渲染返回的引用按顺序记下来。 */
function probe(seen: ReadonlySet<string>[]): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const Probe = (): null => {
    seen.push(useRunningSessionIds())
    return null
  }
  act(() => {
    root!.render(createElement(Probe))
  })
}

const run = (runId: string, sessionId: string, pendingInteractions?: number): RunIndexEntry => ({
  runId,
  sessionId,
  workspaceId: 'w1',
  ...(pendingInteractions === undefined ? {} : { pendingInteractions })
})

describe('useRunningSessionIds 的引用稳定性', () => {
  it('成员不变(源数组换了)时不重渲染、引用保持 —— 无关广播不该惊动订阅者', () => {
    const seen: ReadonlySet<string>[] = []
    probe(seen)
    expect(seen.length).toBe(1)

    act(() => { useRunIndex.setState([run('r1', 's1')], true) })
    expect(seen.length).toBe(2)
    expect([...seen[1]!]).toEqual(['s1'])

    // 数组是新的(模拟 pendingInteractions 更新之类的广播),但成员相同
    act(() => { useRunIndex.setState([run('r1', 's1', 1)], true) })
    expect(seen.length).toBe(2)
  })

  it('成员变化时换新引用', () => {
    const seen: ReadonlySet<string>[] = []
    probe(seen)
    act(() => { useRunIndex.setState([run('r1', 's1')], true) })
    const before = seen[seen.length - 1]!

    act(() => { useRunIndex.setState([run('r1', 's1'), run('r2', 's2')], true) })
    const after = seen[seen.length - 1]!
    expect(after).not.toBe(before)
    expect([...after].sort()).toEqual(['s1', 's2'])
  })

  it('run 结束、成员回退时同样换新引用(引用不会永远冻结在旧集合上)', () => {
    const seen: ReadonlySet<string>[] = []
    probe(seen)
    act(() => { useRunIndex.setState([run('r1', 's1'), run('r2', 's2')], true) })
    const two = seen[seen.length - 1]!
    act(() => { useRunIndex.setState([run('r1', 's1')], true) })
    const one = seen[seen.length - 1]!
    expect(one).not.toBe(two)
    expect([...one]).toEqual(['s1'])
  })
})

describe('useAttentionSessionIds', () => {
  it('只收 pendingInteractions > 0 的会话,且引用规则与运行集合一致', () => {
    const seen: ReadonlySet<string>[] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const Probe = (): null => {
      seen.push(useAttentionSessionIds())
      return null
    }
    act(() => {
      root!.render(createElement(Probe))
    })
    expect(seen[0]!.size).toBe(0)

    // 运行中但没有等你处理的:attention 集合不收录 —— 成员没变,不重渲染
    act(() => { useRunIndex.setState([run('r1', 's1')], true) })
    expect(seen.length).toBe(1)

    // 等你处理了:收录,换新引用
    act(() => { useRunIndex.setState([run('r1', 's1', 2)], true) })
    expect(seen.length).toBe(2)
    expect([...seen[1]!]).toEqual(['s1'])
  })
})
