/**
 * useTerminalLayout - 이진 트리 기반 터미널 레이아웃 상태 관리
 *
 * Warp 터미널의 이진 트리 자료구조를 채택하여 유연한 분할을 지원합니다.
 * - 수평/수직 분할을 자유롭게 중첩 가능
 * - 같은 방향 분할 시 부모 브랜치에 추가 (불필요한 중첩 방지)
 * - 패인 삭제 시 단일 자식 브랜치 자동 축소
 * - 줌(최대화) 토글: 포커스된 패인을 전체 확대/복원
 * - 비활성 패인 디밍
 * - 방향 기반 포커스 네비게이션
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { MAX_PANES, MIN_PANE_RATIO, DUPLICATE_ALERT_TIMEOUT } from '../../shared/constants'
import {
  type PaneLeaf,
  type PaneBranch,
  type PaneNode,
  type PaneTreeState,
  type DropPosition,
  makeLeaf,
  makeDefaultTree,
  getAllLeaves,
  countLeaves,
  findLeaf,
  findPath,
  findAdjacentPane,
  replaceNode,
  removeLeaf,
  splitLeaf,
  swapLastTwo,
  pruneInvalidSessions
} from '../utils/pane-tree'
import { saveTreeToStorage, loadTreeFromStorage } from '../utils/pane-storage'

// Re-export types for backward compatibility with other modules
export type { PaneLeaf, PaneBranch, PaneNode, PaneTreeState, DropPosition }
export { getAllLeaves }

export interface UseTerminalLayoutReturn {
  tree: PaneTreeState
  isGridMode: boolean
  /** 중복 세션 알림 메시지 (일정 시간 후 자동 소멸) */
  duplicateAlert: string | null
  splitHorizontal: () => void
  splitVertical: () => void
  closePane: () => void
  toggleZoom: () => void
  /** 패인 세션 변경. 중복 시 해당 패인으로 포커스 이동 + 알림 */
  setPaneSession: (paneId: string, sessionId: string) => void
  focusPane: (paneId: string) => void
  focusDirection: (direction: 'left' | 'right' | 'up' | 'down') => void
  handleResize: (branchId: string, handleIndex: number) => (e: React.MouseEvent) => void
  dropSession: (sessionId: string, targetPaneId: string, position: DropPosition) => void
  getFocusedSessionId: () => string | null
  resetToSingle: (sessionId: string) => void
  /** 특정 방향으로 이동 가능한 인접 패인이 있는지 확인 */
  hasAdjacentPane: (direction: 'left' | 'right' | 'up' | 'down') => boolean
  /** 두 패인의 세션을 교환 */
  swapPanes: (paneIdA: string, paneIdB: string) => void
  /** 패인을 다른 위치로 이동 (드래그 재배치) */
  movePane: (sourcePaneId: string, targetPaneId: string, position: DropPosition) => void
}

interface UseTerminalLayoutParams {
  activeSessionId: string | null
  sessions: { id: string }[]
}

/* ────────── 훅 ────────── */

