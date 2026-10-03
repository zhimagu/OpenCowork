import { useEffect, type ReactNode } from 'react'
import {
  PERMISSION_MODES,
  type PermissionMode
} from '../../../../shared/agent/permission'
import { Segmented } from '../../components/ui/Segmented'
import { Slider } from '../../components/ui/Slider'
import { Toggle } from '../../components/ui/Toggle'
import { Select } from '../../components/ui/Select'
import { RoleModelPicker } from '../../components/RoleModelPicker'
import { useChatModelGuard } from '../../components/useChatModelGuard'
import { useModelsStore } from '../../stores/models'
import { modelOptions } from './model/enabled-models'
import {
  modelSelectionKey,
  parseModelSelectionKey
} from '../../../../shared/domain/model-selection'
import {
  MODEL_PROPOSED_GOALS,
  MAX_OUTPUT_TOKENS_BOUNDS,
  isModelProposedGoals,
  isShellPreference,
  shellPreferencesForPlatform,
  type ShellPreference
} from '../../../../shared/domain/settings'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../../../../shared/agent/run-request'
import {
  INHERIT_THINKING,
  isSubagentThinking,
  SUBAGENT_THINKING_CHOICES
} from '../../../../shared/domain/subagent-thinking'
import { DraftInput } from '../DraftInput'
import { DefaultOpenTargetSelect } from './DefaultOpenTargetSelect'
import { SettingGroup, SettingRow } from '../Row'
import type { SettingsPageProps } from '../props'
import { useI18n } from '../../i18n'

