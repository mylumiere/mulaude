/**
 * pane-tree — 이진 트리 기반 터미널 레이아웃 자료구조
 *
 * React 의존성 없는 순수 함수와 타입을 제공합니다.
 * useTerminalLayout 훅과 TerminalGrid 컴포넌트에서 공유합니다.
 */

/* ────────── 타입 정의 ────────── */

export interface PaneLeaf {
  type: 'leaf'
  id: string
  sessionId: string
}

export interface PaneBranch {
  type: 'branch'
  id: string
  direction: 'horizontal' | 'vertical'
  children: PaneNode[]
  ratios: number[] // 합계 = 1.0
}

export type PaneNode = PaneLeaf | PaneBranch

export interface PaneTreeState {
  root: PaneNode
  focusedPaneId: string
  zoomedPaneId: string | null
}

export type DropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface PathEntry { node: PaneNode; childIndex?: number }

/* ────────── ID 생성 ────────── */

let _idCounter = 0

export function genId(): string { return `pane-${++_idCounter}` }

/** 트리 내 모든 노드 ID에서 최대값 추출 → _idCounter 동기화 */
export function syncIdCounter(node: PaneNode): void {
  const match = node.id.match(/^pane-(\d+)$/)
  if (match) _idCounter = Math.max(_idCounter, parseInt(match[1], 10))
  if (node.type === 'branch') node.children.forEach(syncIdCounter)
}

/* ────────── 팩토리 ────────── */

export function makeLeaf(sessionId: string): PaneLeaf {
  return { type: 'leaf', id: genId(), sessionId }
}

export function makeDefaultTree(sessionId: string): PaneTreeState {
  const leaf = makeLeaf(sessionId)
  return { root: leaf, focusedPaneId: leaf.id, zoomedPaneId: null }
}

/* ────────── 쿼리 ────────── */

/** 모든 리프 노드 수집 */
export function getAllLeaves(node: PaneNode): PaneLeaf[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(getAllLeaves)
}

/** 총 리프 수 */
export function countLeaves(node: PaneNode): number {
  if (node.type === 'leaf') return 1
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0)
}

/** ID로 리프 찾기 */
export function findLeaf(node: PaneNode, id: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.id === id ? node : null
  for (const c of node.children) {
    const found = findLeaf(c, id)
    if (found) return found
  }
  return null
}

/** 루트에서 대상까지의 경로 */
export function findPath(root: PaneNode, targetId: string): PathEntry[] | null {
  if (root.id === targetId) return [{ node: root }]
  if (root.type === 'leaf') return null
  for (let i = 0; i < root.children.length; i++) {
    const sub = findPath(root.children[i], targetId)
    if (sub) return [{ node: root, childIndex: i }, ...sub]
  }
  return null
}

/** 방향 기반 인접 패인 찾기 */
export function findAdjacentPane(
  root: PaneNode,
  currentId: string,
  direction: 'left' | 'right' | 'up' | 'down'
): string | null {
  const path = findPath(root, currentId)
  if (!path) return null

  const axis: 'horizontal' | 'vertical' =
    direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical'
  const goBack = direction === 'left' || direction === 'up'

  for (let i = path.length - 2; i >= 0; i--) {
    const entry = path[i]
    const node = entry.node as PaneBranch
    if (node.direction !== axis || entry.childIndex === undefined) continue

    const targetIdx = goBack ? entry.childIndex - 1 : entry.childIndex + 1
    if (targetIdx < 0 || targetIdx >= node.children.length) continue

    return findEdgeLeaf(node.children[targetIdx], goBack ? 'last' : 'first', axis)
  }

  return null
}

export function findEdgeLeaf(node: PaneNode, edge: 'first' | 'last', _axis: 'horizontal' | 'vertical'): string {
  if (node.type === 'leaf') return node.id
  const idx = edge === 'first' ? 0 : node.children.length - 1
  return findEdgeLeaf(node.children[idx], edge, _axis)
}

/* ────────── 변환 ────────── */

/** 트리에서 노드 교체 (불변) */
export function replaceNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement
  if (root.type === 'leaf') return root
  const newChildren = root.children.map((c) => replaceNode(c, targetId, replacement))
  if (newChildren.every((c, i) => c === root.children[i])) return root
  return { ...root, children: newChildren }
}

