/**
 * usePreviewTrigger — 터미널 출력에서 트리거 키워드 감지 → Preview 자동 열기
 *
 * "미리보기 실행", "프론트엔드 실행", "백엔드 실행", "dev server",
 * "npm run dev", "localhost:" 등을 감지하면 해당 세션의 Preview를 URL 모드로 엽니다.
 */

import { useCallback, useEffect, useRef } from 'react'
import { stripAnsi } from '../pty-parser'

/**
 * 트리거 패턴: 매칭 시 preview 열기 + 추출할 URL/포트
 *
 * ⚠️ extract 없는 "keyword" 패턴은 단독으로 트리거하지 않습니다.
 *    Claude 텍스트 응답에서 "서버 실행", "dev server started" 등의
 *    오탐(false positive)을 방지하기 위해, URL/포트가 버퍼에 함께
 *    존재할 때만 트리거됩니다. (아래 매칭 로직 참조)
 */
const TRIGGER_PATTERNS: { pattern: RegExp; extract?: 'url' | 'port' | 'keyword' }[] = [
  // URL/포트 감지 (단독 트리거 — 신뢰도 높음)
  { pattern: /https?:\/\/localhost:\d+/i, extract: 'url' },
  { pattern: /https?:\/\/127\.0\.0\.1:\d+/i, extract: 'url' },
  { pattern: /https?:\/\/0\.0\.0\.0:\d+/i, extract: 'url' },
  { pattern: /(?:listening|running|ready|started)\s+(?:on|at)\s+(?:port\s+)?(\d{3,5})/i, extract: 'port' },
  // dev tool 출력 (단독 트리거)
  { pattern: /Local:\s+https?:\/\/localhost:\d+/i, extract: 'url' },
  { pattern: /Network:\s+https?:\/\/[\d.]+:\d+/i, extract: 'url' },
  { pattern: /➜\s+Local:\s+https?:\/\//i, extract: 'url' },
  // 키워드 (URL/포트가 버퍼에 함께 있어야만 트리거)
  { pattern: /미리보기\s*실행/i, extract: 'keyword' },
  { pattern: /프론트엔드\s*실행/i, extract: 'keyword' },
  { pattern: /백엔드\s*실행/i, extract: 'keyword' },
  { pattern: /프리뷰\s*실행/i, extract: 'keyword' },
  { pattern: /서버\s*실행/i, extract: 'keyword' },
  { pattern: /(?:preview|frontend|backend)\s*(?:run|start|launch|실행)/i, extract: 'keyword' },
  { pattern: /(?:run|start|launch)\s*(?:preview|frontend|backend)/i, extract: 'keyword' },
  { pattern: /dev\s*server\s*(?:started|running|ready)/i, extract: 'keyword' },
]

/** URL 추출 — 포트 번호까지만 (경로/쿼리 없이 깔끔하게) */
function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/)
  if (urlMatch) return urlMatch[0]
  return null
}

function extractPort(text: string): number | null {
  const portMatch = text.match(/(?:listening|running|ready|started)\s+(?:on|at)\s+(?:port\s+)?(\d{3,5})/i)
  if (portMatch) return parseInt(portMatch[1], 10)
  return null
}

interface UsePreviewTriggerParams {
  openPreviewWithUrl: (sessionId: string, url: string | null) => void
  /** ref로 최신 Set 참조 (stale closure 방지) */
  previewSessionsRef: React.MutableRefObject<Set<string>>
}

interface UsePreviewTriggerReturn {
  /** Preview 닫을 때 호출 — 버퍼 초기화 + 쿨다운 설정으로 즉시 재트리거 방지 */
  notifyClose: (sessionId: string) => void
}

export function usePreviewTrigger({
  openPreviewWithUrl,
  previewSessionsRef
}: UsePreviewTriggerParams): UsePreviewTriggerReturn {
  const buffers = useRef<Record<string, string>>({})
  const cooldowns = useRef<Record<string, number>>({})
  // 앱 시작 후 10초간 트리거 억제 — tmux 세션 복원 시 이전 출력 재전송 방지
  const globalCooldownRef = useRef(Date.now() + 10_000)
  const openRef = useRef(openPreviewWithUrl)
  openRef.current = openPreviewWithUrl

  const notifyClose = useCallback((sessionId: string) => {
    buffers.current[sessionId] = ''
    cooldowns.current[sessionId] = Date.now()
  }, [])

  useEffect(() => {
    const cleanup = window.api.onSessionData((sessionId: string, rawData: string) => {
      // ref에서 최신 상태 읽기 (stale closure 안전)
      if (previewSessionsRef.current.has(sessionId)) return

      const now = Date.now()
      // 앱 시작 직후 tmux 출력 재전송 무시
      if (now < globalCooldownRef.current) return
      if (cooldowns.current[sessionId] && now - cooldowns.current[sessionId] < 10000) return

      const cleaned = stripAnsi(rawData)
      const buf = ((buffers.current[sessionId] || '') + cleaned).slice(-500)
      buffers.current[sessionId] = buf

      for (const trigger of TRIGGER_PATTERNS) {
        if (!trigger.pattern.test(buf)) continue

        let detectedUrl: string | null = null
        if (trigger.extract === 'url') {
          detectedUrl = extractUrl(buf)
        } else if (trigger.extract === 'port') {
          const port = extractPort(buf)
          if (port) detectedUrl = `http://localhost:${port}`
        } else {
          // keyword 패턴: 버퍼에 URL 또는 포트가 함께 있어야만 트리거
          detectedUrl = extractUrl(buf)
          if (!detectedUrl) {
            const port = extractPort(buf)
            if (port) detectedUrl = `http://localhost:${port}`
          }
          if (!detectedUrl) continue // URL 없으면 스킵 → 오탐 방지
        }

        cooldowns.current[sessionId] = now
        buffers.current[sessionId] = ''
        openRef.current(sessionId, detectedUrl)
        break
      }
    })

    return cleanup
  }, [previewSessionsRef]) // ref는 안정적이므로 dependency 최소화

  return { notifyClose }
}
