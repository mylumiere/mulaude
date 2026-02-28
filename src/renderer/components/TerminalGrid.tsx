/**
 * TerminalGrid - 이진 트리 기반 터미널 분할 렌더링 컴포넌트
 *
 * useTerminalLayout 훅의 PaneNode 트리를 재귀적으로 렌더링합니다.
 * - PaneBranch → flex 컨테이너 (direction에 따라 row/column)
 * - PaneLeaf → 터미널 뷰 (에이전트 있으면 terminal-split 포함)
 *
 * 기능:
 * - 포커스 표시 (border glow)
 * - 비활성 패인 디밍 (opacity)
 * - 줌 모드 (포커스된 패인만 전체 표시)
 * - 리사이즈 핸들 (브랜치 자식 사이)
 * - 사이드바 드래그 앤 드롭 수신
 */

import { useCallback, useState } from 'react'
import TerminalView from './TerminalView'
import AgentPanel from './AgentPanel'
import type { SessionInfo, AgentInfo } from '../../shared/types'
import type {
  PaneTreeState,
  PaneNode,
  PaneBranch,
  PaneLeaf,
  DropPosition
} from '../hooks/useTerminalLayout'
import { t, type Locale } from '../i18n'
import './TerminalGrid.css'

interface TerminalGridProps {
  tree: PaneTreeState
  sessions: SessionInfo[]
  isGridMode: boolean
  locale: Locale

  // 세션별 데이터
  getSessionThemeId: (id: string) => string
  contextPercents: Record<string, number>
  sessionAgents: Record<string, AgentInfo[]>
  sessionsWithPanes: Set<string>

  // 에이전트 패인 관련
  childPaneMap: Record<string, Map<number, { title: string; initialContent: string }>>
  focusedPane: Record<string, number | null>
  splitRatios: Record<string, number>
  handleFocusPane: (sessionId: string, paneIndex: number) => void
  handleFocusParent: (sessionId: string) => void
  handleSplitResize: (sessionId: string) => (e: React.MouseEvent) => void

  // 그리드 액션
  onFocusPane: (paneId: string) => void
  onClosePane: () => void
  onResize: (branchId: string, handleIndex: number) => (e: React.MouseEvent) => void
  onDropSession: (sessionId: string, targetPaneId: string, position: DropPosition) => void
  onMovePane: (sourcePaneId: string, targetPaneId: string, position: DropPosition) => void

  /** 중복 세션 알림 메시지 */
  duplicateAlert?: string | null
  /** 튜토리얼 드래그 스텝 — center 드롭 차단 */
  blockCenterDrop?: boolean
}

/** 트리에서 모든 리프의 sessionId 수집 */
function collectSessionIds(node: PaneNode): Set<string> {
  if (node.type === 'leaf') return new Set([node.sessionId])
  const set = new Set<string>()
  for (const child of node.children) {
    for (const id of collectSessionIds(child)) set.add(id)
  }
  return set
}

