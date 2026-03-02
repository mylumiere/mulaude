/**
 * PermissionCard — 도구 실행 Permission 승인 UI
 *
 * Claude가 도구(Bash, Edit, Write 등) 실행 전 사용자 승인을 요청할 때 표시됩니다.
 * 도구명과 입력 요약을 보여주고, Allow/Deny 버튼으로 응답합니다.
 *
 * 응답 후에는 카드가 접혀서 결과만 표시됩니다 (✓ Allowed / ✗ Denied).
 */

import { useMemo } from 'react'
import type { NativeInputRequest } from '../../../shared/types'

interface PermissionCardProps {
  request: NativeInputRequest
  answered: boolean
  responseLabel?: string
  onRespond: (response: Record<string, unknown>) => void
}

/** 도구 입력을 한 줄 요약으로 변환 */
function summarizeToolInput(name: string | undefined, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  if (name === 'Bash') return String(input.command || '').slice(0, 120)
  if (name === 'Edit' || name === 'Write' || name === 'Read') return String(input.file_path || '').split('/').pop() || ''
  if (name === 'Grep') return String(input.pattern || '')
  if (name === 'Glob') return String(input.pattern || '')
  if (name === 'WebFetch' || name === 'WebSearch') return String(input.url || input.query || '').slice(0, 80)
  // 기본: 첫 번째 값
  const firstVal = Object.values(input)[0]
  return firstVal ? String(firstVal).slice(0, 80) : ''
}

export default function PermissionCard({ request, answered, responseLabel, onRespond }: PermissionCardProps): JSX.Element {
  const summary = useMemo(
    () => summarizeToolInput(request.toolName, request.toolInput),
    [request.toolName, request.toolInput]
  )

  // 응답 완료 상태: 접힌 카드
  if (answered) {
    const isAllowed = responseLabel?.includes('Allowed')
    return (
      <div className={`permission-card permission-card-answered ${isAllowed ? 'permission-allowed' : 'permission-denied'}`}>
        <span className="permission-answered-icon">{isAllowed ? '✓' : '✗'}</span>
        <span className="permission-answered-tool">{request.toolName || 'Tool'}</span>
        {summary && <span className="permission-answered-summary">{summary}</span>}
        <span className="permission-answered-label">{responseLabel}</span>
      </div>
    )
  }

  // 대기 상태: 전체 카드
  return (
    <div className="permission-card permission-card-pending">
      <div className="permission-header">
        <span className="permission-icon">⚠</span>
        <span className="permission-title">Permission Required</span>
      </div>
      <div className="permission-body">
        <span className="permission-tool-name">{request.toolName || 'Tool'}</span>
        {summary && (
          <div className="permission-tool-summary">{summary}</div>
        )}
      </div>
      <div className="permission-actions">
        <button
          className="permission-btn permission-btn-allow"
          onClick={() => onRespond({ approved: true })}
        >
          Allow
        </button>
        <button
          className="permission-btn permission-btn-deny"
          onClick={() => onRespond({ approved: false })}
        >
          Deny
        </button>
      </div>
    </div>
  )
}
