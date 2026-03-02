import { useState, useMemo } from 'react'
import type { ChatToolUseBlock } from '../../../shared/types'
import { useSpinner } from '../hooks/useSpinner'
import { TOOL_CHARS } from '../spinners'

/** Tool name → short summary extractor */
function getToolSummary(name: string, input: string | Record<string, unknown>): string {
  const obj = typeof input === 'string' ? null : input
  if (!obj) return ''

  switch (name) {
    case 'Read':
      return String(obj.file_path || '').split('/').pop() || ''
    case 'Edit':
    case 'Write':
      return String(obj.file_path || '').split('/').pop() || ''
    case 'Bash':
      return String(obj.command || '').slice(0, 60)
    case 'Grep':
      return String(obj.pattern || '')
    case 'Glob':
      return String(obj.pattern || '')
    case 'WebFetch':
    case 'WebSearch':
      return String(obj.url || obj.query || '').slice(0, 50)
    case 'Task':
      return String(obj.description || '').slice(0, 50)
    default:
      return ''
  }
}

/** tool_result 내용 요약 (최대 80자) */
function summarizeResult(content: string): string {
  const firstLine = content.split('\n')[0] || ''
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine
}

interface ToolUseCardProps {
  block: ChatToolUseBlock
  /** 매칭된 tool_result (있으면 완료 상태) */
  result?: { content: string; is_error?: boolean } | null
  /** 마지막 진행 중인 tool_use 여부 */
  isPending?: boolean
}

export default function ToolUseCard({ block, result, isPending }: ToolUseCardProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const spinnerChar = useSpinner(TOOL_CHARS, 80, !!isPending)

  const summary = useMemo(() => getToolSummary(block.name, block.input), [block.name, block.input])

  const inputStr = useMemo(() => {
    if (typeof block.input === 'string') return block.input
    try {
      return JSON.stringify(block.input, null, 2)
    } catch {
      return String(block.input)
    }
  }, [block.input])

  const isError = result?.is_error
  const isCompleted = !!result && !isPending

  // 상태 아이콘 결정
  let statusIcon: string
  let statusClass: string
  if (isPending) {
    statusIcon = spinnerChar
    statusClass = 'tool-status-pending'
  } else if (isError) {
    statusIcon = '✗'
    statusClass = 'tool-status-error'
  } else if (isCompleted) {
    statusIcon = '✓'
    statusClass = 'tool-status-done'
  } else {
    statusIcon = '✓'
    statusClass = 'tool-status-done'
  }

  return (
    <div className={`tool-block ${isError ? 'tool-block-error' : ''}`}>
      <button className="tool-block-header" onClick={() => setExpanded(!expanded)}>
        <span className={`tool-status-icon ${statusClass}`}>{statusIcon}</span>
        <span className="tool-block-name">{block.name}</span>
        {summary && <span className="tool-block-summary">{summary}</span>}
        {isCompleted && result?.content && !expanded && (
          <span className="tool-result-preview">{summarizeResult(result.content)}</span>
        )}
        <span className={`tool-block-chevron ${expanded ? 'expanded' : ''}`}>▶</span>
      </button>
      {expanded && (
        <div className="tool-block-body">
          <pre className="tool-block-input">{inputStr}</pre>
          {result?.content && (
            <div className="tool-block-result">
              <div className="tool-result-label">{isError ? 'Error' : 'Result'}</div>
              <pre className="tool-result-content">{result.content}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
