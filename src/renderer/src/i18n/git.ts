/**
 * Git 管理面板的文案。
 *
 * 单独一个文件而不是往 `index.tsx` 那几千行里塞 —— 照 `extensions.ts` / `ssh.ts` 的先例。
 *
 * ★ `feature.git` / `view.feature.git` 也放在这儿:侧边栏那一格和外层 Tab 标题
 *   都走 `t(\`feature.${f}\`)` 这样的模板字面量,键不在表里的话运行时才暴露成
 *   一个显示出 `feature.git` 原文的按钮。和面板正文放在一起,加功能时不会漏。
 *
 * ★ **四种「开不出来」各有各的话。** 合并成一句「Git 不可用」等于把「这是个 SSH
 *   工作区」和「你没装 git」说成同一件事,而这两者用户要做的事完全不同。
 */

/**
 * 带参数的文案那一个入参类型。★ 必须显式标出来:这个文件没有 `Messages` 的
 * 上下文(它在 `index.tsx` 里),不标的话参数会被推断成 implicit any,
 * spread 进 `ZH` 时整张表都不再匹配 `Messages`。
 */
type Params = Record<string, string | number>

export const gitZh = {
  'feature.git': 'Git',
  'view.feature.git': 'Git',

  'git.title': 'Git',
  'git.description': '管理当前工作区的仓库',
  'git.close': '关闭 Git 面板',
  'git.refresh': '刷新',
  'git.loading': '正在读取仓库…',

  // ── 四种开不出来 ──
  'git.unavailable.remote-workspace': '远程工作区暂不支持 Git 管理',
  'git.unavailable.remote-workspaceHint': 'Git 命令跑在本机,对 SSH 上的目录无从谈起。请在远程终端里操作。',
  'git.unavailable.workspace-unavailable': '读不到工作区目录',
  'git.unavailable.workspace-unavailableHint': '目录可能已被删除、移走,或所在磁盘没有挂载。',
  'git.unavailable.git-missing': '没有找到 git',
  'git.unavailable.not-a-repository': '这个目录不是 Git 仓库',
  'git.unavailable.not-a-repositoryHint': '在终端里执行 git init,或者打开一个已有的仓库。',
  'git.noWorkspace': '还没有打开工作区',
  'git.noWorkspaceHint': '打开一个本地工作区之后,这里显示它的 Git 状态。',

  // ── 分支 ──
  'git.branch': '分支',
  'git.branchDetached': '游离 HEAD',
  'git.branchUnborn': '尚无提交',
  'git.switchBranch': '切换分支',
  'git.newBranch': '新建分支',
  'git.newBranchName': '分支名',
  'git.newBranchPlaceholder': '例如 feature/git-panel',
  'git.newBranchCheckout': '创建后切换过去',
  'git.create': '创建',
  'git.ahead': ({ count }: Params) => `领先 ${String(count)} 个提交`,
  'git.behind': ({ count }: Params) => `落后 ${String(count)} 个提交`,
  'git.noUpstream': '未设置上游',
  'git.pull': '拉取',
  'git.push': '推送',

  // ── 改动列表 ──
  'git.staged': '暂存区',
  'git.unstaged': '未暂存',
  'git.untracked': '未跟踪',
  'git.conflicted': '冲突',
  'git.conflictedHint': '先解决冲突再暂存',
  // 状态字母的 tooltip —— 字母取自 git status 的那一列
  'git.status.modified': '已修改',
  'git.status.added': '新增',
  'git.status.deleted': '已删除',
  'git.status.renamed': '已重命名',
  'git.status.copied': '复制自另一个文件',
  'git.status.typeChanged': '类型变了(文件 / 符号链接)',
  'git.status.untracked': '未跟踪',
  'git.stage': '暂存',
  'git.unstage': '取消暂存',
  'git.stageAll': '全部暂存',
  'git.unstageAll': '全部取消',
  'git.clean': '没有改动',
  'git.cleanHint': '工作区是干净的。',
  'git.filesTruncated': ({ count }: Params) => `改动太多,只显示前 ${String(count)} 个文件`,
  'git.renamedFrom': ({ from }: Params) => `重命名自 ${from}`,

  // ── 提交 ──
  'git.commitMessage': '提交信息',
  'git.commitPlaceholder': '这次改动做了什么',
  'git.commit': '提交',
  'git.commitDone': ({ hash }: Params) => `已提交 ${hash}`,
  'git.nothingStaged': '暂存区是空的',

  // ── AI 写提交信息 ──
  'git.aiGenerate': 'AI 生成提交信息',
  'git.aiGenerating': '正在生成…',
  'git.aiNoModel': '还没配默认模型,先去设置里选一个',
  'git.aiTimeout': '生成超时了,再试一次',
  'git.aiFailed': '生成失败,再试一次',
  'git.aiUnparsable': '模型没给出可用的提交信息',
  'git.aiTruncated': '模型的回答被截断了,再试一次',

  // ── diff / 历史 ──
  'git.tab.changes': '改动',
  'git.tab.history': '历史',
  'git.selectFile': '选一个文件查看改动',
  'git.diffBinary': '二进制文件,没有可显示的文本改动',
  'git.diffTruncated': '改动过大,以下内容已被截断',
  // 统计条上那两个数字只是 `+12` / `−3`,tooltip 负责把它们说成人话
  'git.diffAdded': ({ count }: Params) => `新增 ${String(count)} 行`,
  'git.diffRemoved': ({ count }: Params) => `删除 ${String(count)} 行`,
  'git.diffLinesTruncated': ({ shown, total }: Params) =>
    `只显示了前 ${String(shown)} 行,共 ${String(total)} 行`,
  'git.diffEmpty': '这个文件没有文本改动',
  'git.noCommits': '还没有提交',
  'git.historyOf': '提交历史',

  // ── 失败 ──
  'git.operationFailed': '操作失败',
  'git.invalidBranch': '分支名不合法',
  'git.invalidPath': '文件路径不合法',
  'git.detachedPush': '当前是游离 HEAD,没有可推送的分支',
  'git.emptyMessage': '提交信息不能为空',

  // ── 合并 ──
  'git.merge': '合并分支',
  'git.mergeTitle': '合并分支到当前分支',
  'git.mergeSource': '来源分支',
  'git.mergeAction': '合并',
  'git.mergeDone': ({ branch }: Params) => `已将 ${branch} 合并到当前分支`,
  'git.mergeUpToDate': ({ branch }: Params) => `当前分支已包含 ${branch} 的全部提交`,
  'git.mergeConflicted': ({ count }: Params) =>
    `合并产生 ${String(count)} 个冲突文件:可让 AI 解决,也可手动处理后提交`,
  'git.mergeConflictsResolved': '冲突已全部解决,提交以完成合并',
  // ── 未完成的 git 操作 / 待解决冲突(横幅与冲突分组) ──
  'git.conflictGroup': '冲突',
  'git.conflictsPending': ({ count }: Params) =>
    `当前有 ${String(count)} 个文件冲突未解决:可让 AI 解决、转到会话,或手动处理后暂存`,
  // rebase / cherry-pick 的出路是回终端 --continue:那两步会接着跑后面的提交,
  // 面板里既没有「继续」按钮,也不该替用户猜下一个冲突在哪个 commit。
  'git.operationResolved': ({ operation }: Params) =>
    `冲突已解决,回终端执行 git ${operation} --continue`,
  // squash / revert 停在中间时没有 operation 哨兵,但冲突解决完的下一步仍是提交
  'git.conflictsResolvedHint': '冲突已解决,提交以完成',
  'git.resolveWithAi': 'AI 解决冲突',
  'git.openInSession': '在会话中解决',
  // 标题不再写死「合并」:rebase / cherry-pick 停住时也能用这条路(提示词自己说清是哪种)
  'git.conflictSessionTitle': '解决 Git 冲突',
  // 预填进新会话输入框的需求描述(不自动发送)。★ 函数模板:
  // - operation 决定开头那句怎么说、以及第 3 步的出路(合并提交 vs --continue);
  // - 「来源分支」那半句只在 merge 时出现,读不到就说未知(rebase 没有来源分支这回事);
  // - files 由调用方按行拼好(AI 失败过的路径附带原因);
  // - 换行全用 \n 显式写,不让源码缩进混进提示词。
  // ★ 第 1 步是护栏:Agent 有写权限,先让它把方案说出来等人确认,免得它一上来就
  //   按自己的理解改文件 —— 冲突怎么合是用户的决定,不是它的。
  'git.conflictSessionPrompt': ({ operation, branch, count, files }: Params) => {
    const op = String(operation)
    const head =
      op === 'merge'
        ? '当前仓库有一次未完成的合并'
        : op === 'rebase'
          ? '当前仓库有一次未完成的 rebase'
          : op === 'cherry-pick'
            ? '当前仓库有一次未完成的 cherry-pick'
            : '当前仓库有一次未完成的 git 操作'
    const source =
      op !== 'merge' ? '' : String(branch) === '' ? '(来源分支未知)' : `(来源分支:${String(branch)})`
    const finish =
      op === 'rebase'
        ? '3. 全部解决后运行 git rebase --continue;遇到下一个冲突按同样的流程处理。'
        : op === 'cherry-pick'
          ? '3. 全部解决后运行 git cherry-pick --continue。'
          : '3. 全部解决后完成合并提交(沿用默认合并信息即可)。'
    return (
      `${head}${source},有 ${String(count)} 个冲突文件尚未解决:\n\n${String(files)}\n\n` +
      '请按下面的流程解决这次冲突:\n' +
      '1. 先完整阅读每个冲突文件(大文件也要读完),列出冲突点和你打算怎么解决,**先发给我确认,我确认之前不要改任何文件**。\n' +
      '2. 我确认后:保留双方各自意图正确的改动,删除所有冲突标记(<<<<<<<、=======、|||||||、>>>>>>>),用 git add 暂存这些文件。\n' +
      `${finish}遇到二进制文件或必须二选一的情况,先问我保留哪一侧。\n` +
      '4. 不要改动与冲突无关的文件。'
    )
  },
  'git.resolving': 'AI 正在解决冲突…',
  'git.resolvePartial': '部分冲突未能自动解决,请手动处理',
  'git.abortMerge': '中止合并',
  'git.abortMergeTitle': '中止合并?',
  'git.abortMergeBody': '本次合并的全部改动都会被丢弃,包含已经解决的冲突。',
  // AI 解决不了的那几种各有各的原因,而且用户要做的事不一样:前两种是「只能手动」,
  // 后两种是「可以重来」。合并成一句「解决失败」等于把可重试的说成不可重试的。
  'git.resolveFailed.binary': '二进制文件冲突,需要手动处理',
  'git.resolveFailed.tooLarge': '文件过大,未交给 AI,请手动解决',
  'git.resolveFailed.deleted': '双方都删除了该文件,请手动确认保留还是删除',
  'git.resolveFailed.unresolved': 'AI 未能给出可用的解决结果,请手动处理',
  'git.resolveFailed.aiFailed': 'AI 调用失败,可重试或手动处理',
  'git.resolveFailed.limit': '本次只处理了部分冲突文件,其余请再次点击或手动处理',
  'git.resolveFailed.changed': '文件在 AI 解决期间被改动(或合并已中止),未覆盖,请手动检查',
  'git.resolveFailed.symlink': '符号链接文件不自动改写,请手动处理',
  'git.resolveFailed.stageFailed': '文件已解决但暂存失败,请手动暂存',
  'git.mergeFailed': '合并失败',
  'git.abortMergeFailed': '中止合并失败',
  'git.mergeInProgress': '已有未完成的 git 操作,先处理它'
}

