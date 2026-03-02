import { useMemo, useRef, useEffect, useState } from 'react'
import type { ChatMessage as ChatMessageType, ChatContentBlock, ChatToolUseBlock, ChatInputRequestBlock, TurnStats } from '../../../shared/types'
import MarkdownRenderer from './MarkdownRenderer'
import ToolUseCard from './ToolUseCard'
import ThinkingBlock from './ThinkingBlock'
import PermissionCard from './PermissionCard'
import QuestionCard from './QuestionCard'
import { useSpinner } from '../hooks/useSpinner'
import { useElapsedTime, formatElapsed } from '../hooks/useElapsedTime'
import { THINKING_CHARS, getRandomVerb } from '../spinners'

interface ChatMessageProps {
  message: ChatMessageType
  /** 메시지 인덱스 (큐 수정/삭제에 사용) */
  messageIndex: number
  /** Permission/Question 응답 콜백 */
  onRespondToInput?: (requestId: string, response: Record<string, unknown>) => void
  /** 큐 메시지 수정 콜백 */
  onEditQueued?: (index: number, newText: string) => void
  /** 큐 메시지 삭제 콜백 */
  onRemoveQueued?: (index: number) => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** 모델명 단축 표시 (claude-sonnet-4-20250514 → sonnet-4) */
function formatModel(model: string): string {
  const m = model.replace('claude-', '').replace(/-\d{8}$/, '')
  return m
}

function StatsBar({ stats }: { stats: TurnStats }): JSX.Element {
  const parts = useMemo(() => {
    const items: string[] = []
    if (stats.model) {
      items.push(formatModel(stats.model))
    }
    if (stats.durationMs != null) {
      items.push(formatDuration(stats.durationMs))
    }
    if (stats.costUsd != null) {
      items.push(formatCost(stats.costUsd))
    }
    if (stats.numTools > 0) {
      items.push(`${stats.numTools} tool${stats.numTools > 1 ? 's' : ''}`)
    }
    return items
  }, [stats])

  if (parts.length === 0) return <></>

  return (
    <div className="turn-stats">
      {parts.map((p, i) => (
        <span key={i} className="turn-stats-item">
          {i > 0 && <span className="turn-stats-dot">·</span>}
          {p}
        </span>
      ))}
    </div>
  )
}

/** Thinking 스피너 — Claude Code 스타일 (✢ Reasoning... 5s) */
function ThinkingSpinner({ elapsed }: { elapsed: number }): JSX.Element {
  const char = useSpinner(THINKING_CHARS, 333, true)
  const verbRef = useRef(getRandomVerb())

  // 5초마다 동사 변경
  useEffect(() => {
    const interval = setInterval(() => {
      verbRef.current = getRandomVerb()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="cc-thinking-spinner">
      <span className="cc-thinking-char">{char}</span>
      <span className="cc-thinking-verb">{verbRef.current}…</span>
      {elapsed >= 1000 && (
        <span className="cc-thinking-elapsed">{formatElapsed(elapsed)}</span>
      )}
    </div>
  )
}

/** 스트리밍 중 실시간 경과 시간 표시 바 */
function StreamingStatsBar({ elapsed, toolCount }: { elapsed: number; toolCount: number }): JSX.Element {
  const parts: string[] = []
  if (elapsed >= 1000) parts.push(formatElapsed(elapsed))
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''}`)

  if (parts.length === 0) return <></>

  return (
    <div className="turn-stats turn-stats-live">
      {parts.map((p, i) => (
        <span key={i} className="turn-stats-item">
          {i > 0 && <span className="turn-stats-dot">·</span>}
          {p}
        </span>
      ))}
    </div>
  )
}

/** tool_use 블록 뒤에 매칭되는 tool_result가 있는지 확인 */
function findToolResult(blocks: ChatContentBlock[], toolUseId: string): { content: string; is_error?: boolean } | null {
  for (const b of blocks) {
    if (b.type === 'tool_result' && b.tool_use_id === toolUseId) {
      return { content: b.content, is_error: b.is_error }
    }
  }
  return null
}

/** 마지막 tool_use가 아직 result 없이 진행 중인지 */
function isLastPendingTool(blocks: ChatContentBlock[], index: number, block: ChatContentBlock): boolean {
  if (block.type !== 'tool_use') return false
  // 이 tool_use 이후에 같은 id의 tool_result가 없으면 진행 중
  const result = findToolResult(blocks, block.id)
  if (result) return false
  // 이 tool_use가 마지막 tool_use인지 확인
  for (let i = index + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'tool_use') return false
  }
  return true
}

/** 완료된 tool 블록 수가 이 값 이상이면 접기 UI 표시 */
const TOOL_COLLAPSE_THRESHOLD = 3

/** 연속된 완료 tool 블록 그룹 — 접기/펼치기 지원 */
interface ToolGroupItem {
  block: ChatToolUseBlock
  result: { content: string; is_error?: boolean } | null
  originalIndex: number
}

function CollapsedToolGroup({ tools }: { tools: ToolGroupItem[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  // 도구별 횟수 집계 (HUD 스타일: ✓ Read ×3 · ✓ Edit ×2)
  const summary = useMemo(() => {
    const counts = new Map<string, number>()
    let errors = 0
    for (const t of tools) {
      counts.set(t.block.name, (counts.get(t.block.name) || 0) + 1)
      if (t.result?.is_error) errors++
    }
    return { counts, errors }
  }, [tools])

  if (expanded) {
    return (
      <div className="tool-group">
        <button className="tool-group-toggle" onClick={() => setExpanded(false)}>
          <span className="tool-group-chevron expanded">▶</span>
          <span className="tool-group-label">
            ✓ {tools.length} tools
          </span>
        </button>
        {tools.map(({ block, result }) => (
          <ToolUseCard
            key={block.id}
            block={block}
            result={result}
            isPending={false}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="tool-group">
      <button className="tool-group-toggle" onClick={() => setExpanded(true)}>
        <span className="tool-group-chevron">▶</span>
        <span className="tool-group-label">
          {summary.errors > 0 ? '✗' : '✓'} {tools.length} tools
        </span>
        <span className="tool-group-summary">
          {Array.from(summary.counts.entries()).map(([name, count], i) => (
            <span key={name} className="tool-group-item">
              {i > 0 && <span className="tool-group-dot">·</span>}
              <span className="tool-group-name">{name}</span>
              {count > 1 && <span className="tool-group-count">×{count}</span>}
            </span>
          ))}
        </span>
      </button>
    </div>
  )
}

/**
 * 블록 목록을 렌더링 세그먼트로 분할:
 * - thinking, text → 그대로 렌더
 * - 연속된 완료 tool_use → ToolGroup으로 묶기 (threshold 이상일 때)
 * - 진행 중(pending) tool_use → 항상 개별 표시
 * - tool_result → ToolUseCard에서 처리하므로 스킵
 */
type Segment =
  | { kind: 'block'; block: ChatContentBlock; index: number }
  | { kind: 'tool-group'; tools: ToolGroupItem[] }

function buildSegments(blocks: ChatContentBlock[], isStreaming: boolean): Segment[] {
  const segments: Segment[] = []
  let pendingToolGroup: ToolGroupItem[] = []

  const flushToolGroup = (): void => {
    if (pendingToolGroup.length === 0) return
    if (pendingToolGroup.length >= TOOL_COLLAPSE_THRESHOLD) {
      segments.push({ kind: 'tool-group', tools: pendingToolGroup })
    } else {
      // threshold 미만이면 개별 표시
      for (const t of pendingToolGroup) {
        segments.push({ kind: 'block', block: t.block, index: t.originalIndex })
      }
    }
    pendingToolGroup = []
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'tool_result') continue // ToolUseCard에서 처리

    if (block.type === 'tool_use') {
      const result = findToolResult(blocks, block.id)
      const isPending = isStreaming && isLastPendingTool(blocks, i, block)

      if (isPending) {
        // 진행 중인 tool은 항상 개별 표시
        flushToolGroup()
        segments.push({ kind: 'block', block, index: i })
      } else {
        // 완료된 tool → 그룹 후보에 추가
        pendingToolGroup.push({ block, result, originalIndex: i })
      }
    } else {
      // text, thinking 등 → 그룹 끊고 개별 표시
      flushToolGroup()
      segments.push({ kind: 'block', block, index: i })
    }
  }

  flushToolGroup()
  return segments
}

export default function ChatMessage({ message, messageIndex, onRespondToInput, onEditQueued, onRemoveQueued }: ChatMessageProps): JSX.Element {
  const elapsed = useElapsedTime(!!message.isStreaming)

  if (message.role === 'user') {
    return (
      <div className={`chat-turn chat-turn-human ${message.queued ? 'chat-turn-queued' : ''}`}>
        <div className="chat-human-line">
          <span className="chat-prompt-marker">{message.queued ? '·' : '❯'}</span>
          <span className="chat-human-text">{message.text || ''}</span>
          {message.queued && <span className="chat-queued-label">queued</span>}
        </div>
      </div>
    )
  }

  const blocks = message.blocks || []
  const hasVisibleContent = blocks.some(b => b.type === 'text' || b.type === 'tool_use')
  const isThinking = message.isStreaming && !hasVisibleContent
  const liveToolCount = blocks.filter(b => b.type === 'tool_use').length

  const segments = useMemo(
    () => buildSegments(blocks, !!message.isStreaming),
    [blocks, message.isStreaming]
  )

  return (
    <div className="chat-turn chat-turn-assistant">
      <div className="chat-assistant-body">
        {isThinking && <ThinkingSpinner elapsed={elapsed} />}
        {segments.map((seg, si) => {
          if (seg.kind === 'tool-group') {
            return <CollapsedToolGroup key={`tg-${si}`} tools={seg.tools} />
          }
          const { block, index: i } = seg
          if (block.type === 'thinking') {
            return <ThinkingBlock key={i} content={block.thinking} />
          }
          if (block.type === 'text') {
            return <MarkdownRenderer key={i} content={block.text} />
          }
          if (block.type === 'tool_use') {
            const result = findToolResult(blocks, block.id)
            const isPending = message.isStreaming && isLastPendingTool(blocks, i, block)
            return (
              <ToolUseCard
                key={block.id || i}
                block={block}
                result={result}
                isPending={isPending}
              />
            )
          }
          if (block.type === 'input_request') {
            const irBlock = block as ChatInputRequestBlock
            const handleRespond = (response: Record<string, unknown>): void => {
              onRespondToInput?.(irBlock.request.requestId, response)
            }
            if (irBlock.request.type === 'permission') {
              return (
                <PermissionCard
                  key={`perm-${irBlock.request.requestId}`}
                  request={irBlock.request}
                  answered={irBlock.answered}
                  responseLabel={irBlock.responseLabel}
                  onRespond={handleRespond}
                />
              )
            }
            return (
              <QuestionCard
                key={`q-${irBlock.request.requestId}`}
                request={irBlock.request}
                answered={irBlock.answered}
                responseLabel={irBlock.responseLabel}
                onRespond={handleRespond}
              />
            )
          }
          return null
        })}
        {message.isStreaming && hasVisibleContent && <span className="streaming-cursor" />}
        {message.cancelled && <span className="cancelled-label">interrupted</span>}
      </div>
      {/* 스트리밍 중: 실시간 경과 시간 + tool 수 */}
      {message.isStreaming && <StreamingStatsBar elapsed={elapsed} toolCount={liveToolCount} />}
      {/* 완료 후: 최종 통계 (모델, 시간, 비용, tool 수) */}
      {!message.isStreaming && message.turnStats && (
        <StatsBar stats={message.turnStats} />
      )}
    </div>
  )
}
