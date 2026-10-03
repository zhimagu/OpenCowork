/**
 * 子代理 Tab。
 *
 * ★ 不再用 `ResourcePanel`:那一套的新建是「先弹框问名字和作用域」,而子代理的
 *   名字和作用域已经在它自己的结构化表单里 —— 再问一遍是多一道没意义的门,而且
 *   问完还不能改。共用的只剩列表那半边(`ResourceListPane`),命令那条路径一个字没动。
 *
 * ★ 存/删/建这三段和 `ResourcePanel` 里同形(含「新建那份 revision 是空串,
 *   传 undefined 走新建分支」这条),唯一多出来的是**改名 / 换作用域**:
 *   那在磁盘上是两个文件,所以要**先写新的、再删旧的**。
 *
 * ★ 内置角色(general-purpose 等)没有源文件,点开走的是**只读详情页**
 *   (照 `ModesPanel` 的 `BuiltinModeView` 范式),唯一可改的字段是模型:
 *   写进 `settings.subagent.modelOverrides`,读写走 `services/app.ts` 的
 *   `getSettings`/`updateSettings`(扩展面板不是设置页,拿不到 props)。
 */
import { ArrowLeft, Bot } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentListItem, MarkdownResourceFile } from '../../../../../shared/domain/markdown-resource'
import type { ModelAlias, UpstreamProvider } from '../../../../../shared/domain/provider'
import { IconButton } from '../../../components/ui/IconButton'
import { RoleModelPicker } from '../../../components/RoleModelPicker'
import { useI18n } from '../../../i18n'
import { listAgents, onAgentsChanged, setAgentEnabled } from '../../../services/agents'
import { getSettings, updateSettings } from '../../../services/app'
import { deleteResource, getResource, saveResource } from '../../../services/resources'
import { useModelsStore } from '../../../stores/models'
import { toast } from '../../../stores/toast'
import { useWindowStore } from '../../../stores/window'
import { ResourceListPane } from '../shared/ResourceListPane'
import type { PanelRow } from '../shared/ResourcePanel'
import { AgentEditor, type AgentSavePayload } from './AgentEditor'
import { agentColorHex } from './agent-form'

/** 内置角色的用途说明 i18n 键(与设置页那一版共用同一批 key);未知角色没有说明。 */
const BUILTIN_ROLE_DESC_KEYS = new Set(['general-purpose', 'code-analyst', 'code-reviewer', 'code-editor'])

