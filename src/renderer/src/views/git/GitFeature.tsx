/**
 * Git 管理面板 —— 侧边栏那一格点开的外层 feature Tab。
 *
 * 结构照 `scheduled/ScheduledFeature.tsx`:左栏列表 + 右栏详情、顶部标题栏带关闭。
 * 远程工作区的降级照 `browser/BrowserFeature.tsx` —— 但**判断不在这里做**:
 * 主进程已经把「能不能用」算成了 `GitOverview.available`,这里只负责把四种
 * 不可用各自说清楚。渲染层重复判一遍 `isLocalEnvironment` 只会多一个会和
 * 主进程说法不一致的真相源。
 *
 * ★ **主进程抛上来的 message 有两种。** 一种是我们自己的 i18n 键
 *   (`git.invalidBranch` / `git.unavailable.*`),一种是 git 自己的 stderr
 *   (「Your local changes would be overwritten…」)。后者**恰恰是最该原样显示的**
 *   —— 换成一句「操作失败」等于把 git 唯一一次把话说明白的机会扔掉。
 *   所以这里只对**已知键**做翻译,其余照搬。`Translate` 不支持探测键是否存在,
 *   白名单是唯一能在编译期站住的办法。
 *
 * ★ **文件图标复用 `lib/file-icon.ts`,不另起一套。** 那套彩色图标是文件树在用的,
 *   同一个 `.ts` 在树里和在 Git 面板里必须长得一样 —— 两处各自维护一张扩展名表,
 *   迟早会分叉成「文件树认得 .mjs、Git 面板不认得」。
 *
 * ★ **提交框不用 `TextArea`。** 那个组件的草稿只在失焦时 commit(`useDraft`),
 *   而这里要三件它给不了的事:AI 生成后**从外面**把文本填进来(`useDraft` 只在
 *   未聚焦时同步外部值)、提交按钮的禁用态跟着当前字数走、⌘↵ 直接提交。
 *   所以就地写了一个受控的 `CommitBox`,类名照抄 `TextArea` 保持外观一致。
 *
 * ★ **自动刷新只能靠轮询。** 仓库这边没有 FS 监听 —— `services/workspace-files`
 *   的 `WorkspaceFilesChanged` 是渲染层自己的事件总线,只在应用自己改过文件后
 *   才响,看不见用户在终端里 `git add` 了什么。而用户多半正是从终端切回来的,
 *   所以窗口重新获得焦点时立刻刷一次,可见时再低频兜底;隐藏的标签页不刷。
 *
 * ★ **AI 写提交信息不传模型。** 主进程读设置里的默认模型(同「AI 生成子代理」)。
 *   渲染层这一侧根本拿不到设置:它们是 `App.tsx` 的 state,而 Git 面板走
 *   `FeatureView`,不在那条 props 链上。
 *
 * ★ **diff 的文本解析不在这里,在 `components/diff/parse-unified.ts`。** 行号推算和
 *   「哪一行算正文」是这个面板里唯一算得上算法的一段,留在组件里就只能靠肉眼验收 ——
 *   而它错了不会报错,只会让行号整体串位。抽出去之后有
 *   `components/diff/__tests__/parse-unified.test.ts`;画行的那一份也一并挪去了
 *   `components/diff/DiffLines.tsx`,现在和聊天里的 diff 是同一个组件。
 */
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  GitMerge,
  History,
  MessageSquarePlus,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitConflictFailure,
  GitConflictResolution,
  GitDiff,
  GitFileChange,
  GitMergeResult,
  GitOperation,
  GitOverview,
  GitUnavailableReason
} from '../../../../shared/domain/git'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Segmented } from '../../components/ui/Segmented'
import { Select } from '../../components/ui/Select'
import { Spinner } from '../../components/ui/Spinner'
import { TextInput } from '../../components/ui/TextInput'
import { Toggle } from '../../components/ui/Toggle'
import { useI18n, type TranslationKey, type Translate } from '../../i18n'
import { cn } from '../../lib/cn'
import { iconFor } from '../../lib/file-icon'
import {
  abortGitMerge,
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  generateGitCommitMessage,
  getGitDiff,
  getGitOverview,
  listGitBranches,
  listGitCommits,
  mergeGit,
  pullGit,
  pushGit,
  resolveGitConflicts,
  stageGitPaths,
  unstageGitPaths
} from '../../services/git'
import { createSession } from '../../services/sessions'
import { FeatureFrame } from '../../shell/FeatureFrame'
import { sessionStore } from '../../stores/session'
import { useTabsStore } from '../../stores/tabs'
import { useWindowStore } from '../../stores/window'
import { DiffLines } from '../../components/diff/DiffLines'
import { parseUnifiedDiff } from '../../components/diff/parse-unified'
import { languageOf } from '../../components/code'

/** 主进程会原样抛回来的 i18n 键。不在表里的一律当作 git 的原话显示。 */
const KNOWN_ERROR_KEYS = [
  'git.invalidBranch',
  'git.nothingStaged',
  'git.aiNoModel',
  'git.aiTimeout',
  'git.aiFailed',
  'git.aiUnparsable',
  'git.aiTruncated',
  'git.invalidPath',
  'git.detachedPush',
  'git.emptyMessage',
  'git.mergeFailed',
  'git.abortMergeFailed',
  'git.mergeInProgress',
  'git.unavailable.remote-workspace',
  'git.unavailable.workspace-unavailable',
  'git.unavailable.git-missing',
  'git.unavailable.not-a-repository'
] as const

type KnownErrorKey = (typeof KNOWN_ERROR_KEYS)[number]

/** 有补充说明的那三种不可用。`git-missing` 故意没有:标题本身已经是全部信息。 */
type HintedReason = Exclude<GitUnavailableReason, 'git-missing'>

type Pane = 'changes' | 'history'
/** 哪一颗按钮该转圈。别的写操作很快,不值得一个指示器。 */
type Pending = 'pull' | 'push' | 'merge'
type Selection = { path: string; staged: boolean }

/**
 * AI 解决不了冲突的那几种原因,各自的人话。
 *
 * ★ 表而不是 `t(\`git.resolveFailed.${reason}\`)`:`TranslationKey` 是字面量联合,
 *   模板字面量拼出来的 `string` 进不去,那条写法在编译期就是错的(仓库里
 *   `ToolTimeline.tsx:274` 用的是同一张表的做法)。
 */
const RESOLVE_FAILURE_KEYS = {
  binary: 'git.resolveFailed.binary',
  tooLarge: 'git.resolveFailed.tooLarge',
  deleted: 'git.resolveFailed.deleted',
  unresolved: 'git.resolveFailed.unresolved',
  aiFailed: 'git.resolveFailed.aiFailed',
  limit: 'git.resolveFailed.limit',
  changed: 'git.resolveFailed.changed',
  symlink: 'git.resolveFailed.symlink',
  stageFailed: 'git.resolveFailed.stageFailed'
} as const satisfies Record<GitConflictFailure, TranslationKey>