export default function TerminalGrid({
  tree,
  sessions,
  isGridMode,
  locale,
  getSessionThemeId,
  contextPercents,
  sessionAgents,
  sessionsWithPanes,
  childPaneMap,
  focusedPane,
  splitRatios,
  handleFocusPane,
  handleFocusParent,
  handleSplitResize,
  onFocusPane,
  onClosePane,
  onResize,
  onDropSession,
  onMovePane,
  duplicateAlert,
  blockCenterDrop
}: TerminalGridProps): JSX.Element {
  const [dropTarget, setDropTarget] = useState<{
    paneId: string; position: DropPosition
  } | null>(null)

  const gridSessionIds = collectSessionIds(tree.root)

  const handleDragOver = useCallback((
    e: React.DragEvent,
    paneId: string
  ) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    let position: DropPosition = 'center'
    const edge = 0.25
    if (x < edge) position = 'left'
    else if (x > 1 - edge) position = 'right'
    else if (y < edge) position = 'top'
    else if (y > 1 - edge) position = 'bottom'

    if (blockCenterDrop && position === 'center') position = 'right'
    setDropTarget({ paneId, position })
  }, [blockCenterDrop])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const calcDropPosition = (e: React.DragEvent): DropPosition => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const edge = 0.25
    if (x < edge) return 'left'
    if (x > 1 - edge) return 'right'
    if (y < edge) return 'top'
    if (y > 1 - edge) return 'bottom'
    return 'center'
  }

  const handleDrop = useCallback((
    e: React.DragEvent,
    targetPaneId: string
  ) => {
    e.preventDefault()
    setDropTarget(null)

    let position = calcDropPosition(e)
    if (blockCenterDrop && position === 'center') position = 'right'

    // 패인 드래그 (그리드 내 재배치)
    const sourcePaneId = e.dataTransfer.getData('text/pane-id')
    if (sourcePaneId) {
      onMovePane(sourcePaneId, targetPaneId, position)
      return
    }

    // 세션 드래그 (사이드바에서)
    const sessionId = e.dataTransfer.getData('text/session-id')
    if (!sessionId) return

    onDropSession(sessionId, targetPaneId, position)
  }, [onDropSession, onMovePane, blockCenterDrop])

  /** 리프 렌더링 */
  const renderLeaf = (leaf: PaneLeaf): JSX.Element => {
    const isFocused = tree.focusedPaneId === leaf.id
    const isDimmed = isGridMode && !isFocused && !tree.zoomedPaneId
    const isDropHere = dropTarget?.paneId === leaf.id
    const session = sessions.find((s) => s.id === leaf.sessionId)
    const hasAgentPanes = sessionsWithPanes.has(leaf.sessionId)
    const ratio = splitRatios[leaf.sessionId] ?? 0.35
    const agentFocus = focusedPane[leaf.sessionId] ?? null

    const classes = [
      'terminal-grid-pane',
      isFocused && isGridMode ? 'terminal-grid-pane--focused' : '',
      isDimmed ? 'terminal-grid-pane--dimmed' : '',
      isDropHere ? `terminal-grid-pane--drop-${dropTarget!.position}` : ''
    ].filter(Boolean).join(' ')

    return (
      <div
        className={classes}
        onClick={() => onFocusPane(leaf.id)}
        onDragOver={(e) => handleDragOver(e, leaf.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, leaf.id)}
      >
        {/* 그리드 모드일 때만 패인 헤더 표시 */}
        {isGridMode && (
          <div
            className="terminal-grid-pane-header"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/pane-id', leaf.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <span className="terminal-grid-pane-title">
              {session?.name ?? leaf.sessionId}
            </span>
            <button
              className="terminal-grid-pane-close"
              onClick={(e) => {
                e.stopPropagation()
                onFocusPane(leaf.id)
                onClosePane()
              }}
              title={t(locale, 'grid.closePane')}
            >
              x
            </button>
          </div>
        )}
        <div className="terminal-grid-pane-content">
          {hasAgentPanes ? (
            <div className="terminal-split">
              <div className="terminal-split-parent" style={{ flex: `0 0 ${ratio * 100}%` }}>
                <TerminalView
                  sessionId={leaf.sessionId}
                  isActive={true}
                  themeId={getSessionThemeId(leaf.sessionId)}
                  contextPercent={contextPercents[leaf.sessionId] ?? null}
                  isFocused={agentFocus === null}
                  onFocusTerminal={() => handleFocusParent(leaf.sessionId)}
                />
              </div>
              <div
                className="terminal-split-handle"
                onMouseDown={handleSplitResize(leaf.sessionId)}
              />
              <div className="terminal-split-agents" style={{ flex: 1 }}>
                <AgentPanel
                  sessionId={leaf.sessionId}
                  themeId={getSessionThemeId(leaf.sessionId)}
                  focusedPaneIndex={typeof agentFocus === 'number' ? agentFocus : null}
                  onFocusPane={(paneIndex) => handleFocusPane(leaf.sessionId, paneIndex)}
                  panes={childPaneMap[leaf.sessionId] || new Map()}
                  agents={sessionAgents[leaf.sessionId]}
                />
              </div>
            </div>
          ) : (
            <TerminalView
              sessionId={leaf.sessionId}
              isActive={true}
              themeId={getSessionThemeId(leaf.sessionId)}
              contextPercent={contextPercents[leaf.sessionId] ?? null}
            />
          )}
        </div>
      </div>
    )
  }

  /** 브랜치 렌더링 (재귀) */
  const renderBranch = (branch: PaneBranch): JSX.Element => {
    const isHorizontal = branch.direction === 'horizontal'
    return (
      <div
        className={`terminal-grid-branch terminal-grid-branch--${branch.direction}`}
        data-branch-id={branch.id}
      >
        {branch.children.map((child, i) => (
          <div key={child.id} style={{ display: 'contents' }}>
            <div
              className="terminal-grid-branch-child"
              style={{ flex: branch.ratios[i] }}
            >
              {renderNode(child)}
            </div>
            {/* 리사이즈 핸들 (마지막 자식 제외) */}
            {i < branch.children.length - 1 && (
              <div
                className={`terminal-grid-handle terminal-grid-handle--${isHorizontal ? 'col' : 'row'}`}
                onMouseDown={onResize(branch.id, i)}
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  /** 노드 렌더링 분기 */
  const renderNode = (node: PaneNode): JSX.Element => {
    if (node.type === 'leaf') return renderLeaf(node)
    return renderBranch(node as PaneBranch)
  }

  /** 줌 모드: 포커스된 리프만 전체 표시 */
  const renderZoomed = (): JSX.Element | null => {
    if (!tree.zoomedPaneId) return null
    const findLeaf = (n: PaneNode): PaneLeaf | null => {
      if (n.type === 'leaf') return n.id === tree.zoomedPaneId ? n : null
      for (const c of n.children) {
        const found = findLeaf(c)
        if (found) return found
      }
      return null
    }
    const leaf = findLeaf(tree.root)
    if (!leaf) return null
    return (
      <div className="terminal-grid terminal-grid--zoomed">
        {renderLeaf(leaf)}
      </div>
    )
  }

  return (
    <>
      {tree.zoomedPaneId ? (
        renderZoomed()
      ) : (
        <div className="terminal-grid">
          {renderNode(tree.root)}
        </div>
      )}

      {/* 그리드에 표시되지 않는 세션들을 숨겨서 마운트 유지 */}
      <div className="terminal-grid-hidden">
        {sessions
          .filter((s) => !gridSessionIds.has(s.id))
          .map((session) => (
            <div key={session.id} className="terminal-wrapper" style={{ display: 'none' }}>
              <TerminalView
                sessionId={session.id}
                isActive={false}
                themeId={getSessionThemeId(session.id)}
                contextPercent={contextPercents[session.id] ?? null}
              />
            </div>
          ))
        }
      </div>

      {/* 중복 세션 알림 토스트 */}
      {duplicateAlert && (
        <div className="terminal-grid-toast">
          {t(locale, 'grid.duplicateSession')}
        </div>
      )}
    </>
  )
}
