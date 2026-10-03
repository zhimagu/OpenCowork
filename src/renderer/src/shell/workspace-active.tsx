/**
 * 工作区活跃上下文（设计 §4.7.2）。
 *
 * ★ **React Context 跨 `createPortal` 生效** —— portal 只改变 DOM 挂载点，
 * 不改变 React 树。因此 workspace-owned 浮层（Dialog / ContextMenu / Select /
 * ImageLightbox / Tooltip）无需新增 `ownerWorkspaceId` props，也无需改造 12 处
 * 调用签名：它们只需 `useWorkspaceActive()`，失活时走自身 dismiss。
 *
 * ★ **无 Provider 时默认 `active: true`** —— app 级用法（WindowControls /
 * UpdateIndicator / SearchPalette / ToastViewport）不受影响，零改动。
 *
 * Provider 挂在 `WorkspaceDockLayer` 根（见该文件）。
 */
import { createContext, useContext } from 'react'

export interface WorkspaceActive {
  workspaceId: string
  active: boolean
}

export const WorkspaceActiveContext = createContext<WorkspaceActive>({
  workspaceId: '',
  active: true
})

export function useWorkspaceActive(): WorkspaceActive {
  return useContext(WorkspaceActiveContext)
}