/** 失败原因 → 文案键。主进程万一给出表里没有的原因,退到 `unresolved`(也是句人话)。 */
function resolveFailureKey(reason: GitConflictFailure | undefined): TranslationKey {
  return RESOLVE_FAILURE_KEYS[reason ?? 'unresolved'] ?? RESOLVE_FAILURE_KEYS.unresolved
}

/**
 * 冲突清零之后该说什么。
 *
 * ★ merge 的出路是提交,rebase / cherry-pick 的出路是回终端 `--continue` —— 说反了
 *   用户会卡在同一个地方两次。横幅和 AI 解决后的 notice 共用这一份,两处不说两套话。
 */
function resolvedCopy(operation: GitOperation, t: Translate): string {
  return operation === 'merge' ? t('git.mergeConflictsResolved') : t('git.operationResolved', { operation })
}

const HISTORY_LIMIT = 50

/**
 * diff 最多渲染这么多行。
 *
 * ★ 主进程已经按 200KB 截断过,但 200KB 的源码仍然是好几千行,而每一行都是一个
 *   带 className 的 `<div>`。**一次 rebase 后的大 diff 能让选中文件这个动作卡住
 *   半秒**,而超过一屏的部分没有人会滚着读完 —— 要读整份的人用的是编辑器。
 */
const DIFF_LINE_LIMIT = 1200

/** 可见时的兜底轮询间隔。见文件头 ★:没有 FS 监听。 */
const POLL_MS = 15_000

function errorText(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error)
  const known = (KNOWN_ERROR_KEYS as readonly string[]).includes(message)
  return known ? t(message as KnownErrorKey) : message
}

/** 列表里那一格状态字母。未跟踪的 worktree 是 `?`,直接拿来用。 */
function statusLetter(file: GitFileChange, staged: boolean): string {
  const letter = staged ? file.index : file.worktree
  return letter === '.' || letter === '' ? ' ' : letter
}

/**
 * 状态字母的语义:一个颜色 + 一句 tooltip。
 *
 * ★ **M 故意是中性色。** 改动是列表里最常见的一种,给它上色等于给整张列表上色,
 *   结果是「新增」和「删除」这两个真正需要一眼认出来的反而淹了。
 */
function statusMeta(letter: string, t: Translate): { className: string; title: string } {
  if (letter === 'A') return { className: 'text-accent', title: t('git.status.added') }
  if (letter === '?') return { className: 'text-accent', title: t('git.status.untracked') }
  if (letter === 'D') return { className: 'text-danger', title: t('git.status.deleted') }
  if (letter === '!') return { className: 'text-danger', title: t('git.conflicted') }
  if (letter === 'R') return { className: 'text-accent-soft', title: t('git.status.renamed') }
  if (letter === 'C') return { className: 'text-accent-soft', title: t('git.status.copied') }
  if (letter === 'T') return { className: 'text-accent-soft', title: t('git.status.typeChanged') }
  if (letter === 'M') return { className: 'text-fg-muted', title: t('git.status.modified') }
  return { className: 'text-fg-faint', title: '' }
}

