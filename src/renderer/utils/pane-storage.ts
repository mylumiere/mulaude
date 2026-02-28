/**
 * pane-storage — 터미널 레이아웃 localStorage 영속화
 */

import type { PaneTreeState } from './pane-tree'
import { syncIdCounter } from './pane-tree'

const STORAGE_KEY = 'mulaude-grid-layout'

export function saveTreeToStorage(tree: PaneTreeState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tree)) } catch { /* ignore */ }
}

export function loadTreeFromStorage(): PaneTreeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PaneTreeState
    if (!parsed.root || !parsed.focusedPaneId) return null
    // ID 카운터를 복원된 트리의 최대 ID 이후로 설정
    syncIdCounter(parsed.root)
    return parsed
  } catch { return null }
}
