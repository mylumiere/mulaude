/**
 * useSessionAgents - 팀 에이전트 목록 관리
 *
 * team config 폴링(session:team-agents)에서 에이전트 목록을 수신하고,
 * tmux pane 폴링(session:panes)에서 에이전트 활동 정보를 보강합니다.
 */

import { useState, useEffect, useRef } from 'react'
import type { AgentInfo, TmuxPaneInfo } from '../../shared/types'
import { extractPaneActivity } from '../pty-parser'

interface UseSessionAgentsReturn {
  sessionAgents: Record<string, AgentInfo[]>
  /** 에이전트 상태 설정 함수 (hook 모듈에서 Stop 시 초기화용) */
  setSessionAgents: React.Dispatch<React.SetStateAction<Record<string, AgentInfo[]>>>
  /** 최신 에이전트 목록 동기 참조 (hook 핸들러에서 사용) */
  sessionAgentsRef: React.MutableRefObject<Record<string, AgentInfo[]>>
  /** 세션 삭제 시 에이전트 상태 정리 */
  cleanupAgentState: (id: string) => void
}

export function useSessionAgents(): UseSessionAgentsReturn {
  const [sessionAgents, setSessionAgents] = useState<Record<string, AgentInfo[]>>({})
  const sessionAgentsRef = useRef(sessionAgents)
  sessionAgentsRef.current = sessionAgents

  const cleanupAgentState = (id: string): void => {
    setSessionAgents((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // ── Team config 기반 에이전트-pane 확정 매칭 (유일한 에이전트 소스) ──
  useEffect(() => {
    return window.api.onSessionTeamAgents((id: string, teamAgents: AgentInfo[]) => {
      setSessionAgents((prev) => {
        const existing = prev[id] || []

        // team config 에이전트를 기반으로, 기존 에이전트의 detail 보존
        const merged = teamAgents.map((ta) => {
          const match = existing.find((e) => e.name === ta.name)
          return {
            ...ta,
            detail: match?.detail ?? ta.detail
          }
        })

        // 변경 없으면 이전 참조 유지
        if (
          merged.length === existing.length &&
          merged.every((m, i) =>
            existing[i] &&
            m.name === existing[i].name &&
            m.paneIndex === existing[i].paneIndex &&
            m.status === existing[i].status &&
            m.detail === existing[i].detail
          )
        ) {
          return prev
        }

        return { ...prev, [id]: merged }
      })
    })
  }, [])

  // ── tmux pane 폴링 → 에이전트 detail 보강 (paneIndex 직접 매칭) ──
  useEffect(() => {
    return window.api.onSessionPanes((id: string, panes: TmuxPaneInfo[]) => {
      setSessionAgents((prev) => {
        const agents = prev[id]
        if (!agents || agents.length === 0) return prev

        let changed = false
        const updated = [...agents]

        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i]
          if (agent.paneIndex === undefined) continue
          const pane = panes.find((p) => p.index === agent.paneIndex)
          if (!pane) continue
          const detail = extractPaneActivity(pane.content)
          if (detail !== agent.detail) {
            changed = true
            updated[i] = { ...agent, detail }
          }
        }

        return changed ? { ...prev, [id]: updated } : prev
      })
    })
  }, [])

  return { sessionAgents, setSessionAgents, sessionAgentsRef, cleanupAgentState }
}