export function GitFeature({ onClose }: { onClose?: () => void } = {}): ReactNode {
  const { t } = useI18n()
  const workspaceId = useWindowStore((state) => state.activeWorkspaceId)
  const [overview, setOverview] = useState<GitOverview | null>(null)
  const [branches, setBranches] = useState<GitBranchSummary[]>([])
  const [commits, setCommits] = useState<GitCommitSummary[]>([])
  const [pane, setPane] = useState<Pane>('changes')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [diff, setDiff] = useState<GitDiff | null>(null)
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [newCheckout, setNewCheckout] = useState(true)
  const [busy, setBusy] = useState(false)
  /** 正在跑的是哪一个写操作 —— 只为了把转圈画在**被点的那颗按钮**里。 */
  const [pending, setPending] = useState<Pending | null>(null)
  const [generating, setGenerating] = useState(false)
  /*
    AI 解决冲突期间。**独立于 `busy`** —— 照 `generating` 那条路子:它一次调用
    什么都不提交(改的是工作区文件),不该顺手把整个面板锁成「别的写操作都别点」。
    只锁合并 / 中止 / AI 这三颗,重跑同一件事没有意义。
  */
  const [resolving, setResolving] = useState(false)
  /** 上一次 AI 解决冲突里失败的那几项,列在横幅上。新一次合并 / 中止合并时清掉。 */
  const [resolveFailures, setResolveFailures] = useState<GitConflictResolution[]>([])
  /** 合并对话框:打开着 + 选中的来源分支 */
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSource, setMergeSource] = useState('')
  const [abortOpen, setAbortOpen] = useState(false)
  /** 建会话 + 预填草稿期间(防连点,独立于 `busy` —— 它不改仓库) */
  const [handoff, setHandoff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 并发刷新的版本号:连点刷新时,只有最后一次的结果准落地
  const loadVersion = useRef(0)
  /*
    ★ **两个守卫管的是两件不同的事**:`loadVersion` 防**乱序**(同一工作区里两次刷新
      谁后落地),`workspaceIdRef` 防**跨工作区** —— 版本号只比「谁新」,不比「是谁」:
      切了工作区之后,旧闭包(轮询 / resolve / run)手里那个 `workspaceId` 还是旧仓库,
      它回来时 `loadVersion` 也可能恰好仍然相等(新一轮刷新还没 bump),于是旧仓库的
      overview 会灌进新工作区的面板,直到 15 秒后轮询把它盖回来。
    渲染期同步(和 Dialog 里那个 `onCloseRef` 同一手法):effect 里同步会晚一拍,
    而这一守卫要的恰恰是"切了就走"。
  */
  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId
  // 轮询回调里读 busy —— 放进 effect 的依赖会让定时器每次置忙都重建一遍
  const busyRef = useRef(false)
  /*
    改动列表的指纹 + 修订号。轮询回来的 `overview` 每次都是新对象,但内容多半
    没变;只有指纹真的变了才 bump `revision`,不然当前打开的 diff 会每 15 秒
    无谓地重取一次(而且会打断正在进行的文本选择)。
  */
  const signature = useRef('')
  const [revision, setRevision] = useState(0)

  // 摘出布尔量而不是直接把 `overview` 挂进依赖:轮询每次都换一个新对象,
  // 挂对象的话历史面板会每 15 秒重跑一次 `git log`
  const available = overview !== null && overview.available

  /** `silent` 是给轮询用的:后台刷新失败不该往界面上糊一条用户没招来的红字。 */
  const refresh = useCallback(
    async (silent = false): Promise<GitOverview | null> => {
      // ★ 入口先验身份(在 bump 之前):跨工作区的旧闭包既不该落 state,也不该
      //   bump 版本号把新工作区正在路上的那次刷新顶掉
      if (workspaceIdRef.current !== workspaceId) return null
      if (workspaceId === null) {
        setOverview(null)
        return null
      }
      const version = ++loadVersion.current
      try {
        const next = await getGitOverview(workspaceId)
        if (version !== loadVersion.current) return null
        if (workspaceIdRef.current !== workspaceId) return null
        setOverview(next)
        const sign = next.available
          ? `${next.branch}\u0000${next.files.map((f) => `${f.path}${f.index}${f.worktree}`).join('\n')}`
          : ''
        if (sign !== signature.current) {
          signature.current = sign
          setRevision((v) => v + 1)
        }
        if (!next.available) {
          setBranches([])
          setCommits([])
          return next
        }
        const list = await listGitBranches(workspaceId)
        if (version !== loadVersion.current) return null
        if (workspaceIdRef.current !== workspaceId) return null
        setBranches(list)
        return next
      } catch (e) {
        if (version !== loadVersion.current || silent) return null
        if (workspaceIdRef.current !== workspaceId) return null
        setError(errorText(e, t))
        return null
      }
    },
    [workspaceId, t]
  )

  useEffect(() => {
    setSelection(null)
    setDiff(null)
    setCommits([])
    setPane('changes')
    setMergeOpen(false)
    setAbortOpen(false)
    setResolveFailures([])
    signature.current = ''
    void refresh()
  }, [refresh])

  /*
    自动刷新。焦点回来时立刻刷(用户刚从终端切回来),可见时再低频兜一次。
    ★ 隐藏的标签页**不刷** —— 后台每 15 秒跑一趟 `git status` 是在替一个没人看
      的面板烧电;`visibilitychange` 那一跳负责在切回来的瞬间补上。
  */
  useEffect(() => {
    if (workspaceId === null) return
    const tick = (): void => {
      if (document.hidden || busyRef.current) return
      void refresh(true)
    }
    const timer = window.setInterval(tick, POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [workspaceId, refresh])

  // 历史是按需拉的:大仓库上 `git log` 不该在每次开面板时都跑一趟
  useEffect(() => {
    if (pane !== 'history' || workspaceId === null || !available) return
    let alive = true
    listGitCommits(workspaceId, HISTORY_LIMIT)
      .then((list) => {
        if (alive) setCommits(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(errorText(e, t))
      })
    return () => {
      alive = false
    }
  }, [pane, workspaceId, available, revision, t])

  useEffect(() => {
    if (selection === null || workspaceId === null) {
      setDiff(null)
      return
    }
    let alive = true
    getGitDiff(workspaceId, selection.path, selection.staged)
      .then((next) => {
        if (alive) setDiff(next)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setDiff(null)
        setError(errorText(e, t))
      })
    return () => {
      alive = false
    }
  }, [selection, workspaceId, revision, t])

  /**
   * 所有写操作的统一外壳:置忙、清提示、失败留话、成功后刷新。
   *
   * ★ `tag` 只影响转圈画在哪 —— `busy` 仍然是全局的(同时 pull 和 commit 没有
   *   任何意义),但 pull / push 一等就是几十秒,把指示器画在别处等于没画。
   */
  /*
    ★ AI 解决冲突期间也挡:它一边改工作树文件一边 `git add`,同一时刻再跑一次
      checkout / commit / stage 就是让两个写者抢同一个索引。`resolve()` 自己不走
      这里(它不该被自己挡死),所以这条守卫不会误锁它。
  */
  const run = async (action: () => Promise<void>, tag?: Pending): Promise<void> => {
    if (busy || resolving) return
    setBusy(true)
    busyRef.current = true
    setPending(tag ?? null)
    setError(null)
    setNotice(null)
    try {
      await action()
      await refresh()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
      busyRef.current = false
      setPending(null)
    }
  }

  const files = overview !== null && overview.available ? overview.files : []
  /*
    ★ 冲突文件既不在 `staged` 也不在 `unstaged` 里 —— 主进程的 `change()` 给两者的
      条件都带 `!conflicted`(冲突文件没有「已暂存的改动」这回事)。所以它们**必须
      单列一组**,否则用户点开面板只看到「没有改动」,而仓库正卡在冲突上。
  */
  const conflicted = useMemo(() => files.filter((f) => f.conflicted), [files])
  const staged = useMemo(() => files.filter((f) => f.staged), [files])
  const unstaged = useMemo(() => files.filter((f) => f.unstaged || f.untracked), [files])
  /*
    ★ 失败清单是**上一轮 AI 的产物**,而它会比冲突本身活得更久:用户手动解决掉一个
      文件、或轮询刷过来一个中间态之后,`resolveFailures` 里那条记录还在 state 上
      (state 的清理时机只有新一次合并 / 中止 / 切工作区)。所以**展示**和**主次判断**
      都必须按「现在还冲突的那些路径」过滤,否则横幅会列出一串早就没冲突的文件,
      而 `sessionPrimary` 会因为一条陈旧记录把 AI 按钮错误地降级。
    state 本身不动 —— 留着它,用户把一个文件改回冲突态时原因还能重新显示出来。
  */
  const conflictedPathSet = useMemo(() => new Set(conflicted.map((f) => f.path)), [conflicted])
  const activeFailures = useMemo(
    () => resolveFailures.filter((r) => conflictedPathSet.has(r.path)),
    [resolveFailures, conflictedPathSet]
  )

  if (workspaceId === null) {
    return (
      <Shell t={t} onClose={onClose} onRefresh={null}>
        <EmptyState
          className="m-auto"
          icon={<GitBranch size={26} />}
          title={t('git.noWorkspace')}
          hint={t('git.noWorkspaceHint')}
        />
      </Shell>
    )
  }

  if (overview === null) {
    return (
      <Shell t={t} onClose={onClose} onRefresh={() => void refresh()}>
        <p role="status" className="m-auto p-6 text-[13px] text-fg-muted">
          {t('git.loading')}
        </p>
      </Shell>
    )
  }

  if (!overview.available) {
    const reason = overview.reason
    return (
      <Shell t={t} onClose={onClose} onRefresh={() => void refresh()}>
        <EmptyState
          className="m-auto"
          icon={<GitBranch size={26} />}
          title={t(`git.unavailable.${reason}`)}
          hint={
            reason === 'git-missing'
              ? undefined
              : t(`git.unavailable.${reason as HintedReason}Hint`)
          }
        />
      </Shell>
    )
  }

  const branchLabel = overview.detached
    ? t('git.branchDetached')
    : overview.unborn
      ? `${overview.branch} · ${t('git.branchUnborn')}`
      : overview.branch

  const branchOptions = branches.map((b) => ({ value: b.name, label: b.name }))
  const selectValue = branches.some((b) => b.name === overview.branch) ? overview.branch : ''

  const conflictedCount = conflicted.length
  /*
    仓库卡住的那次操作,由主进程读 MERGE_HEAD / REBASE_HEAD / CHERRY_PICK_HEAD 得出;
    `mergeSource` 是它从 .git/MERGE_MSG 解析出的来源分支。
    ★ 渲染层不留任何「我正在合并」的本地状态:用户在终端里 `git merge --abort` 或
      `rebase --continue`,只有这两个字段跟着刷新一变,横幅才会跟着换话。
  */
  const operation = overview.operation
  const mergeSourceOfOperation = overview.mergeSource
  const sourceOptions = branches.filter((b) => !b.current).map((b) => ({
    value: b.name,
    label: b.name
  }))
  /**
   * 对话框里默认选中的来源分支,同时兼作入口按钮的可用性依据:空串 = 没有可合并的
   * 分支。★ 从 `branches` 现取而不是 `sourceOptions[0]?.value` —— 项目开了
   * noUncheckedIndexedAccess,下标取出来的东西带 undefined,而这里要的只是个
   * 「有没有得选」的判断。
   */
  const mergeSourceName = branches.find((b) => !b.current)?.name ?? ''

  /*
    AI 报过「这几个不是重试能解决的」(太大 / 二进制 / 双方删除)且**所有还挂着冲突的**
    失败都是这一类时,把会话入口提为主按钮。混着 aiFailed / limit 那种「再点一次有可能
    成」的,维持 AI 为主。★ 用 `activeFailures` 而不是原始 state(见那里的注释)。
  */
  const manualOnlyReasons: readonly GitConflictFailure[] = ['tooLarge', 'binary', 'deleted']
  const sessionPrimary =
    activeFailures.length > 0 &&
    activeFailures.every((r) => manualOnlyReasons.includes(r.reason ?? 'unresolved'))

  const commit = (): void => {
    const text = message.trim()
    // 按钮在空信息时就是禁用的,这里兜的是 ⌘↵ —— 快捷键绕不过键盘
    if (text === '' || busy || generating) return
    void run(async () => {
      const created = await commitGit(workspaceId, text)
      setMessage('')
      setSelection(null)
      setNotice(t('git.commitDone', { hash: created.shortHash }))
    })
  }

  /**
   * 让模型照暂存区写一条草稿,**填进输入框等人过目** —— 不直接提交。
   *
   * ★ 不走 `run`:它会在成功后刷一遍仓库,而这次请求什么都没改。生成期间
   *   照样允许轮询和翻历史,只有两颗提交相关的按钮停下来。
   */
  const generate = (): void => {
    if (busy || generating) return
    setGenerating(true)
    setError(null)
    setNotice(null)
    generateGitCommitMessage(workspaceId)
      .then((result) => setMessage(result.message))
      .catch((e: unknown) => setError(errorText(e, t)))
      .finally(() => setGenerating(false))
  }

  const createBranch = (): void => {
    const name = newBranch.trim()
    if (name === '') {
      setError(t('git.invalidBranch'))
      return
    }
    void run(async () => {
      await createGitBranch(workspaceId, name, newCheckout)
      setNewBranch('')
      setCreating(false)
    })
  }

  /**
   * 合并来源分支。
   *
   * ★ `run` 会丢掉 action 的返回值,所以 notice 在闭包内自己发。冲突清单和来源分支
   *   都不在这里往 state 上存 —— `run` 收尾那次刷新已经把 `operation` /
   *   `mergeSource`(主进程读 .git/MERGE_MSG)和冲突文件带进 `overview` 了,横幅和
   *   会话提示词都从那儿读,少两份会和刷新打架的本地状态。
   */
  const merge = (source: string): void => {
    void run(
      async () => {
        // 上一轮 AI 的失败清单不属于这一次合并,开跑前先清掉
        setResolveFailures([])
        try {
          const result: GitMergeResult = await mergeGit(workspaceId, source)
          if (result.status === 'merged') setNotice(t('git.mergeDone', { branch: source }))
          else if (result.status === 'upToDate') setNotice(t('git.mergeUpToDate', { branch: source }))
          // 判别式联合:上两条分支排掉 merged / upToDate,这里 `paths` 可达
          else setNotice(t('git.mergeConflicted', { count: result.paths.length }))
        } finally {
          // ★ 失败也关:弹窗是 `z-100` 盖住整个窗口的,留着它用户就看不见
          //   banner 上那条「合并失败」以及 git 的原话了。
          setMergeOpen(false)
        }
      },
      'merge'
    )
  }

  const abortMerge = (): void => {
    void run(async () => {
      try {
        await abortGitMerge(workspaceId)
        // 失败清单跟着这次合并一起没了(来源分支由主进程刷掉,不在这里清)
        setResolveFailures([])
      } finally {
        setAbortOpen(false)
      }
    })
  }

  /**
   * 让 AI 逐个解决冲突文件。照 `generate()`:独立 loading、成功后自己刷一遍、
   * 失败进现有 error banner,全程不碰 `busy`。
   *
   * ★ 失败的项**留在 state 上按路径列出来**,而不是拼成一句 notice:二进制 / 双方
   *   删除这些是要用户自己去决定的,告诉他「有 3 个没解决」不如告诉他哪三个、
   *   以及各自为什么。下一次点击会整份覆盖。
   */
  const resolve = (): void => {
    if (busy || resolving) return
    setResolving(true)
    setError(null)
    setNotice(null)
    resolveGitConflicts(workspaceId)
      .then(async (list) => {
        // ★ 跨工作区:旧工作区的 resolve 跑完,新面板已经换人了 —— 不刷、不写清单、
        //   不报 notice(错误也不糊到别的仓库的界面上)
        if (workspaceIdRef.current !== workspaceId) return
        const next = await refresh()
        // await 期间又切了一次:refresh 自己会把结果扣下(返回 null),这里连清单
        // 和 notice 也不该写 —— 与 refresh 里每个 await 之后重验是同一个理由
        if (workspaceIdRef.current !== workspaceId) return
        const failed = list.filter((r) => r.status === 'failed')
        setResolveFailures(failed)
        /*
          ★ 「已解决」必须建立在**确认过的**仓库状态上:`refresh()` 返回 null 可能是
            静默失败,也可能被版本号顶掉或整个跨了工作区,那不代表冲突清零。拿不到
            新状态时不宣告,让失败自己说话(错误已进 error banner)。
        */
        if (next !== null && next.available) {
          const left = next.files.filter((f) => f.conflicted).length
          /*
            ★ 用 `next.operation` 而不是渲染时那份:这一句要说的是**刚刷出来的**仓库
              该往哪走。squash / revert 停在中间时没有 operation 哨兵,但冲突解决完
              的下一步仍然是提交 —— 给一句中性提示,而不是什么都不说(L5)。
              期间被终端 abort 的干净仓库(没有任何已暂存改动)不发消息。
          */
          if (left === 0) {
            if (next.operation !== '') setNotice(resolvedCopy(next.operation, t))
            else if (next.files.some((f) => f.staged)) setNotice(t('git.conflictsResolvedHint'))
          } else if (failed.length > 0) {
            setNotice(t('git.resolvePartial'))
          }
        } else if (failed.length > 0) {
          setNotice(t('git.resolvePartial'))
        }
      })
      .catch((e: unknown) => {
        if (workspaceIdRef.current !== workspaceId) return
        setError(errorText(e, t))
      })
      .finally(() => setResolving(false))
  }

  /**
   * 把这次冲突转交给一条 Agent 会话:开新会话 + 把需求**预填进输入框**,不发送。
   *
   * ★ 为什么需要它:one-shot 的 AI 解决有 128KB 上限(`tooLarge`),而带工具的
   *   会话可以分块读完整大文件。用户自己挑模型、自己按发送。
   *
   * ★ **顺序:create → openSession → setDraft,而且 draft 不会被回填盖掉。**
   *   `sessionStore(id)` 第一次被碰到时会异步跑 `hydrateInput`(读盘上存档)。
   *   这里 setDraft 是在同一拍里同步写进 store 的,等那次 IPC 回来,守卫
   *   `s.draft !== ''` 直接 return —— 这正是那条守卫存在的理由(见 store 内注释)。
   *   新会话本来也没有存档,双重安全。反过来先 setDraft 再 openSession 不会错,
   *   但照 `startSkillExtraction` 的编排走,两处时序一致好维护。
   */
  const openConflictSession = (): void => {
    // ★ 不看 `resolving`:AI 失败清单里那几颗(tooLarge / binary)正是会话要去接手的活
    if (busy || handoff) return
    setHandoff(true)
    setError(null)
    const fileList = conflicted
      .map((f) => {
        const failed = activeFailures.find((r) => r.path === f.path)
        return failed === undefined ? f.path : `${f.path} — ${t(resolveFailureKey(failed.reason))}`
      })
      .join('\n')
    // 提示词在点击这一刻现算:之后的 IPC 往返里界面上的清单不该再变
    const prompt = t('git.conflictSessionPrompt', {
      /*
        ★ 两个参数都取自刷出来的 `overview`:会话里那条 Agent 得知道自己收尾的
          是 merge 还是 rebase(出路不同:合并提交 vs `git rebase --continue`),
          而来源分支只有主进程能从 .git/MERGE_MSG 读到。措辞由模板按
          operation 分派,这里只送原始值。
      */
      operation,
      branch: mergeSourceOfOperation,
      count: conflictedCount,
      files: fileList
    })
    createSession(workspaceId, t('git.conflictSessionTitle'))
      .then((session) => {
        // ★ 跨工作区:会话建在旧工作区不假,但**不能**切走用户现在看的视图
        //   (不 openSession、不抢焦点);草稿照写 —— 他之后自己点开那条会话时,
        //   需求描述还在里面。同一次会话、同一份草稿,只差「要不要现在跳过去」。
        if (workspaceIdRef.current === workspaceId) {
          useTabsStore.getState().openSession(workspaceId, session.id, session.title)
        }
        sessionStore(session.id).getState().setDraft(prompt)
      })
      .catch((e: unknown) => {
        if (workspaceIdRef.current !== workspaceId) return
        setError(errorText(e, t))
      })
      .finally(() => setHandoff(false))
  }

  /*
    ★ 定义成 const 而不是写两遍 JSX:上面要根据失败原因**换序并换主次**,同一段
      UI 抄两遍的话,改一处漏一处的症状是「换了序的那颗忘了禁用 resolving」。
    ★ 换序走数组渲染,两颗都带 key —— 没 key 时 React 按位置复用,换序会把 Spinner
      状态串到另一颗按钮上。
  */
  const aiButton = (
    <Button
      key="ai"
      size="sm"
      variant={sessionPrimary ? 'ghost' : 'accent'}
      disabled={busy || resolving}
      icon={resolving ? <Spinner size="sm" /> : <Sparkles size={13} />}
      onClick={resolve}
    >
      {resolving ? t('git.resolving') : t('git.resolveWithAi')}
    </Button>
  )
  /*
    转交给会话处理:one-shot AI 啃不动的大文件(>128KB)走这条路 —— 带工具的
    Agent 能分块读完。只建会话、只填输入框,发送和选模型留给用户。
    ★ 它**不跟 resolving 互斥**:不改仓库,而且 AI 刚失败的那些正是它要去接手的。
  */
  const sessionButton = (
    <Button
      key="session"
      size="sm"
      variant={sessionPrimary ? 'accent' : 'ghost'}
      disabled={busy || handoff}
      icon={handoff ? <Spinner size="sm" /> : <MessageSquarePlus size={13} />}
      onClick={openConflictSession}
    >
      {t('git.openInSession')}
    </Button>
  )

  return (
    <Shell t={t} onClose={onClose} onRefresh={() => void refresh()}>
      <section className="flex w-[340px] shrink-0 flex-col border-r border-hairline">
        {/* ── 分支与远端 ── */}
        <div className="border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <GitBranch size={14} className="shrink-0 text-fg-faint" />
            <span className="truncate text-[13px] font-medium text-fg" title={branchLabel}>
              {branchLabel}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-fg-faint">
            {overview.upstream === '' ? (
              <span>{t('git.noUpstream')}</span>
            ) : (
              <>
                <span className="truncate" title={overview.upstream}>
                  {overview.upstream}
                </span>
                {overview.ahead > 0 && <span>{t('git.ahead', { count: overview.ahead })}</span>}
                {overview.behind > 0 && <span>{t('git.behind', { count: overview.behind })}</span>}
              </>
            )}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            {/* pull 会动工作树,AI 正在改写冲突文件时不能并行 —— push 只读,不锁 */}
            <Button
              size="sm"
              variant="ghost"
              icon={pending === 'pull' ? <Spinner size="sm" /> : <ArrowDown size={13} />}
              disabled={busy || resolving}
              onClick={() => void run(() => pullGit(workspaceId), 'pull')}
            >
              {t('git.pull')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={pending === 'push' ? <Spinner size="sm" /> : <ArrowUp size={13} />}
              disabled={busy}
              onClick={() => void run(() => pushGit(workspaceId), 'push')}
            >
              {t('git.push')}
            </Button>
            <IconButton
              label={t('git.newBranch')}
              className="ml-auto"
              active={creating}
              disabled={busy || resolving}
              onClick={() => setCreating((v) => !v)}
            >
              <Plus size={14} />
            </IconButton>
            {/*
              合并入口。游离 HEAD 没有「当前分支」可当合并目标;仓库已经卡在一次
              未完成操作(rebase / cherry-pick / 上一次合并)时再叠一次 merge 只会把
              两件事搅在一起 —— 这两种情况直接不给按,而不是弹个对话框再让用户在
              里面发现按不了「合并」。没有别的分支时也没的可合。
              ★ 条件还要看 `conflictedCount > 0`:squash / revert 停在中间时没有任何
              哨兵文件,`operation` 是空串,但索引里带着未合并路径 —— 那种状态下
              `git merge` 会被 git 自己拒掉(主进程同样按 `git.mergeInProgress` 挡),
              与其让用户看完一条红字,不如一开始就不给按。
            */}
            <IconButton
              label={t('git.merge')}
              disabled={
                busy ||
                resolving ||
                overview.detached ||
                operation !== '' ||
                conflictedCount > 0 ||
                mergeSourceName === ''
              }
              onClick={() => {
                setMergeSource(mergeSourceName)
                setMergeOpen(true)
              }}
            >
              {pending === 'merge' ? <Spinner size="sm" /> : <GitMerge size={14} />}
            </IconButton>
          </div>
          {branchOptions.length > 0 && (
            <Select
              className="mt-2 w-full"
              value={selectValue}
              options={branchOptions}
              ariaLabel={t('git.switchBranch')}
              disabled={busy || resolving}
              onValueChange={(name) => {
                if (name === overview.branch) return
                void run(() => checkoutGitBranch(workspaceId, name))
              }}
            />
          )}
          {creating && (
            <div className="mt-2 flex flex-col gap-2">
              <TextInput
                value={newBranch}
                onChange={setNewBranch}
                placeholder={t('git.newBranchPlaceholder')}
                ariaLabel={t('git.newBranchName')}
                disabled={busy || resolving}
              />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12px] text-fg-muted">
                  <Toggle
                    checked={newCheckout}
                    onChange={setNewCheckout}
                    label={t('git.newBranchCheckout')}
                  />
                  {t('git.newBranchCheckout')}
                </span>
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy || resolving}
                  onClick={createBranch}
                >
                  {t('git.create')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── 改动列表 ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {overview.filesTruncated && (
            <p className="px-2 pb-2 text-[11px] text-fg-faint">
              {t('git.filesTruncated', { count: files.length })}
            </p>
          )}
          {files.length === 0 ? (
            <EmptyState
              className="py-8"
              title={t('git.clean')}
              hint={t('git.cleanHint')}
            />
          ) : (
            <>
              {/*
                冲突组排在最前:它是**唯一需要用户决定**的那一栏,而暂存/未暂存
                只是账本。空组由 `FileGroup` 自己 return null。
                ★ `staged={false}`:主进程的 diff 特判(冲突文件返回带标记的工作区
                原文)只在 `staged === false` 那条路上;传 true 会去读 `--cached`,
                拿到的是三方合并的 index 内容而不是用户要看的那份。
              */}
              <FileGroup
                t={t}
                title={t('git.conflictGroup')}
                files={conflicted}
                staged={false}
                busy={busy || resolving}
                selection={selection}
                actionLabel={t('git.stage')}
                bulkLabel={t('git.stageAll')}
                onSelect={setSelection}
                onAction={(paths) => void run(() => stageGitPaths(workspaceId, paths))}
              />
              <FileGroup
                t={t}
                title={t('git.staged')}
                files={staged}
                staged
                busy={busy || resolving}
                selection={selection}
                actionLabel={t('git.unstage')}
                bulkLabel={t('git.unstageAll')}
                onSelect={setSelection}
                onAction={(paths) => void run(() => unstageGitPaths(workspaceId, paths))}
              />
              <FileGroup
                t={t}
                title={t('git.unstaged')}
                files={unstaged}
                staged={false}
                busy={busy || resolving}
                selection={selection}
                actionLabel={t('git.stage')}
                bulkLabel={t('git.stageAll')}
                onSelect={setSelection}
                onAction={(paths) => void run(() => stageGitPaths(workspaceId, paths))}
              />
            </>
          )}
        </div>

        {/* ── 提交 ── */}
        <div className="border-t border-hairline px-4 py-3">
          <CommitBox
            value={message}
            placeholder={t('git.commitPlaceholder')}
            ariaLabel={t('git.commitMessage')}
            disabled={busy || generating || resolving}
            onChange={setMessage}
            onSubmit={commit}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-fg-faint">
              {generating
                ? t('git.aiGenerating')
                : staged.length === 0
                  ? t('git.nothingStaged')
                  : null}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {/*
                AI 生成提交信息读的是暂存区,不写仓库,但冲突正在被 AI 改写时暂存区
                本身就不稳定 —— 生成的信息描述的是「上一秒的改动」。一起停掉。
              */}
              <IconButton
                label={t('git.aiGenerate')}
                size={28}
                disabled={busy || generating || resolving || staged.length === 0}
                onClick={generate}
              >
                {generating ? <Spinner size="sm" /> : <Sparkles size={14} />}
              </IconButton>
              <Button
                size="sm"
                variant="accent"
                disabled={
                  busy || generating || resolving || staged.length === 0 || message.trim() === ''
                }
                onClick={commit}
              >
                {t('git.commit')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 右栏:diff / 历史 ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <Segmented<Pane>
            size="sm"
            value={pane}
            label={t('git.title')}
            options={[
              { value: 'changes', label: t('git.tab.changes') },
              { value: 'history', label: t('git.tab.history') }
            ]}
            onChange={setPane}
          />
          {pane === 'changes' && selection !== null && (
            <span className="truncate text-[12px] text-fg-muted" title={selection.path}>
              {selection.path}
            </span>
          )}
          {pane === 'history' && (
            <span className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              <History size={13} />
              {t('git.historyOf')}
            </span>
          )}
        </div>

        {/*
          ── 未完成的 git 操作 / 待解决冲突横幅 ──
          判据是 `overview.operation`(主进程读 MERGE_HEAD / REBASE_HEAD /
          CHERRY_PICK_HEAD)+ 冲突文件数,**不是**渲染层自己记的「我刚点了合并」:
          用户完全可能在终端里 `git merge --abort`,面板跟着刷掉才是对的。
          ★ 条件带 `conflictedCount > 0` 这一半:rebase 停在中间时 MERGE_HEAD 不
            存在,但冲突一样要解决、一样要给出入口。
          ★ 中止按钮只在 `operation === 'merge'` 给 —— `git merge --abort` 打到
            rebase 中间是会做错事的(rebase 要的是 --abort / --skip),而我们没有
            把握替用户跑对的那条,宁可少给一颗按钮。
        */}
        {(operation !== '' || conflictedCount > 0) && (
          <div className="px-4 pt-3">
            <div
              className={cn(
                'rounded-[8px] border px-3 py-2.5 text-[12px]',
                conflictedCount > 0
                  ? 'border-danger/40 bg-danger/10 text-fg-muted'
                  : 'border-hairline bg-tint text-fg-muted'
              )}
            >
              <p className="flex items-start gap-2">
                <GitMerge size={13} className="mt-0.5 shrink-0 text-fg-faint" />
                <span className="min-w-0 break-words">
                  {conflictedCount > 0
                    ? t('git.conflictsPending', { count: conflictedCount })
                    : resolvedCopy(operation, t)}
                </span>
              </p>
              {/* AI 没解决掉的那些:路径 + 各自的原因。★ 只列**现在还在冲突**的那些 */}
              {activeFailures.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-hairline pt-2">
                  {activeFailures.map((r) => (
                    <li key={r.path} className="flex min-w-0 items-baseline gap-2">
                      <code
                        className="min-w-0 shrink truncate font-mono text-[11px] text-fg"
                        title={r.path}
                      >
                        {r.path}
                      </code>
                      <span className="shrink-0 text-[11px] text-danger">
                        {t(resolveFailureKey(r.reason))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                {/* 失败引导换序:两类按钮在组件尾部现成 const,这里只决定谁在前、谁是主 */}
                {conflictedCount > 0 &&
                  (sessionPrimary ? [sessionButton, aiButton] : [aiButton, sessionButton])}
                {operation === 'merge' && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy || resolving}
                    onClick={() => setAbortOpen(true)}
                  >
                    {t('git.abortMerge')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {(error !== null || notice !== null) && (
          <div className="px-4 pt-3">
            {error !== null && (
              <div className="flex items-start justify-between gap-3 rounded-[8px] bg-danger/10 px-3 py-2 text-[12px] text-danger">
                <span className="min-w-0 whitespace-pre-wrap break-words">{error}</span>
                <IconButton label={t('git.operationFailed')} size={20} onClick={() => setError(null)}>
                  <X size={12} />
                </IconButton>
              </div>
            )}
            {notice !== null && (
              <div className="mt-2 rounded-[8px] bg-tint px-3 py-2 text-[12px] text-fg-muted">
                {notice}
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {pane === 'history' ? (
            commits.length === 0 ? (
              <EmptyState className="m-auto" title={t('git.noCommits')} />
            ) : (
              <ul className="px-4 py-3">
                {commits.map((c) => (
                  <li key={c.hash} className="border-b border-hairline py-2.5 last:border-b-0">
                    <p className="truncate text-[13px] text-fg" title={c.subject}>
                      {c.subject}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-fg-faint">
                      <code className="font-mono">{c.shortHash}</code>
                      <span className="truncate">{c.author}</span>
                      <span>{new Date(c.timestamp).toLocaleString()}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : selection === null ? (
            <EmptyState className="m-auto" title={t('git.selectFile')} />
          ) : diff === null ? (
            <p role="status" className="p-6 text-[13px] text-fg-muted">
              {t('git.loading')}
            </p>
          ) : diff.binary ? (
            <EmptyState className="m-auto" title={t('git.diffBinary')} />
          ) : diff.text === '' ? (
            <EmptyState className="m-auto" title={t('git.diffEmpty')} />
          ) : (
            <DiffView t={t} diff={diff} />
          )}
        </div>
      </section>

      {/* ── 合并对话框 ── */}
      <Dialog
        open={mergeOpen}
        title={t('git.mergeTitle')}
        onClose={() => setMergeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMergeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={busy || resolving || mergeSource === ''}
              icon={pending === 'merge' ? <Spinner size="sm" /> : undefined}
              onClick={() => merge(mergeSource)}
            >
              {t('git.mergeAction')}
            </Button>
          </>
        }
      >
        <label className="block text-[12px] text-fg-muted">
          {t('git.mergeSource')}
          <Select
            className="mt-1.5"
            inModal
            value={mergeSource}
            options={sourceOptions}
            ariaLabel={t('git.mergeSource')}
            disabled={busy}
            onValueChange={setMergeSource}
          />
        </label>
      </Dialog>

      {/* ── 中止合并:危险确认 ── */}
      <Dialog
        open={abortOpen}
        title={t('git.abortMergeTitle')}
        width={420}
        onClose={() => setAbortOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAbortOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={busy || resolving} onClick={abortMerge}>
              {t('git.abortMerge')}
            </Button>
          </>
        }
      >
        <p className="text-[12px] text-fg-muted">{t('git.abortMergeBody')}</p>
      </Dialog>
    </Shell>
  )
}

/** 标题栏 + 画布。五种状态(无工作区 / 加载中 / 四种不可用 / 正常)共用一个外框。 */
function Shell({
  t,
  onClose,
  onRefresh,
  children
}: {
  t: Translate
  onClose?: () => void
  onRefresh: (() => void) | null
  children: ReactNode
}): ReactNode {
  return (
    /*
      52px 标题栏、`app-drag`、右端给自绘窗口按钮让位、左端 `SidebarReveal` ——
      四条都归 `shell/FeatureFrame` 管,原委见那个文件的头。
    */
    <FeatureFrame
      header={
        <>
          <span className="text-[14px] font-medium text-fg">{t('git.title')}</span>
          <span className="truncate text-[12px] text-fg-faint">{t('git.description')}</span>
          <div className="ml-auto flex items-center gap-1">
            {onRefresh !== null && (
              <IconButton label={t('git.refresh')} onClick={onRefresh}>
                <RefreshCw size={14} />
              </IconButton>
            )}
            {onClose !== undefined && (
              <IconButton label={t('git.close')} onClick={onClose}>
                <X size={15} />
              </IconButton>
            )}
          </div>
        </>
      }
    >
      <div className="flex min-h-0 flex-1">{children}</div>
    </FeatureFrame>
  )
}

function FileGroup({
  t,
  title,
  files,
  staged,
  busy,
  selection,
  actionLabel,
  bulkLabel,
  onSelect,
  onAction
}: {
  t: Translate
  title: string
  files: GitFileChange[]
  staged: boolean
  busy: boolean
  selection: Selection | null
  actionLabel: string
  bulkLabel: string
  onSelect: (s: Selection) => void
  onAction: (paths: string[]) => void
}): ReactNode {
  if (files.length === 0) return null
  // 冲突文件不参与「全部暂存」:把冲突标记连同标记一起 add 进去,是在用一次
  // 误操作把冲突「解决」掉。它只能一个个来,而且得先真的解决。
  const actionable = files.filter((f) => !f.conflicted).map((f) => f.path)
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          {title} · {files.length}
        </span>
        {actionable.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(actionable)}
            className="rounded-[6px] px-1.5 py-0.5 text-[11px] text-fg-faint hover:bg-tint-hover hover:text-fg disabled:opacity-40"
          >
            {bulkLabel}
          </button>
        )}
      </div>
      {files.map((file) => {
        const active = selection !== null && selection.path === file.path && selection.staged === staged
        // 路径一律是仓库相对的 POSIX 形式(主进程 `core.quotePath=false` + 斜杠),
        // 所以这里按 '/' 切就够,不必过 path 模块
        const slash = file.path.lastIndexOf('/')
        const name = slash === -1 ? file.path : file.path.slice(slash + 1)
        const dir = slash === -1 ? '' : file.path.slice(0, slash)
        const { Icon, className: iconClass } = iconFor(name, 'file')
        const letter = file.conflicted ? '!' : statusLetter(file, staged)
        const status = statusMeta(letter, t)
        return (
          <div
            key={`${staged ? 's' : 'u'}:${file.path}`}
            className={cn(
              'group flex items-center gap-1.5 rounded-[8px] px-2 py-1.5',
              active ? 'bg-tint-strong' : 'hover:bg-tint-hover'
            )}
          >
            <button
              type="button"
              onClick={() => onSelect({ path: file.path, staged })}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={file.renamedFrom === undefined ? file.path : t('git.renamedFrom', { from: file.renamedFrom })}
            >
              <Icon size={14} className={cn('shrink-0', iconClass)} />
              <span
                className={cn(
                  'truncate text-[13px]',
                  active ? 'text-fg' : 'text-fg-muted group-hover:text-fg'
                )}
              >
                {name}
              </span>
              {/* 目录挂在文件名后面、更淡更小 —— 照 VS Code 的 SCM 列表:
                  一屏文件里真正要读的是 basename,路径只在重名时才需要 */}
              {dir !== '' && (
                <span className="min-w-0 shrink truncate text-[11px] text-fg-faint">{dir}</span>
              )}
            </button>
            <code
              className={cn('w-3 shrink-0 text-center font-mono text-[11px]', status.className)}
              title={status.title}
            >
              {letter}
            </code>
            <IconButton
              label={file.conflicted ? t('git.conflictedHint') : actionLabel}
              size={20}
              disabled={busy || file.conflicted}
              onClick={() => onAction([file.path])}
            >
              {staged ? <Minus size={12} /> : <Plus size={12} />}
            </IconButton>
          </div>
        )
      })}
    </div>
  )
}

/**
 * diff 正文。
 *
 * ★ **封顶在 `DIFF_LINE_LIMIT` 行**,见那个常量上的注释。超出的部分给一句说明
 *   而不是一个「展开全部」—— 展开之后卡的还是同一下,只是换成用户自己按的。
 *
 * ★ 解析放在 `useMemo` 里:面板每次 setState(轮询、忙碌态、输入框敲字)都会
 *   重渲染这棵树,而 diff 本身几乎不变。它同时也是 `DiffLines` 的 prop,
 *   每帧新建一份等价数组会让语法高亮跟着每帧重算。
 *
 * ★ **正文换行而不是横向滚动**(`wrap`)。横向滚动会把左边的行号栏一起推走 ——
 *   而行号恰恰是滚到一半时最需要的那个东西;这一栏还可能被左侧 340px 挤得很窄,
 *   长行在这里是常态而非例外。
 *
 * 行怎么画不在这里:`components/diff/DiffLines.tsx` 是全仓库唯一那一份,聊天里的
 * 工具卡和「改动审查」画的是同一个组件(原先这边是另一套行样式和另一条行号栏)。
 */
function DiffView({ t, diff }: { t: Translate; diff: GitDiff }): ReactNode {
  const parsed = useMemo(() => parseUnifiedDiff(diff.text, DIFF_LINE_LIMIT), [diff.text])
  return (
    <div className="pb-4">
      {/* 统计条:进来第一眼要的是「动了多大」,不是第一行改了什么 */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-canvas px-4 py-2 text-[11px]">
        <span className="font-mono text-accent" title={t('git.diffAdded', { count: parsed.added })}>
          +{parsed.added}
        </span>
        <span
          className="font-mono text-danger"
          title={t('git.diffRemoved', { count: parsed.removed })}
        >
          −{parsed.removed}
        </span>
        {diff.truncated && <span className="text-fg-faint">{t('git.diffTruncated')}</span>}
      </div>
      {/* 语法高亮的语言从路径推:diff 文本自己不带这个信息 */}
      <DiffLines
        lines={parsed.lines}
        language={languageOf(diff.path)}
        lineNumbers
        className="text-[12px] leading-[1.6]"
      />
      {parsed.lines.length < parsed.total && (
        <p className="px-4 pt-2 text-[11px] text-fg-faint">
          {t('git.diffLinesTruncated', { shown: parsed.lines.length, total: parsed.total })}
        </p>
      )}
    </div>
  )
}

/**
 * 提交信息输入框。受控、逐键上抛,见文件头 ★ 为什么不是 `TextArea`。
 *
 * 类名逐条照抄 `TextArea` —— 两个框在同一个界面里出现,长得不一样就是 bug。
 */
function CommitBox({
  value,
  placeholder,
  ariaLabel,
  disabled,
  onChange,
  onSubmit
}: {
  value: string
  placeholder: string
  ariaLabel: string
  disabled: boolean
  onChange: (v: string) => void
  onSubmit: () => void
}): ReactNode {
  return (
    <textarea
      value={value}
      rows={3}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // ⌘↵ / Ctrl↵ 提交。裸 ↵ 不行:提交信息的正文本来就是多行的
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          onSubmit()
        }
      }}
      className={cn(
        'app-no-drag selectable w-full resize-none rounded-[8px] border border-border',
        'bg-surface-field px-2.5 py-2 text-[13px] leading-[1.6] text-fg outline-none',
        'transition-colors placeholder:text-fg-faint focus:border-accent disabled:opacity-40'
      )}
    />
  )
}