export const gitEn = {
  'feature.git': 'Git',
  'view.feature.git': 'Git',

  'git.title': 'Git',
  'git.description': 'Manage the current workspace repository',
  'git.close': 'Close the Git panel',
  'git.refresh': 'Refresh',
  'git.loading': 'Reading repository…',

  'git.unavailable.remote-workspace': 'Git management is not available for remote workspaces',
  'git.unavailable.remote-workspaceHint': 'Git runs on this machine, so it cannot reach a directory over SSH. Use a remote terminal instead.',
  'git.unavailable.workspace-unavailable': 'The workspace directory cannot be read',
  'git.unavailable.workspace-unavailableHint': 'It may have been deleted or moved, or its disk is not mounted.',
  'git.unavailable.git-missing': 'git was not found',
  'git.unavailable.not-a-repository': 'This directory is not a Git repository',
  'git.unavailable.not-a-repositoryHint': 'Run git init in a terminal, or open an existing repository.',
  'git.noWorkspace': 'No workspace is open',
  'git.noWorkspaceHint': 'Open a local workspace to see its Git status here.',

  'git.branch': 'Branch',
  'git.branchDetached': 'Detached HEAD',
  'git.branchUnborn': 'No commits yet',
  'git.switchBranch': 'Switch branch',
  'git.newBranch': 'New branch',
  'git.newBranchName': 'Branch name',
  'git.newBranchPlaceholder': 'e.g. feature/git-panel',
  'git.newBranchCheckout': 'Switch to it after creating',
  'git.create': 'Create',
  'git.ahead': ({ count }: Params) => `${String(count)} ahead`,
  'git.behind': ({ count }: Params) => `${String(count)} behind`,
  'git.noUpstream': 'No upstream set',
  'git.pull': 'Pull',
  'git.push': 'Push',

  'git.staged': 'Staged',
  'git.unstaged': 'Changes',
  'git.untracked': 'Untracked',
  'git.conflicted': 'Conflicted',
  'git.conflictedHint': 'Resolve the conflict before staging',
  'git.status.modified': 'Modified',
  'git.status.added': 'Added',
  'git.status.deleted': 'Deleted',
  'git.status.renamed': 'Renamed',
  'git.status.copied': 'Copied from another file',
  'git.status.typeChanged': 'Type changed (file / symlink)',
  'git.status.untracked': 'Untracked',
  'git.stage': 'Stage',
  'git.unstage': 'Unstage',
  'git.stageAll': 'Stage all',
  'git.unstageAll': 'Unstage all',
  'git.clean': 'No changes',
  'git.cleanHint': 'The working tree is clean.',
  'git.filesTruncated': ({ count }: Params) => `Too many changes — showing the first ${String(count)} files`,
  'git.renamedFrom': ({ from }: Params) => `Renamed from ${from}`,

  'git.commitMessage': 'Commit message',
  'git.commitPlaceholder': 'What does this change do?',
  'git.commit': 'Commit',
  'git.commitDone': ({ hash }: Params) => `Committed ${hash}`,
  'git.nothingStaged': 'Nothing is staged',

  'git.aiGenerate': 'Write a commit message with AI',
  'git.aiGenerating': 'Generating…',
  'git.aiNoModel': 'No default model is configured — pick one in Settings first',
  'git.aiTimeout': 'Generation timed out — try again',
  'git.aiFailed': 'Generation failed — try again',
  'git.aiUnparsable': 'The model did not return a usable commit message',
  'git.aiTruncated': 'The model\u2019s reply was cut off — try again',

  'git.tab.changes': 'Changes',
  'git.tab.history': 'History',
  'git.selectFile': 'Select a file to see its changes',
  'git.diffBinary': 'Binary file — no text changes to show',
  'git.diffTruncated': 'The change is large; the content below is truncated',
  'git.diffAdded': ({ count }: Params) => `${String(count)} lines added`,
  'git.diffRemoved': ({ count }: Params) => `${String(count)} lines removed`,
  'git.diffLinesTruncated': ({ shown, total }: Params) =>
    `Showing the first ${String(shown)} of ${String(total)} lines`,
  'git.diffEmpty': 'This file has no text changes',
  'git.noCommits': 'No commits yet',
  'git.historyOf': 'Commit history',

  'git.operationFailed': 'The operation failed',
  'git.invalidBranch': 'Invalid branch name',
  'git.invalidPath': 'Invalid file path',
  'git.detachedPush': 'HEAD is detached — there is no branch to push',
  'git.emptyMessage': 'The commit message cannot be empty',

  'git.merge': 'Merge branch',
  'git.mergeTitle': 'Merge a branch into the current branch',
  'git.mergeSource': 'Source branch',
  'git.mergeAction': 'Merge',
  'git.mergeDone': ({ branch }: Params) => `Merged ${branch} into the current branch`,
  'git.mergeUpToDate': ({ branch }: Params) =>
    `The current branch already contains all commits from ${branch}`,
  'git.mergeConflicted': ({ count }: Params) =>
    `The merge produced ${String(count)} conflicted files. Resolve them with AI or fix them manually, then commit.`,
  'git.mergeConflictsResolved': 'All conflicts resolved. Commit to finish the merge.',
  'git.conflictGroup': 'Conflicts',
  'git.conflictsPending': ({ count }: Params) =>
    `There are ${String(count)} conflicted files: resolve with AI, hand off to a session, or fix them manually and stage`,
  'git.operationResolved': ({ operation }: Params) =>
    `Conflicts resolved — run git ${operation} --continue in your terminal`,
  'git.conflictsResolvedHint': 'Conflicts resolved — commit to finish.',
  'git.resolveWithAi': 'Resolve with AI',
  'git.openInSession': 'Resolve in a session',
  'git.conflictSessionTitle': 'Resolve Git conflicts',
  'git.conflictSessionPrompt': ({ operation, branch, count, files }: Params) => {
    const op = String(operation)
    const head =
      op === 'merge'
        ? 'This repository has an unfinished merge'
        : op === 'rebase'
          ? 'This repository has an unfinished rebase'
          : op === 'cherry-pick'
            ? 'This repository has an unfinished cherry-pick'
            : 'This repository has an unfinished git operation'
    const source =
      op !== 'merge'
        ? ''
        : String(branch) === ''
          ? ' (source branch unknown)'
          : ` (source branch: ${String(branch)})`
    const finish =
      op === 'rebase'
        ? '3. Once everything is resolved, run git rebase --continue; if the next commit conflicts, follow the same process.'
        : op === 'cherry-pick'
          ? '3. Once everything is resolved, run git cherry-pick --continue.'
          : '3. Once everything is resolved, complete the merge commit (the default merge message is fine).'
    return (
      `${head}${source} with ${String(count)} conflicted files:\n\n${String(files)}\n\n` +
      'Please resolve this conflict, step by step:\n' +
      '1. First read every conflicted file in full (even large ones), list the conflict points and how you plan to resolve them, and **send that to me for confirmation — do not modify any file before I confirm**.\n' +
      '2. After I confirm: keep the correct changes from both sides, remove all conflict markers (<<<<<<<, =======, |||||||, >>>>>>>), and stage the files with git add.\n' +
      `${finish} If a file is binary or requires choosing one side, ask me which side to keep first.\n` +
      '4. Do not touch files unrelated to the conflict.'
    )
  },
  'git.resolving': 'AI is resolving conflicts…',
  'git.resolvePartial':
    'Some conflicts could not be resolved automatically — fix them manually.',
  'git.abortMerge': 'Abort merge',
  'git.abortMergeTitle': 'Abort the merge?',
  'git.abortMergeBody': 'This discards everything from this merge, including already-resolved conflicts.',
  'git.resolveFailed.binary': 'Binary file — resolve it manually',
  'git.resolveFailed.tooLarge': 'File too large to send to AI — resolve it manually',
  'git.resolveFailed.deleted': 'Deleted on both sides — decide manually whether to keep or delete',
  'git.resolveFailed.unresolved': 'AI could not produce a usable result — resolve it manually',
  'git.resolveFailed.aiFailed': 'AI request failed — retry or resolve manually',
  'git.resolveFailed.limit':
    'Only part of the conflicts were processed — run again or fix the rest manually',
  'git.resolveFailed.changed':
    'The file changed while AI was resolving (or the merge was aborted) — left untouched, check it manually',
  'git.resolveFailed.symlink': 'Symlink — not rewritten automatically, resolve it manually',
  'git.resolveFailed.stageFailed': 'Resolved but staging failed — stage it manually',
  'git.mergeFailed': 'Merge failed',
  'git.abortMergeFailed': 'Failed to abort the merge',
  'git.mergeInProgress': 'A git operation is already in progress — finish or abort it first'
}