export function AgentsPanel(): ReactNode {
  const { t } = useI18n()
  const workspaceId = useWindowStore((s) => s.activeWorkspaceId)
  const models = useModelsStore((s) => s.models)
  const providers = useModelsStore((s) => s.providers)
  const modelsLoaded = useModelsStore((s) => s.loaded)
  const loadModels = useModelsStore((s) => s.load)
  const [rows, setRows] = useState<AgentListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MarkdownResourceFile | null>(null)
  const [viewing, setViewing] = useState<AgentListItem | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(() => {
    void listAgents(workspaceId ?? undefined)
      .then(setRows)
      .catch(() => setError(t('ext.error.loadFailed')))
  }, [workspaceId, t])

  useEffect(() => {
    refresh()
    return onAgentsChanged(refresh)
  }, [refresh])

  useEffect(() => {
    if (!modelsLoaded) void loadModels()
  }, [modelsLoaded, loadModels])

  const open = (scope: 'global' | 'project', name: string): void => {
    setError(null)
    void getResource('agent', scope, name, workspaceId ?? undefined)
      .then(setEditing)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const create = (): void => {
    setError(null)
    /*
      ★ 先在内存里造一份「还没落盘」的文件,revision 留空。不先写一个空文件再打开,
      是因为用户可能填一半就走了 —— 那样磁盘上会留下一个半成品,而子代理的半成品
      会立刻被 `Task` 工具看见。
    */
    setEditing({
      kind: 'agent',
      scope: workspaceId === null ? 'global' : 'project',
      name: '',
      path: '',
      /*
        ★ 新建的默认档位是**完全访问**,而不是「继承」。省掉这个键的含义是
        「跟父代理同档」,可子代理是被 `Task` 派出去自己跑完一整段活的 —— 父代理
        在 ask 档时,它每动一次文件都要弹一次框,而弹框问的是用户看不见上下文的
        那一步,结果就是一路点「允许」。要收紧的人在表单里改一下就是了,
        但默认值得让它先能干活。
      */
      frontmatter: { permissionMode: 'full' },
      body: '',
      skipped: [],
      revision: ''
    })
  }

  const save = (payload: AgentSavePayload): void => {
    const current = editing
    if (current === null) return
    const isNew = current.revision === ''
    const moved = !isNew && (payload.name !== current.name || payload.scope !== current.scope)
    setSaving(true)
    setError(null)
    void saveResource({
      kind: 'agent',
      scope: payload.scope,
      name: payload.name,
      ...(workspaceId === null ? {} : { workspaceId }),
      frontmatter: payload.frontmatter,
      body: payload.body,
      /*
        ★ 改名 / 换作用域时也传 undefined:目标是一个**还不存在**的文件,带着旧文件的
        revision 去比对必然对不上。而 `writeResourceFile` 在 revision 缺席时会拒绝
        覆盖已有文件,所以「新建」这条分支本身就挡住了撞名。
      */
      ...(isNew || moved ? {} : { revision: current.revision })
    })
      .then(async (file) => {
        /*
          ★ 顺序是**先写后删**,而且删失败不回滚:写失败的话什么都没发生;
          删失败最坏是磁盘上多一份旧的(用户看得见、能自己删),而反过来
          先删后写一旦写失败,用户的子代理就真没了。
        */
        if (moved) await deleteResource('agent', current.scope, current.name, workspaceId ?? undefined)
        setEditing(file)
        refresh()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false))
  }

  const remove = (): void => {
    const current = editing
    if (current === null) return
    // 还没落盘的那一份没有文件可删,直接退回列表。
    // ★ 这里不再确认一次:两个视图各自都有自己的确认弹窗(表单视图在
    //   `AgentEditor` 里,源码视图在 `MarkdownResourceEditor` 里),再弹一次
    //   就成了连点两下才删得掉。
    if (current.revision === '') { setEditing(null); return }
    void deleteResource('agent', current.scope, current.name, workspaceId ?? undefined)
      .then(() => { setEditing(null); refresh() })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  if (viewing !== null) {
    return <BuiltinAgentView agent={viewing} models={models} providers={providers} loaded={modelsLoaded} onBack={() => setViewing(null)} />
  }
  if (editing !== null) {
    return (
      <AgentEditor
        // 换一行编辑(或者存完改名)就重建表单状态,免得上一条的草稿串到下一条。
        key={`${editing.scope}:${editing.name}:${editing.path}`}
        file={editing}
        taken={new Set(rows.map((row) => `${row.scope}:${row.name}`))}
        onSave={save}
        onDelete={remove}
        onClose={() => { setEditing(null); setError(null) }}
        saving={saving}
        error={error}
        workspaceId={workspaceId}
      />
    )
  }

  return (
    <ResourceListPane
      rows={rows.map<PanelRow>((a) => ({
        name: a.name,
        description: a.description,
        scope: a.scope,
        enabled: a.enabled,
        ...(agentColorHex(a.color) === undefined ? {} : { color: agentColorHex(a.color) })
      }))}
      error={error}
      icon={<Bot size={26} />}
      emptyTitle={t('ext.agents.empty')}
      emptyHint={t('ext.agents.emptyHint')}
      onNew={create}
      onOpen={(row) => {
        if (row.scope === 'builtin') {
          const agent = rows.find((a) => a.name === row.name)
          if (agent !== undefined) setViewing(agent)
          return
        }
        open(row.scope, row.name)
      }}
      onToggle={(row, enabled) => { void setAgentEnabled(row.name, enabled).then(refresh) }}
      /*
        ★ 必须开 `openReadOnly`:内置角色 `scope === 'builtin'`,表格默认把只读行
        的按钮 disabled(见 `ResourceTable` 的 `disabled={readOnly && !openReadOnly}`)。
        不开的话内置角色点不动 —— 而它们正是要靠点击打开只读详情页去改模型的。
      */
      openReadOnly
    />
  )
}

/**
 * 内置角色的只读详情页(照 `ModesPanel` 的 `BuiltinModeView` 范式)。
 *
 * ★ 一切只读,唯独模型可改:改的是 `settings.subagent.modelOverrides[name]`,
 *   **只发单个条目** —— 后端 `mergeSubagentModelOverrides` 按 key 合并,
 *   patch 里没出现的角色原样保留。空值(`model: ''`)= 跟随默认子代理,
 *   合并时会把这个键从表里剪掉。
 */
function BuiltinAgentView({
  agent,
  models,
  providers,
  loaded,
  onBack
}: {
  agent: AgentListItem
  models: readonly ModelAlias[]
  providers: readonly UpstreamProvider[]
  loaded: boolean
  onBack: () => void
}): ReactNode {
  const { t } = useI18n()
  /*
    ★ 模型覆盖在本页持一份本地快照:打开时从 `getSettings()` 读一次,改动后
    乐观覆盖。不直接订阅全量 settings —— 扩展面板拿不到设置 props,而只为
    一个下拉订阅全局广播会把每次无关的设置写入都变成这里的一次重渲染。
    写失败时清掉快照,下拉退回「跟随默认子代理」并 toast 说明没存上。
  */
  const [override, setOverride] = useState<{ model: string; modelProviderId?: string } | undefined>(undefined)
  const [loadedOverride, setLoadedOverride] = useState(false)
  /*
    ★ 用户一旦碰过下拉,打开时那次 `getSettings()` 的迟到结果就不许再写 `override`
    —— 否则用户在 IPC 往返之前选的模型,会被旧快照覆盖回旧值(库里是新的,
    界面显示旧的,退回快照的失败分支还会把它写成错的)。换角色时重置。
  */
  const touched = useRef(false)
  useEffect(() => {
    touched.current = false
    let alive = true
    void getSettings()
      .then((s) => { if (alive && !touched.current) setOverride(s.subagent.modelOverrides[agent.name]) })
      .catch(() => { if (alive) setLoadedOverride(true) })
      .finally(() => { if (alive) setLoadedOverride(true) })
    return () => { alive = false }
  }, [agent.name])

  const changeModel = (model: string, modelProviderId: string | undefined): void => {
    touched.current = true
    // ★ 先乐观更新本页(下拉立刻反映选择),再落库;失败时退回读到的快照并 toast。
    const previous = override
    setOverride({ model, modelProviderId })
    void updateSettings({ subagent: { modelOverrides: { [agent.name]: { model, modelProviderId } } } })
      .catch(() => {
        toast.error(t('ext.error.saveFailed'))
        setOverride(previous)
      })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <IconButton label={t('ext.back')} size={26} width={34} onClick={onBack} className="rounded-pill bg-tint"><ArrowLeft size={14} /></IconButton>
        <span className="text-[13px] text-fg">{agent.name}</span>
        <span className="text-[11px] text-fg-faint">{t('ext.modes.readOnly')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl">
          <p className="mb-4 text-[12px] text-fg-muted">{agent.description}</p>
          {BUILTIN_ROLE_DESC_KEYS.has(agent.name) && (
            <p className="mb-4 text-[11px] text-fg-faint">
              {t(`general.subagentRoleDesc.${agent.name}` as 'general.subagentRoleDesc.general-purpose')}
            </p>
          )}
          <div className="mb-4">
            <h2 className="mb-1 text-[12px] font-medium text-fg">{t('ext.field.tools')}</h2>
            <p className="selectable font-mono text-[11px] text-fg-muted">
              {(agent.tools ?? []).length > 0 ? agent.tools!.join(', ') : t('ext.modes.allTools')}
            </p>
          </div>
          <h2 className="mb-1 text-[12px] font-medium text-fg">{t('ext.field.prompt')}</h2>
          <pre className="selectable mb-4 whitespace-pre-wrap rounded-lg border border-border bg-app p-3 text-[12px] leading-5 text-fg-muted">{agent.prompt ?? ''}</pre>
          <div>
            <h2 className="mb-1 text-[12px] font-medium text-fg">{t('ext.field.model')}</h2>
            <div className="max-w-[320px]">
              <RoleModelPicker
                label={t('ext.agents.builtinModel', { name: agent.name })}
                models={models}
                providers={providers}
                loaded={loaded}
                model={override?.model ?? ''}
                modelProviderId={override?.modelProviderId}
                emptyLabel={t('ext.field.inheritDefault')}
                onChange={changeModel}
              />
            </div>
            {!loadedOverride && <p className="mt-1 text-[11px] text-fg-faint">{t('common.loading')}</p>}
            <p className="mt-2 text-[11px] text-fg-faint">{t('ext.agents.builtinModelHint')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 保持 `AgentSavePayload` 的导出被本文件引用(编辑器保存载荷从这里过手)。