/** 리프 제거 + 단일 자식 브랜치 자동 축소 */
export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root

  const newChildren: PaneNode[] = []
  const newRatios: number[] = []

  for (let i = 0; i < root.children.length; i++) {
    const result = removeLeaf(root.children[i], leafId)
    if (result !== null) {
      newChildren.push(result)
      newRatios.push(root.ratios[i])
    }
  }

  if (newChildren.length === root.children.length) {
    // 삭제가 이 레벨에서 발생하지 않았을 수 있지만 하위에서 변경됐을 수 있음
    const anyChanged = newChildren.some((c, i) => c !== root.children[i])
    if (!anyChanged) return root
  }

  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0] // 축소

  // 비율 재정규화
  const total = newRatios.reduce((a, b) => a + b, 0)
  return { ...root, children: newChildren, ratios: newRatios.map((r) => r / total) }
}

/** 리프를 분할 (같은 방향이면 부모에 추가, 아니면 새 브랜치 생성) */
export function splitLeaf(
  root: PaneNode,
  leafId: string,
  direction: 'horizontal' | 'vertical',
  newLeaf: PaneLeaf
): PaneNode {
  if (root.type === 'leaf') {
    if (root.id !== leafId) return root
    return {
      type: 'branch',
      id: genId(),
      direction,
      children: [root, newLeaf],
      ratios: [0.5, 0.5]
    }
  }

  // 같은 방향의 직접 자식이면 형제로 추가
  if (root.direction === direction) {
    const childIdx = root.children.findIndex((c) => c.id === leafId)
    if (childIdx >= 0 && root.children[childIdx].type === 'leaf') {
      const newChildren = [...root.children]
      newChildren.splice(childIdx + 1, 0, newLeaf)
      const newRatios = [...root.ratios]
      const splitRatio = newRatios[childIdx] / 2
      newRatios[childIdx] = splitRatio
      newRatios.splice(childIdx + 1, 0, splitRatio)
      return { ...root, children: newChildren, ratios: newRatios }
    }
  }

  // 재귀 탐색
  const newChildren = root.children.map((c) => splitLeaf(c, leafId, direction, newLeaf))
  const anyChanged = newChildren.some((c, i) => c !== root.children[i])
  if (!anyChanged) return root
  return { ...root, children: newChildren }
}

/** splitLeaf 후 마지막 두 자식의 순서를 교환 (left/top 드롭용) */
export function swapLastTwo(root: PaneNode, idA: string, idB: string): PaneNode {
  if (root.type === 'leaf') return root
  const branch = root as PaneBranch
  const idxA = branch.children.findIndex((c) => c.id === idA)
  const idxB = branch.children.findIndex((c) => c.id === idB)
  if (idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) === 1) {
    const newChildren = [...branch.children]
    const newRatios = [...branch.ratios];
    [newChildren[idxA], newChildren[idxB]] = [newChildren[idxB], newChildren[idxA]];
    [newRatios[idxA], newRatios[idxB]] = [newRatios[idxB], newRatios[idxA]]
    return { ...branch, children: newChildren, ratios: newRatios }
  }
  const newChildren = branch.children.map((c) => swapLastTwo(c, idA, idB))
  const anyChanged = newChildren.some((c, i) => c !== branch.children[i])
  if (!anyChanged) return root
  return { ...branch, children: newChildren }
}

/* ────────── 정리 ────────── */

/** 존재하지 않는 세션을 트리에서 제거하고, 빈 브랜치를 정리 */
export function pruneInvalidSessions(root: PaneNode, validIds: Set<string>): PaneNode | null {
  if (root.type === 'leaf') {
    return validIds.has(root.sessionId) ? root : null
  }
  const newChildren: PaneNode[] = []
  const newRatios: number[] = []
  for (let i = 0; i < root.children.length; i++) {
    const result = pruneInvalidSessions(root.children[i], validIds)
    if (result) {
      newChildren.push(result)
      newRatios.push(root.ratios[i])
    }
  }
  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0]
  const total = newRatios.reduce((a, b) => a + b, 0)
  return { ...root, children: newChildren, ratios: newRatios.map((r) => r / total) }
}