export function useTerminalLayout({
  activeSessionId,
  sessions
}: UseTerminalLayoutParams): UseTerminalLayoutReturn {
  const [tree, setTreeRaw] = useState<PaneTreeState>(() => {
    const validIds = new Set(sessions.map((s) => s.id))
    const saved = loadTreeFromStorage()
    if (saved && validIds.size > 0) {
      const pruned = pruneInvalidSessions(saved.root, validIds)
      if (pruned) {
        const leaves = getAllLeaves(pruned)
        const focusValid = leaves.some((l) => l.id === saved.focusedPaneId)
        return {
          root: pruned,
          focusedPaneId: focusValid ? saved.focusedPaneId : leaves[0].id,
          zoomedPaneId: null // 줌 상태는 복원하지 않음
        }
      }
    }
    return activeSessionId ? makeDefaultTree(activeSessionId) : makeDefaultTree('')
  })

  // 트리 변경 시 자동 저장
  const setTree: typeof setTreeRaw = useCallback((action) => {
    setTreeRaw((prev) => {
      const next = typeof action === 'function' ? action(prev) : action
      if (next !== prev) saveTreeToStorage(next)
      return next
    })
  }, [])

  // 단일 패인 모드에서 activeSessionId 변경 시 동기화
  const prevActiveRef = useRef(activeSessionId)
  if (activeSessionId && activeSessionId !== prevActiveRef.current) {
    prevActiveRef.current = activeSessionId
    if (tree.root.type === 'leaf' && tree.root.sessionId !== activeSessionId) {
      const leaf = makeLeaf(activeSessionId)
      const newTree = { root: leaf, focusedPaneId: leaf.id, zoomedPaneId: null }
      setTreeRaw(newTree)
      saveTreeToStorage(newTree)
    }
  }

  // 세션 삭제 시 트리에서 해당 패인 자동 제거
  useEffect(() => {
    const validIds = new Set(sessions.map((s) => s.id))
    const leaves = getAllLeaves(tree.root)
    const hasInvalid = leaves.some((l) => l.sessionId && !validIds.has(l.sessionId))
    if (!hasInvalid) return

    const pruned = pruneInvalidSessions(tree.root, validIds)
    if (!pruned) {
      // 모든 패인 제거됨 → 남은 세션으로 초기화
      const fallback = sessions[0]?.id ?? ''
      const newTree = makeDefaultTree(fallback)
      setTreeRaw(newTree)
      saveTreeToStorage(newTree)
      return
    }
    const newLeaves = getAllLeaves(pruned)
    const focusValid = newLeaves.some((l) => l.id === tree.focusedPaneId)
    const newTree: PaneTreeState = {
      root: pruned,
      focusedPaneId: focusValid ? tree.focusedPaneId : newLeaves[0].id,
      zoomedPaneId: null
    }
    setTreeRaw(newTree)
    saveTreeToStorage(newTree)
  }, [sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  const isGridMode = countLeaves(tree.root) > 1

  // 중복 세션 알림
  const [duplicateAlert, setDuplicateAlert] = useState<string | null>(null)
  const duplicateTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const showDuplicateAlert = useCallback((sessionId: string) => {
    const name = sessions.find((s) => s.id === sessionId)?.id ?? sessionId
    setDuplicateAlert(name)
    if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current)
    duplicateTimerRef.current = setTimeout(() => setDuplicateAlert(null), DUPLICATE_ALERT_TIMEOUT)
  }, [sessions])

  useEffect(() => {
    return () => { if (duplicateTimerRef.current) clearTimeout(duplicateTimerRef.current) }
  }, [])

  /** 그리드에 없는 다음 세션 찾기 */
  const findNextSession = useCallback((): string | null => {
    const usedIds = new Set(getAllLeaves(tree.root).map((l) => l.sessionId))
    return sessions.find((s) => !usedIds.has(s.id))?.id ?? null
  }, [tree.root, sessions])

  /* ──── 수평 분할 (좌/우) ──── */
  const splitHorizontal = useCallback(() => {
    setTree((prev) => {
      if (countLeaves(prev.root) >= MAX_PANES) return prev
      const usedIds = new Set(getAllLeaves(prev.root).map((l) => l.sessionId))
      const nextId = sessions.find((s) => !usedIds.has(s.id))?.id
      if (!nextId) return prev
      const newLeaf = makeLeaf(nextId)
      const newRoot = splitLeaf(prev.root, prev.focusedPaneId, 'horizontal', newLeaf)
      return { ...prev, root: newRoot, focusedPaneId: newLeaf.id, zoomedPaneId: null }
    })
  }, [sessions])

  /* ──── 수직 분할 (상/하) ──── */
  const splitVertical = useCallback(() => {
    setTree((prev) => {
      if (countLeaves(prev.root) >= MAX_PANES) return prev
      const usedIds = new Set(getAllLeaves(prev.root).map((l) => l.sessionId))
      const nextId = sessions.find((s) => !usedIds.has(s.id))?.id
      if (!nextId) return prev
      const newLeaf = makeLeaf(nextId)
      const newRoot = splitLeaf(prev.root, prev.focusedPaneId, 'vertical', newLeaf)
      return { ...prev, root: newRoot, focusedPaneId: newLeaf.id, zoomedPaneId: null }
    })
  }, [sessions])

  /* ──── 포커스된 패인 닫기 ──── */
  const closePane = useCallback(() => {
    setTree((prev) => {
      if (countLeaves(prev.root) <= 1) return prev
      const result = removeLeaf(prev.root, prev.focusedPaneId)
      if (!result) return prev
      const leaves = getAllLeaves(result)
      const newFocused = leaves[0]?.id ?? prev.focusedPaneId
      return { root: result, focusedPaneId: newFocused, zoomedPaneId: null }
    })
  }, [])

  /* ──── 줌 토글 ──── */
  const toggleZoom = useCallback(() => {
    setTree((prev) => {
      if (!isGridMode) return prev
      const newZoomed = prev.zoomedPaneId === prev.focusedPaneId ? null : prev.focusedPaneId
      return { ...prev, zoomedPaneId: newZoomed }
    })
  }, [isGridMode])

  /* ──── 패인 세션 변경 ──── */
  const setPaneSession = useCallback((paneId: string, sessionId: string) => {
    setTree((prev) => {
      const leaf = findLeaf(prev.root, paneId)
      if (!leaf) return prev
      // 이미 다른 패인에 같은 세션이 열려있으면 해당 패인으로 포커스 + 알림
      const existing = getAllLeaves(prev.root).find((l) => l.sessionId === sessionId && l.id !== paneId)
      if (existing) {
        showDuplicateAlert(sessionId)
        return { ...prev, focusedPaneId: existing.id }
      }
      const newLeaf: PaneLeaf = { ...leaf, sessionId }
      return { ...prev, root: replaceNode(prev.root, paneId, newLeaf) }
    })
  }, [showDuplicateAlert])

  /* ──── 포커스 이동 ──── */
  const focusPane = useCallback((paneId: string) => {
    setTree((prev) => ({ ...prev, focusedPaneId: paneId }))
  }, [])

  /* ──── 방향 기반 포커스 이동 ──── */
  const focusDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    setTree((prev) => {
      const targetId = findAdjacentPane(prev.root, prev.focusedPaneId, direction)
      if (!targetId) return prev
      return { ...prev, focusedPaneId: targetId }
    })
  }, [])

  /* ──── 리사이즈 ──── */
  const handleResize = useCallback((branchId: string, handleIndex: number) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const el = e.target as HTMLElement
      const container = el.closest('.terminal-grid-branch') as HTMLElement
      if (!container) return

      let startRatios: number[]
      let startPos: number
      let containerSize: number
      let isHorizontal: boolean

      setTree((prev) => {
        const path = findPath(prev.root, branchId)
        const branch = path?.[path.length - 1]?.node
        if (!branch || branch.type !== 'branch') return prev
        startRatios = [...branch.ratios]
        isHorizontal = branch.direction === 'horizontal'
        startPos = isHorizontal ? e.clientX : e.clientY
        const rect = container.getBoundingClientRect()
        containerSize = isHorizontal ? rect.width : rect.height
        return prev
      })

      const onMove = (me: MouseEvent): void => {
        const delta = ((isHorizontal! ? me.clientX : me.clientY) - startPos!) / containerSize!
        setTree((prev) => {
          const path = findPath(prev.root, branchId)
          const branch = path?.[path.length - 1]?.node
          if (!branch || branch.type !== 'branch') return prev
          const ratios = [...startRatios!]
          const minRatio = MIN_PANE_RATIO
          const sum = ratios[handleIndex] + ratios[handleIndex + 1]
          const newA = Math.max(minRatio, Math.min(sum - minRatio, ratios[handleIndex] + delta))
          ratios[handleIndex] = newA
          ratios[handleIndex + 1] = sum - newA
          const newBranch: PaneBranch = { ...branch, ratios }
          return { ...prev, root: replaceNode(prev.root, branchId, newBranch) }
        })
      }

      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }, [])

  /* ──── 드래그 앤 드롭 ──── */
  const dropSession = useCallback((
    sessionId: string,
    targetPaneId: string,
    position: DropPosition
  ) => {
    setTree((prev) => {
      // 이미 트리에 같은 세션이 열려있으면 해당 패인으로 포커스 + 알림
      const existing = getAllLeaves(prev.root).find((l) => l.sessionId === sessionId)
      if (existing) {
        showDuplicateAlert(sessionId)
        return { ...prev, focusedPaneId: existing.id }
      }

      if (position === 'center') {
        const leaf = findLeaf(prev.root, targetPaneId)
        if (!leaf) return prev
        const newLeaf: PaneLeaf = { ...leaf, sessionId }
        return { ...prev, root: replaceNode(prev.root, targetPaneId, newLeaf), focusedPaneId: targetPaneId }
      }

      if (countLeaves(prev.root) >= MAX_PANES) return prev

      const direction: 'horizontal' | 'vertical' =
        position === 'left' || position === 'right' ? 'horizontal' : 'vertical'

      const newLeaf = makeLeaf(sessionId)

      // 분할 후 새 리프를 올바른 위치에 배치
      // splitLeaf는 항상 대상 뒤에 추가하므로, left/top일 때는 순서를 바꿔야 함
      if (position === 'left' || position === 'top') {
        // 대상을 분할한 뒤 새 리프와 기존 리프의 순서를 뒤집기
        const newRoot = splitLeaf(prev.root, targetPaneId, direction, newLeaf)
        // splitLeaf가 [target, newLeaf] 순으로 넣으므로, 순서를 바꿔야 함
        const swapped = swapLastTwo(newRoot, targetPaneId, newLeaf.id)
        return { ...prev, root: swapped, focusedPaneId: newLeaf.id }
      }

      const newRoot = splitLeaf(prev.root, targetPaneId, direction, newLeaf)
      return { ...prev, root: newRoot, focusedPaneId: newLeaf.id }
    })
  }, [showDuplicateAlert])

  /* ──── 포커스된 세션 ID ──── */
  const getFocusedSessionId = useCallback((): string | null => {
    const leaf = findLeaf(tree.root, tree.focusedPaneId)
    return leaf?.sessionId ?? null
  }, [tree])

  /* ──── 단일 모드로 복귀 ──── */
  const resetToSingle = useCallback((sessionId: string) => {
    const leaf = makeLeaf(sessionId)
    setTree({ root: leaf, focusedPaneId: leaf.id, zoomedPaneId: null })
  }, [])

  /* ──── 방향 이동 가능 여부 확인 ──── */
  const hasAdjacentPane = useCallback((direction: 'left' | 'right' | 'up' | 'down'): boolean => {
    return findAdjacentPane(tree.root, tree.focusedPaneId, direction) !== null
  }, [tree])

  /* ──── 두 패인의 세션 교환 ──── */
  const swapPanes = useCallback((paneIdA: string, paneIdB: string) => {
    if (paneIdA === paneIdB) return
    setTree((prev) => {
      const leafA = findLeaf(prev.root, paneIdA)
      const leafB = findLeaf(prev.root, paneIdB)
      if (!leafA || !leafB) return prev
      // A의 세션을 B로, B의 세션을 A로
      let newRoot = replaceNode(prev.root, paneIdA, { ...leafA, sessionId: leafB.sessionId })
      newRoot = replaceNode(newRoot, paneIdB, { ...leafB, sessionId: leafA.sessionId })
      return { ...prev, root: newRoot, focusedPaneId: paneIdB }
    })
  }, [])

  /* ──── 패인을 다른 위치로 이동 ──── */
  const movePane = useCallback((
    sourcePaneId: string,
    targetPaneId: string,
    position: DropPosition
  ) => {
    if (sourcePaneId === targetPaneId) return
    setTree((prev) => {
      const sourceLeaf = findLeaf(prev.root, sourcePaneId)
      if (!sourceLeaf) return prev

      if (position === 'center') {
        // 중앙 드롭: 세션 교환
        const targetLeaf = findLeaf(prev.root, targetPaneId)
        if (!targetLeaf) return prev
        let newRoot = replaceNode(prev.root, sourcePaneId, { ...sourceLeaf, sessionId: targetLeaf.sessionId })
        newRoot = replaceNode(newRoot, targetPaneId, { ...targetLeaf, sessionId: sourceLeaf.sessionId })
        return { ...prev, root: newRoot, focusedPaneId: targetPaneId }
      }

      // 가장자리 드롭: 소스 제거 → 타겟 위치에 분할 삽입
      const sessionId = sourceLeaf.sessionId
      const afterRemove = removeLeaf(prev.root, sourcePaneId)
      if (!afterRemove) return prev

      const direction: 'horizontal' | 'vertical' =
        position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
      const newLeaf = makeLeaf(sessionId)
      let newRoot: PaneNode

      if (position === 'left' || position === 'top') {
        newRoot = splitLeaf(afterRemove, targetPaneId, direction, newLeaf)
        newRoot = swapLastTwo(newRoot, targetPaneId, newLeaf.id)
      } else {
        newRoot = splitLeaf(afterRemove, targetPaneId, direction, newLeaf)
      }

      return { ...prev, root: newRoot, focusedPaneId: newLeaf.id }
    })
  }, [])

  return {
    tree,
    isGridMode,
    duplicateAlert,
    splitHorizontal,
    splitVertical,
    closePane,
    toggleZoom,
    setPaneSession,
    focusPane,
    focusDirection,
    handleResize,
    dropSession,
    getFocusedSessionId,
    resetToSingle,
    hasAdjacentPane,
    swapPanes,
    movePane
  }
}