export function GeneralPage({ settings, sub, patch }: SettingsPageProps): ReactNode {
  const { t } = useI18n()
  const models = useModelsStore((s) => s.models)
  const providers = useModelsStore((s) => s.providers)
  const loaded = useModelsStore((s) => s.loaded)
  const load = useModelsStore((s) => s.load)
  useEffect(() => {
    if (sub === 'agent' && !loaded) void load()
  }, [sub, loaded, load])
  /*
    需求:AI 审核模型 / 目标判定模型这两个 `Select` 也只列文本模型,存量里选中了
    图片模型的在**打开选择器时**校正(见 `useChatModelGuard` 文件头)。
    hook 在分支**之外**调用(Rules of Hooks),校正动作挂在这两个 Select 的
    `onOpenChange` 上 —— 用户不打开就一个字节不动他的配置。
  */
  const guardReviewerModel = useChatModelGuard(
    models,
    providers,
    { model: settings.permissionReviewerModel, modelProviderId: settings.permissionReviewerModelProviderId },
    (model, modelProviderId) => {
      patch({ permissionReviewerModel: model, permissionReviewerModelProviderId: modelProviderId })
    }
  )
  const guardGoalEvaluatorModel = useChatModelGuard(
    models,
    providers,
    { model: settings.goalEvaluatorModel, modelProviderId: settings.goalEvaluatorModelProviderId },
    (model, modelProviderId) => {
      patch({ goalEvaluatorModel: model, goalEvaluatorModelProviderId: modelProviderId })
    }
  )
  if (sub === 'agent') {
    // 一条绑定一个选项 —— 同一别名挂在多家上时,「用哪一家审核」是用户要选的东西
    const reviewerOptions = [
      { value: '', label: t('general.permissionReviewerModelEmpty') },
      ...modelOptions(models.filter((m) => m.enabled !== false), providers)
    ]
    /*
      ★ 目标判定模型和审核模型存的是**同一种东西**(别名 + 供应商一对),所以候选也
        同一张表。空的含义在这里是「跟随本轮对话的模型」,不是「未配置」—— 判定器
        本来就有个天然的落点(这一轮自己那个模型),而审核模型那边没有,空着只能
        退回人工审批。
    */
    const goalEvaluatorOptions = [
      { value: '', label: t('models.followConversation') },
      ...modelOptions(models.filter((m) => m.enabled !== false), providers)
    ]
    // Shell 名称不翻译；值不在本平台表里时回到自动选择。
    const shellChoices = shellPreferencesForPlatform(window.nextcowork.platform)
    const shell: ShellPreference = shellChoices.includes(settings.shell) ? settings.shell : 'system'
    const shellOptions = shellChoices.map((value) => ({
      value,
      label: value === 'system' ? t('general.shellSystem') : SHELL_LABELS[value]
    }))
      return (
        <SettingGroup>
        {/*
          需求：默认模型/默认子代理原来放在「模型」设置页,挤在供应商列表那条
          236px 窄列的 footer 里,和「来 Agent 页配权限/审核模型」不是同一次
          心智动作——用户得先记得"哦对了默认模型要去另一个页面改"。挪来这里后,
          跟下面的 AI 审核模型/目标判定模型同属「Agent 用哪个模型」这一类问题,
          放在同一屏。`entries`/供应商列表上的「默认」徽章原样留在模型设置页,
          那边展示的是库存视图,不受这次搬迁影响。

          ★ 这两行现在是 `SettingRow wide`,跟同屏的 AI 审核模型/目标判定模型
          用同一种控件外观(单个下拉触发器)——之前那版拆成「供应商」「模型」
          两个并排 `Select` 之后用户反馈还是不够贴合这一屏其余行的样子。
          选择器本体在 `components/RoleModelPicker.tsx`。「按角色覆盖」那段
          已从这里撤走:内置角色的模型改在「扩展 → 子代理」点开内置角色后
          单独指定,设置页只保留全局默认。
        */}
        <SettingRow title={t('models.default')} wide>
          <RoleModelPicker
            label={t('models.default')}
            models={models}
            providers={providers}
            loaded={loaded}
            model={settings.defaultModel}
            modelProviderId={settings.defaultModelProviderId}
            onChange={(model, modelProviderId) => {
              patch({ defaultModel: model, defaultModelProviderId: modelProviderId })
            }}
          />
        </SettingRow>
        <SettingRow title={t('models.defaultSubagent')} wide>
          <RoleModelPicker
            label={t('models.defaultSubagent')}
            models={models}
            providers={providers}
            loaded={loaded}
            model={settings.subagent.model}
            modelProviderId={settings.subagent.modelProviderId}
            onChange={(model, modelProviderId) => {
              patch({ subagent: { model, modelProviderId } })
            }}
          />
        </SettingRow>
        <SettingRow title={t('general.subagentThinking')} description={t('general.subagentThinkingHint')} wide>
          <Select
            value={settings.subagent.thinking}
            options={SUBAGENT_THINKING_CHOICES.map((value) => ({
              value,
              label: value === INHERIT_THINKING ? t('models.followConversation') : t(`chat.thinkingLevel.${value}`)
            }))}
            ariaLabel={t('general.subagentThinking')}
            onValueChange={(value) => {
              // ★ 只认枚举,认不出的值一个都不许落库(和其它枚举行的写法一致)
              if (!isSubagentThinking(value)) return
              patch({ subagent: { thinking: value } })
            }}
          />
        </SettingRow>
        <SettingRow
          title={t('general.defaultPermission')}
          description={
            <>
              {t('general.defaultPermissionHint', {
                hint: t(`permission.${settings.defaultPermissionMode}` as 'permission.ask' | 'permission.auto' | 'permission.full')
              })}
            </>
          }
          wide
        >
          <Segmented<PermissionMode>
            label={t('general.defaultPermission')}
            value={settings.defaultPermissionMode}
            options={PERMISSION_MODES.map((m) => ({ value: m, label: t(`permission.${m}` as 'permission.ask' | 'permission.auto' | 'permission.full') }))}
            onChange={(defaultPermissionMode) => patch({ defaultPermissionMode })}
          />
        </SettingRow>
        <SettingRow
          title={t('general.permissionReviewerModel')}
          description={t('general.permissionReviewerModelHint')}
          wide
        >
          <Select
            value={modelSelectionKey(settings.permissionReviewerModelProviderId, settings.permissionReviewerModel)}
            options={reviewerOptions}
            ariaLabel={t('general.permissionReviewerModel')}
            onOpenChange={guardReviewerModel}
            onValueChange={(key) => {
              const { alias, modelProviderId } = parseModelSelectionKey(key)
              patch({ permissionReviewerModel: alias, permissionReviewerModelProviderId: modelProviderId })
            }}
          />
        </SettingRow>
        <SettingRow
          title={t('settings.goal.evaluatorModel')}
          description={t('settings.goal.evaluatorModelHint')}
          wide
        >
          <Select
            value={modelSelectionKey(settings.goalEvaluatorModelProviderId, settings.goalEvaluatorModel)}
            options={goalEvaluatorOptions}
            ariaLabel={t('settings.goal.evaluatorModel')}
            onOpenChange={guardGoalEvaluatorModel}
            onValueChange={(key) => {
              const { alias, modelProviderId } = parseModelSelectionKey(key)
              patch({ goalEvaluatorModel: alias, goalEvaluatorModelProviderId: modelProviderId })
            }}
          />
        </SettingRow>
        <SettingRow title={t('settings.goal.modelProposedGoals')} wide>
          <Select
            value={settings.modelProposedGoals}
            options={MODEL_PROPOSED_GOALS.map((value) => ({
              value,
              label: t(
                `settings.goal.modelProposedGoals.${value}` as
                  | 'settings.goal.modelProposedGoals.auto'
                  | 'settings.goal.modelProposedGoals.alwaysAsk'
                  | 'settings.goal.modelProposedGoals.disabled'
              )
            }))}
            ariaLabel={t('settings.goal.modelProposedGoals')}
            onValueChange={(value) => {
              // 三档是**枚举**,认不出来的值一个都不许落库 —— 见 `isModelProposedGoals`
              if (!isModelProposedGoals(value)) return
              patch({ modelProposedGoals: value })
            }}
          />
        </SettingRow>
        <SettingRow title={t('general.autoCompact')} description={t('general.autoCompactHint')}>
          <Toggle label={t('general.autoCompact')} checked={settings.contextManagement.autoCompact}
            onChange={(autoCompact) => patch({ contextManagement: { autoCompact } })} />
        </SettingRow>
        {/*
          需求:压缩可以交给另一个模型(它是一次长输入、短输出的机械活)。空值 =
          跟随会话模型,和上面目标判定模型那一栏是**同一种东西**,所以用同一张候选表、
          同一种控件 —— 用户在这一屏里对「Agent 用哪个模型」只学一套交互。
          工作区还能在圆环菜单里单独覆盖这两栏(三档:工作区 > 这里 > 会话模型)。
        */}
        <SettingRow title={t('compaction.model')} description={t('compaction.modelHint')} wide>
          <RoleModelPicker
            label={t('compaction.model')}
            models={models}
            providers={providers}
            loaded={loaded}
            model={settings.compactModel}
            modelProviderId={settings.compactModelProviderId}
            emptyLabel={t('compaction.followSession')}
            onChange={(model, modelProviderId) => {
              // ★ 成对写:只给别名的话主进程会留着旧的 providerId,拼出「新别名 + 旧供应商」。
              patch({ compactModel: model, compactModelProviderId: modelProviderId })
            }}
          />
        </SettingRow>
        <SettingRow title={t('compaction.thinking')} description={t('compaction.thinkingHint')} wide>
          <Select
            value={settings.compactThinking}
            options={SUBAGENT_THINKING_CHOICES.map((value) => ({
              value,
              label: value === INHERIT_THINKING ? t('compaction.thinkingInherit') : t(`chat.thinkingLevel.${value}`)
            }))}
            ariaLabel={t('compaction.thinking')}
            onValueChange={(value) => {
              // ★ 只认枚举,认不出的值一个都不许落库(同上面子代理思考深度那一栏)。
              if (!isSubagentThinking(value)) return
              patch({ compactThinking: value })
            }}
          />
        </SettingRow>
        <SettingRow
          title={t('general.maxOutputTokens')}
          description={t('general.maxOutputTokensHint', {
            min: MAX_OUTPUT_TOKENS_BOUNDS.min,
            max: MAX_OUTPUT_TOKENS_BOUNDS.max,
            fallback: DEFAULT_MAX_OUTPUT_TOKENS
          })}
        >
          <MaxOutputTokensInput
            value={settings.maxOutputTokens}
            onCommit={(maxOutputTokens) => patch({ maxOutputTokens })}
          />
        </SettingRow>
        <SettingRow
          title={t('general.shell')}
          description={t('general.shellHint')}
          wide
          last
        >
          <Select
            value={shell}
            options={shellOptions}
            inModal
            ariaLabel={t('general.shell')}
            onValueChange={(value) => {
              if (!isShellPreference(value) || !shellChoices.includes(value)) return
              patch({ shell: value })
            }}
          />
        </SettingRow>
      </SettingGroup>
    )
  }

  if (sub === 'task') {
    return (
      <SettingGroup title={t('general.agentResources')}>
        <SettingRow
          title={t('general.perSessionSubagents')}
          description={t('general.perSessionSubagentsHint')}
          wide
        >
          <SliderField
            value={settings.subagent.perSessionLimit}
            min={1}
            max={10}
            recommended={4}
            label={t('general.perSessionSubagents')}
            onCommit={(perSessionLimit) => patch({ subagent: { perSessionLimit } })}
          />
        </SettingRow>
        <SettingRow
          title={t('general.globalSubagents')}
          description={t('general.globalSubagentsHint')}
          wide
          last
        >
          <SliderField
            value={settings.subagent.globalLimit}
            min={0}
            max={10}
            recommended={4}
            label={t('general.globalSubagents')}
            onCommit={(globalLimit) => patch({ subagent: { globalLimit } })}
          />
        </SettingRow>
      </SettingGroup>
    )
  }

  return (
    <>
      <SettingGroup>
        <SettingRow
          title={t('settings.language')}
          description={t('settings.languageHint')}
          wide
          last
        >
          <Segmented<AppLocale>
            label={t('settings.language')}
            value={settings.locale}
            options={[
              { value: 'zh-CN', label: t('settings.simplifiedChinese') },
              { value: 'en-US', label: t('settings.english') }
            ]}
            onChange={(locale) => patch({ locale })}
          />
        </SettingRow>
      </SettingGroup>

      {/* 需求:文件树右键第一行「在 X 中打开」的 X 在这里选(见 `DefaultOpenTargetSelect` 文件头) */}
      <SettingGroup title={t('openWith.settingGroup')}>
        <SettingRow title={t('openWith.settingTitle')} description={t('openWith.settingHint')} wide last>
          <DefaultOpenTargetSelect
            value={settings.defaultOpenTarget}
            onChange={(defaultOpenTarget) => patch({ defaultOpenTarget })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('settings.sounds')}>
        <SettingRow title={t('settings.taskCompleteSound')} description={t('settings.taskCompleteSoundHint')}>
          <Toggle
            label={t('settings.taskCompleteSound')}
            checked={settings.notifications.taskComplete}
            onChange={(taskComplete) => patch({ notifications: { taskComplete } })}
          />
        </SettingRow>
        <SettingRow title={t('settings.permissionSound')} description={t('settings.permissionSoundHint')}>
          <Toggle
            label={t('settings.permissionSound')}
            checked={settings.notifications.permissionApproval}
            onChange={(permissionApproval) => patch({ notifications: { permissionApproval } })}
          />
        </SettingRow>
        <SettingRow title={t('settings.planSound')} description={t('settings.planSoundHint')} last>
          <Toggle
            label={t('settings.planSound')}
            checked={settings.notifications.planApproval}
            onChange={(planApproval) => patch({ notifications: { planApproval } })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

/**
 * 「默认模型」/「默认子代理」那一栏 —— **先供应商,再这一家的模型**。
 * 原本在 `model/ModelPage.tsx`,随这两项设置一起搬到这里(见 `sub === 'agent'`
 * 分支头部的需求注释)。
 *
 * ★ 选择器本体已提取到 `components/RoleModelPicker.tsx` 共享 ——「扩展 → 子代理」
 *   的内置角色详情页(只读,唯独模型可改)用一模一样的控件,两处不能各写一份。
 */

type AppLocale = 'zh-CN' | 'en-US'

/** Shell 名称保持原样；自动选择的文案由 i18n 提供。 */
const SHELL_LABELS: Record<Exclude<ShellPreference, 'system'>, string> = {
  cmd: 'CMD',
  powershell: 'Windows PowerShell',
  pwsh: 'PowerShell 7 (pwsh)',
  zsh: 'Zsh',
  bash: 'Bash',
  fish: 'Fish',
  sh: 'sh'
}

/**
 * 最大输出 Token 的输入框。
 *
 * 需求:区间外的输入**不提交、原样还原**,和网络页的超时输入框同一套做法 ——
 * 主进程 `mergeSettings` 那侧也会再拦一次,两道都在是故意的:界面这道让用户
 * 当场看见自己打的值没被接受,不然他会以为存进去了,然后困惑于请求里还是旧额度。
 */
function MaxOutputTokensInput({
  value,
  onCommit
}: {
  value: number
  onCommit: (tokens: number) => void
}): ReactNode {
  const { t } = useI18n()
  return (
    <div className="w-[160px]">
      <DraftInput
        value={String(value)}
        disabled={false}
        ariaLabel={t('general.maxOutputTokens')}
        placeholder={String(DEFAULT_MAX_OUTPUT_TOKENS)}
        onCommit={() => {
          /* 提交在 transform 里做 —— 那边才有解析后的数字 */
        }}
        transform={(draft) => {
          const n = Number(draft.trim())
          if (
            !Number.isInteger(n) ||
            n < MAX_OUTPUT_TOKENS_BOUNDS.min ||
            n > MAX_OUTPUT_TOKENS_BOUNDS.max
          ) {
            return null
          }
          if (n !== value) onCommit(n)
          return String(n)
        }}
      />
    </div>
  )
}

/**
 * 滑杆 + 上方那行「当前 N · 推荐 M」—— 参考图 c44ef6d3 里就是这个形状。
 * 没有这行字的话,离散滑杆上根本读不出自己停在几。
 */
function SliderField({
  value,
  min,
  max,
  recommended,
  label,
  onCommit
}: {
  value: number
  min: number
  max: number
  recommended: number
  label: string
  onCommit: (v: number) => void
}): ReactNode {
  const { t } = useI18n()
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-[11.5px]">
        <span className="text-fg">{t('settings.current', { value })}</span>
        <span className="text-fg-faint">{t('settings.recommended', { value: recommended })}</span>
      </div>
      <Slider value={value} min={min} max={max} ariaLabel={label} onCommit={onCommit} />
    </div>
  )
}

