/**
 * 「默认模型」/「默认子代理」/「压缩模型」/内置子代理模型那一栏 —— **先供应商,
 * 再这一家的模型**。原是 `settings/pages/GeneralPage.tsx` 的模块内私有组件;
 * 「扩展 → 子代理」的内置角色详情页(只读,唯独模型可改)需要一模一样的交互,
 * 所以提取到这里共享 —— 两个调用点必须长成一家人,而不是各写一份慢慢漂移。
 *
 * ★ 触发器画成跟 `Select`(`components/ui/Select.tsx`)同款的按钮(高度/边框/
 * 字号都照抄),点开之后走的是 `ProviderModelMenu`——输入框模型选择器那套
 * 「先选供应商、进去再选模型、当前项打勾」的弹层交互,而不是原生 `<select>`。
 *
 * ★★ 两级的结果永远**成对**交给 `onChange`,调用方不需要(也不应该)自己拼:
 * 存的是 `(别名, 供应商)` 一对,而「A 家的别名 + B 家的锁」拼出来的候选集是空的,
 * 表现是下一次发送直接失败、错误还指着一个跟这次选择无关的供应商。
 *
 * ★★ 不用 `permissionReviewerModel`/`goalEvaluatorModel` 那种合并下拉
 * (`modelSelectionKey` + `modelOptions`)——理由在 `settings/pages/model/enabled-models.ts`
 * 那段 ★★ 注释:合并下拉只有一家提供某别名时不显示供应商名,而这一栏存的恰恰是
 * `(别名, 供应商)` 一对,「哪一家」是它的一半内容。触发器上的文案因此**总是**
 * 带供应商名(`别名 · 供应商`),不是只在别名冲突时才带。
 */
import { useMemo, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { isChatModelAlias, type ModelAlias, type UpstreamProvider } from '../../../shared/domain/provider'
import { ProviderModelMenu, type ProviderModelMenuRow } from './ProviderModelMenu'
import { useChatModelGuard } from './useChatModelGuard'
import { cn } from '../lib/cn'
import { useI18n } from '../i18n'
import { providerAliasOptions, roleModelChoice, selectableProviders } from '../settings/pages/model/enabled-models'

export function RoleModelPicker({
  label,
  models,
  providers,
  loaded,
  model,
  modelProviderId,
  emptyLabel,
  onChange
}: {
  label: string
  models: readonly ModelAlias[]
  providers: readonly UpstreamProvider[]
  loaded: boolean
  model: string
  modelProviderId: string | undefined
  /**
   * 空值那一项怎么称呼。缺省是「跟随对话」。
   *
   * ★ 可覆盖是因为**空值的含义按角色不同**:默认模型那栏空着是「跟随对话」,
   *   压缩那栏空着是「跟随会话模型」,内置子代理那栏空着是「跟随默认子代理」——
   *   三处说成同一句话会让人以为它们是同一个开关。
   */
  emptyLabel?: string
  /** 别名与供应商**必须一起给**。`("", undefined)` = 跟随对话 */
  onChange: (model: string, modelProviderId: string | undefined) => void
}): ReactNode {
  const { t } = useI18n()
  const emptyText = emptyLabel ?? t('models.followConversation')
  // 打开时校正存量的「选中了图片模型」(默认模型/默认子代理/压缩/内置子代理都走这里)
  const guardChatModel = useChatModelGuard(models, providers, { model, modelProviderId }, onChange)
  // ★ 只列文本模型:这些角色全是对话岗,图片模型选中了也发不出请求
  //   (判据收口在 `isChatModelAlias`)
  const chatModels = useMemo(() => models.filter(isChatModelAlias), [models])
  const choice = roleModelChoice(models, providers, model, modelProviderId)
  const providerName = providers.find((p) => p.id === choice.providerId)?.name
  const triggerLabel =
    choice.alias === ''
      ? emptyText
      : providerName === undefined
        ? choice.alias
        : `${choice.alias} · ${providerName}`
  const rows: ProviderModelMenuRow[] = useMemo(
    () =>
      selectableProviders(chatModels, providers, choice.providerId).map((p) => {
        const aliasOptions = providerAliasOptions(chatModels, p.id)
        return {
          id: p.id,
          label: p.name,
          description: t('chat.availableModels', { count: aliasOptions.length }),
          selected: p.id === choice.providerId,
          models: aliasOptions.map((o) => ({
            value: o.value,
            label: o.label,
            selected: p.id === choice.providerId && o.value === choice.alias
          }))
        }
      }),
    [chatModels, providers, choice.providerId, choice.alias, t]
  )

  return (
    <ProviderModelMenu
      trigger={
        <>
          <span className="min-w-0 flex-1 truncate">{triggerLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-fg-faint" />
        </>
      }
      // 视觉上照抄 `Select` 的触发器类名,同一屏其余控件才不会显得它是外来的。
      triggerClassName={cn(
        'group flex h-7 w-full items-center gap-1.5 rounded-[7px] border border-border',
        'bg-surface-field px-2 text-left text-[11.5px] text-fg outline-none',
        'transition-[background-color,border-color,box-shadow] duration-150',
        'hover:bg-tint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/15'
      )}
      className="w-full"
      align="start"
      width={280}
      ariaLabel={label}
      menuLabel={t('chat.selectProvider')}
      loaded={loaded}
      loadingLabel={t('common.loading')}
      emptyLabel={t('chat.noModelsConfigured')}
      rows={rows}
      topItem={{
        label: emptyText,
        selected: choice.providerId === '',
        onSelect: () => onChange('', undefined)
      }}
      onSelectModel={(providerId, alias) => onChange(alias, providerId)}
      onOpenChange={guardChatModel}
    />
  )
}
