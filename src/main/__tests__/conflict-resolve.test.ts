/**
 * 「AI 解决冲突」的结果闸门 —— `cleanResolvedContent`。
 *
 * ★ 被测的是**写盘前的最后一道关**:模型返回的东西可能是任何样子,而这里判错
 *   一次就是把半成品写进用户的文件、覆盖掉双方真实的改动。所以每一条都对应
 *   一种「绝不能落盘」的形状。
 */
import { describe, expect, it } from 'vitest'
import { cleanResolvedContent } from '../conflict-resolve'

describe('cleanResolvedContent', () => {
  it('正常内容原样通过(含中文和制表符)', () => {
    const content = "const 名字 = '值'\n\tindented()\n"
    expect(cleanResolvedContent(content)).toBe(content)
  })

  it('剥掉一层 ```ts 围栏', () => {
    expect(cleanResolvedContent('```ts\nconst x = 1\n```')).toBe('const x = 1\n')
  })

  it('围栏剥完仍残留冲突标记也拒绝', () => {
    expect(cleanResolvedContent('```\n<<<<<<< HEAD\nconst x = 1\n```')).toBeNull()
  })

  it('残留 <<<<<<< 拒绝', () => {
    expect(cleanResolvedContent('<<<<<<< HEAD\nconst x = 1\n')).toBeNull()
  })

  it('残留 ======= 拒绝', () => {
    expect(cleanResolvedContent('const x = 1\n=======\nconst x = 2\n')).toBeNull()
  })

  it('残留 >>>>>>> 拒绝', () => {
    expect(cleanResolvedContent('const x = 2\n>>>>>>> feature\n')).toBeNull()
  })

  it('残留 ||||||| diff3 基础标记拒绝', () => {
    expect(cleanResolvedContent('const x = 1\n||||||| base\nconst x = 2\n')).toBeNull()
  })

  it('说明文加围栏整体拒绝', () => {
    expect(cleanResolvedContent('Here is the resolved file:\n```ts\nconst x = 1\n```')).toBeNull()
  })

  it('围栏后带说明文字也拒绝', () => {
    expect(cleanResolvedContent('```ts\nconst x = 1\n```\nHope this helps!')).toBeNull()
  })

  it('12 个 < 的加长标记拒绝', () => {
    expect(cleanResolvedContent('<<<<<<<<<<<< HEAD\nconst x = 1\n')).toBeNull()
  })

  it('9 个 = 的加长标记拒绝', () => {
    expect(cleanResolvedContent('const x = 1\n=========\nconst x = 2\n')).toBeNull()
  })

  it('空内容或纯空白拒绝', () => {
    expect(cleanResolvedContent('')).toBeNull()
    expect(cleanResolvedContent('   \n\n\t  ')).toBeNull()
  })

  it('结尾缺换行时补齐', () => {
    expect(cleanResolvedContent('const x = 1')).toBe('const x = 1\n')
  })
})
