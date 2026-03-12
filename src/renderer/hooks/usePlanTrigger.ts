/**
 * usePlanTrigger — 터미널 출력에서 플랜 파일 경로 감지 → Plan 패널 자동 열기
 *
 * usePreviewTrigger 패턴을 따릅니다.
 * PTY 출력에서 ".claude/plans/*.md" 경로를 감지하면
 * 해당 세션의 Plan 패널을 자동으로 엽니다.
 */

import { useCallback, useEffect, useRef } from 'react'
import { stripAnsi } from '../pty-parser'

/** 플랜 파일 경로 추출 패턴 */
const PLAN_FILE_PATTERN = /\.claude\/plans\/([\w-]+\.md)/

interface UsePlanTriggerParams {
  openPlan: (sessionId: string, filePath: string) => void
  planSessionsRef: React.MutableRefObject<Set<string>>
}

interface UsePlanTriggerReturn {
  notifyClose: (sessionId: string) => void
}

export function usePlanTrigger({
  openPlan,
  planSessionsRef
}: UsePlanTriggerParams): UsePlanTriggerReturn {
  const buffers = useRef<Record<string, string>>({})
  const cooldowns = useRef<Record<string, number>>({})
  // 앱 시작 후 10초간 트리거 억제 — tmux 세션 복원 시 이전 출력 재전송 방지
  const globalCooldownRef = useRef(Date.now() + 10_000)
  const openRef = useRef(openPlan)
  openRef.current = openPlan

  const notifyClose = useCallback((sessionId: string) => {
    buffers.current[sessionId] = ''
    cooldowns.current[sessionId] = Date.now()
  }, [])

  useEffect(() => {
    const cleanup = window.api.onSessionData((sessionId: string, rawData: string) => {
      // 이미 플랜 패널이 열려있으면 스킵
      if (planSessionsRef.current.has(sessionId)) return

      const now = Date.now()
      if (now < globalCooldownRef.current) return
      if (cooldowns.current[sessionId] && now - cooldowns.current[sessionId] < 10000) return

      const cleaned = stripAnsi(rawData)
      const buf = ((buffers.current[sessionId] || '') + cleaned).slice(-500)
      buffers.current[sessionId] = buf

      // .claude/plans/*.md 경로 감지
      const match = buf.match(PLAN_FILE_PATTERN)
      if (!match) return

      const fileName = match[1]

      cooldowns.current[sessionId] = now
      buffers.current[sessionId] = ''

      // 메인 프로세스에서 실제 파일 경로 해석 (홈/프로젝트 양쪽 검색)
      window.api.resolvePlanPath(sessionId, fileName).then(filePath => {
        openRef.current(sessionId, filePath)
      }).catch(() => {})
    })

    return cleanup
  }, [planSessionsRef])

  return { notifyClose }
}
