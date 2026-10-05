/**
 * `parseMergeSource` 的断言 —— 盯的是 `MERGE_MSG` 首行那几种默认形状。
 *
 * 需求:合并冲突时面板要显示「正在合并 X」,而 X 只能从 git 写的合并信息里抠出来。
 * git 的默认形状有 branch / remote-tracking branch / tag 几种,还有用户自定义正文
 * 和多行的情况。这里每一条都对应一种「抠错了就会显示一个不存在的分支名」的形状。
 */
import { describe, expect, it } from 'vitest'
import { parseMergeSource } from '../git-operation'

describe('parseMergeSource', () => {
  it("reads the branch name from Merge branch 'X'", () => {
    expect(parseMergeSource("Merge branch 'feature/login'")).toBe('feature/login')
  })

  it('reads the branch name from a remote-tracking merge', () => {
    expect(parseMergeSource("Merge remote-tracking branch 'origin/main'")).toBe('origin/main')
  })

  it('reads the tag name from Merge tag', () => {
    expect(parseMergeSource("Merge tag 'v1.2.3'")).toBe('v1.2.3')
  })

  it('tolerates the "into Y" suffix', () => {
    expect(parseMergeSource("Merge branch 'release' into develop")).toBe('release')
  })

  it('returns an empty string for an empty message', () => {
    expect(parseMergeSource('')).toBe('')
  })

  it('returns an empty string for unrelated text', () => {
    expect(parseMergeSource('Fix the flaky test')).toBe('')
    expect(parseMergeSource('Merged everything by hand')).toBe('')
  })

  it('only looks at the first line', () => {
    expect(parseMergeSource("Merge branch 'first'\n\nMerge branch 'second'")).toBe('first')
  })
})
