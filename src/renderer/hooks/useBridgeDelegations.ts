/**
 * useBridgeDelegations — 세션 브릿지 위임 상태 관리
 *
 * main의 bridge:delegation 이벤트를 수신해:
 *   - started: 대상 세션 패인을 요청 세션 옆에 자동 표시 (두 패인 동시 표시)
 *              + 요청 세션에 위임 중 배지 상태 기록
 *   - done/error: 배지 해제 (표시된 패인은 유지 — 사용자가 결과를 볼 수 있게)
 *
 * 배지는 요청자가 실제 mulaude 세션일 때만 표시합니다
 * (외부 셸에서 CLI를 직접 쓴 경우 fromSessionId가 세션이 아닐 수 있음).
 */

import { useState, useEffect } from 'react'

export interface ActiveDelegation {
  /** 위임 대상 세션 ID */
  toSessionId: string
}

interface UseBridgeDelegationsParams {
  /** 대상 세션을 기준 세션 옆에 분할 표시 */
  ensureSessionBeside: (sessionId: string, besideSessionId: string) => void
  /** 실제 존재하는 세션인지 확인 (배지 표시 여부) */
  isKnownSession: (sessionId: string) => boolean
}

export function useBridgeDelegations({
  ensureSessionBeside,
  isKnownSession
}: UseBridgeDelegationsParams): Record<string, ActiveDelegation> {
  const [delegations, setDelegations] = useState<Record<string, ActiveDelegation>>({})

  useEffect(() => {
    const cleanup = window.api.onBridgeDelegation((info) => {
      if (info.status === 'started') {
        ensureSessionBeside(info.toSessionId, info.fromSessionId)
        if (isKnownSession(info.fromSessionId)) {
          setDelegations((prev) => ({
            ...prev,
            [info.fromSessionId]: { toSessionId: info.toSessionId }
          }))
        }
        return
      }
      // done | error → 배지 해제
      setDelegations((prev) => {
        if (!prev[info.fromSessionId]) return prev
        const next = { ...prev }
        delete next[info.fromSessionId]
        return next
      })
    })
    return cleanup
  }, [ensureSessionBeside, isKnownSession])

  return delegations
}
