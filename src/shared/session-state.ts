/**
 * session-state — 세션 상태 전이 규칙 (순수 함수 모듈)
 *
 * React 의존성 없음. 세션별 통합 메타데이터와 상태 전이 로직을 정의합니다.
 *
 * source 우선순위: hook > pty
 *   - hook이 설정한 비확정 상태(thinking/tool/agent/permission)는 pty가 덮을 수 없음
 *   - pty의 확정 상태(idle/shell/exited)만 hook을 덮을 수 있음
 *   - starting 상태는 첫 PTY 데이터 도착 시 자동 전환
 *
 * idle 타이머 규칙:
 *   - starting 상태에서는 idle 타이머 비활성
 *   - claudeActivated=false 일 때도 idle 전환 억제
 */

import type { SessionStatus } from './types'

/** 세션별 통합 메타데이터 */
export interface SessionMeta {
  /** 현재 상태 */
  status: SessionStatus
  /** 마지막 상태 소스 (hook이 pty보다 우선) */
  source: 'hook' | 'pty'
  /** Claude 프롬프트(>) 한 번이라도 감지됨 — shell 오판 방지 */
  claudeActivated: boolean
  /** 한 번이라도 프롬프트 제출됨 — idle 라벨 구분 ("완료" vs "") */
  hasWorked: boolean
  /** 복원 세션 여부 */
  restored: boolean
  /** subtitle이 Hook에서 마지막으로 설정되었는지 여부 (소유권 판단) */
  lastSubtitleFromHook: boolean
}

/** 초기 메타 생성 */
export function createSessionMeta(restored: boolean): SessionMeta {
  return {
    status: { state: 'starting', label: '' },
    source: 'pty',
    claudeActivated: false,
    hasWorked: false,
    restored,
    lastSubtitleFromHook: false
  }
}

/** PTY의 확정 상태 — hook을 덮어쓸 수 있는 상태 */
const DEFINITIVE_STATES = new Set(['idle', 'shell', 'exited'])

/**
 * 상태 전이 규칙 (핵심 로직)
 *
 * @returns 새 SessionMeta (변경됨) 또는 null (변경 없음 = 무시)
 */
export function resolveStatus(
  current: SessionMeta,
  next: SessionStatus,
  source: 'hook' | 'pty'
): SessionMeta | null {
  // 같은 상태+라벨 중복 방지
  if (current.status.state === next.state && current.status.label === next.label) {
    return null
  }

  // exited는 항상 허용
  if (next.state === 'exited') {
    return { ...current, status: next, source }
  }

  // hook 소스 보호: PTY는 확정 상태(idle/shell/exited)로만 hook을 덮어쓸 수 있음
  if (current.source === 'hook' && source === 'pty') {
    if (!DEFINITIVE_STATES.has(next.state)) {
      return null
    }
    // 같은 상태면 hook 라벨 보존 (예: hook의 "완료" 라벨이 PTY의 빈 문자열로 덮어쓰이는 것 방지)
    if (current.status.state === next.state) {
      return null
    }
  }

  return { ...current, status: next, source }
}

/** claudeActivated 갱신 */
export function activateClaude(meta: SessionMeta): SessionMeta {
  if (meta.claudeActivated) return meta
  return { ...meta, claudeActivated: true }
}

/** hasWorked 갱신 */
export function markWorked(meta: SessionMeta): SessionMeta {
  if (meta.hasWorked) return meta
  return { ...meta, hasWorked: true }
}
