/**
 * 未完成操作的解析 —— 从 `ipc/git.ts` 抽出来的纯函数。
 *
 * 需求:面板要如实告诉用户「仓库卡在一次合并 / rebase / cherry-pick 里」,
 * 而 `git` 没有一条命令直接给出这个枚举 —— 只能自己探测 `MERGE_HEAD` /
 * `CHERRY_PICK_HEAD` / `REBASE_HEAD` 这几个哨兵文件。抽成独立模块是为了能直接喂
 * 字符串跑断言:留在 `ipc/git.ts` 里就得连 `state/store`、`runtime` 一起拖进测试
 * 进程(它们要 electron),于是这段最容易错的文本解析反而测不到。
 */

/**
 * 从 `MERGE_MSG` 的首行解析出合并来源。
 *
 * git 的默认合并信息形状有几种:
 *   `Merge branch 'X'`
 *   `Merge branch 'X' into Y`            —— 合并进非当前分支时
 *   `Merge remote-tracking branch 'origin/X'`
 *   `Merge tag 'v1.0'`
 * 前四种都取引号里的整串(`origin/X` 原样保留,不去掉 remote 前缀 —— 界面显示的
 * 就是用户熟悉的上游名)。认不出的形状返回空串,由调用方显示成「来源未知」,
 * 而不是硬编一个假的。
 *
 * ★ **只认首行**:正文里可能有用户自定义的说明,甚至另一句以 `Merge` 开头的话。
 */
export function parseMergeSource(message: string): string {
  const first = message.split('\n', 1)[0] ?? ''
  const match = /^Merge (?:remote-tracking )?(?:branch|tag) '([^']+)'/.exec(first)
  return match?.[1] ?? ''
}
