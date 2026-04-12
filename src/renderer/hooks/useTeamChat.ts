/**
 * useTeamChat — 팀 채팅방 상태 및 메시지 관리
 *
 * 팀 목록, 그룹 채팅 메시지, 순차 오케스트레이션 상태를 관리하고
 * IPC 리스너를 통해 main process와 통신합니다.
 *
 * useCowrkAgents와 동일한 패턴:
 * - 초기 로드 → IPC 리스너 → 상태 업데이트
 * - 스트리밍 청크 수신 → 메시지 누적 → 완료 처리
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TeamState, TeamChatMessage } from '../../shared/types'

export interface UseTeamChatReturn {
  /** 팀 목록 */
  teams: TeamState[]
  /** 팀별 채팅 메시지 */
  teamChatMessages: Record<string, TeamChatMessage[]>
  /** 현재 열린 팀 채팅 이름 */
  activeTeam: string | null
  /** 팀 생성 다이얼로그 표시 여부 */
  isCreatingTeam: boolean
  /** 팀 생성 */
  createTeam: (name: string, members: string[]) => Promise<void>
  /** 팀 삭제 */
  deleteTeam: (name: string) => Promise<void>
  /** 팀에게 질문 */
  askTeam: (message: string, projectDir?: string) => void
  /** 오케스트레이션 취소 */
  cancelTeam: () => void
  /** 팀 채팅 열기 */
  openTeamChat: (name: string) => void
  /** 팀 채팅 닫기 */
  closeTeamChat: () => void
  /** 팀 생성 다이얼로그 토글 */
  setCreatingTeam: (open: boolean) => void
}

export function useTeamChat(): UseTeamChatReturn {
  const [teams, setTeams] = useState<TeamState[]>([])
  const [teamChatMessages, setTeamChatMessages] = useState<Record<string, TeamChatMessage[]>>({})
  const [activeTeam, setActiveTeam] = useState<string | null>(null)
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  const activeTeamRef = useRef(activeTeam)
  activeTeamRef.current = activeTeam

  // 초기 로드
  useEffect(() => {
    window.api.teamList().then(setTeams).catch(() => {})
  }, [])

  // IPC 리스너 등록
  useEffect(() => {
    // 에이전트 턴 시작: composing 상태 표시
    const unsubStart = window.api.onTeamAgentStart((teamName, agentName, index, total) => {
      setTeams(prev => prev.map(t =>
        t.name === teamName
          ? { ...t, status: 'running' as const, currentAgent: agentName, completedCount: index }
          : t
      ))
    })

    // 스트림 청크: 에이전트별 메시지에 추가
    const unsubChunk = window.api.onTeamStreamChunk((teamName, agentName, chunk) => {
      setTeamChatMessages(prev => {
        const msgs = prev[teamName] || []
        const last = msgs[msgs.length - 1]

        if (last && last.role === 'agent' && last.agentName === agentName && last.isStreaming) {
          // 기존 스트리밍 메시지에 추가
          const updated = [...msgs]
          updated[updated.length - 1] = { ...last, content: last.content + chunk }
          return { ...prev, [teamName]: updated }
        }

        // 새 에이전트 메시지 시작
        return {
          ...prev,
          [teamName]: [...msgs, {
            role: 'agent',
            agentName,
            content: chunk,
            timestamp: Date.now(),
            isStreaming: true,
          }],
        }
      })

      // 팀 상태 → running, currentAgent 업데이트
      setTeams(prev => prev.map(t =>
        t.name === teamName ? { ...t, status: 'running' as const, currentAgent: agentName } : t
      ))
    })

    // 개별 에이전트 턴 완료
    const unsubAgentComplete = window.api.onTeamAgentComplete((teamName, agentName, response) => {
      setTeamChatMessages(prev => {
        const msgs = prev[teamName] || []
        const last = msgs[msgs.length - 1]

        if (last && last.role === 'agent' && last.agentName === agentName && last.isStreaming) {
          const updated = [...msgs]
          updated[updated.length - 1] = {
            ...last,
            content: response || last.content,
            isStreaming: false,
          }
          return { ...prev, [teamName]: updated }
        }

        // 스트리밍 없이 완료 (짧은 응답)
        if (response) {
          return {
            ...prev,
            [teamName]: [...msgs, {
              role: 'agent',
              agentName,
              content: response,
              timestamp: Date.now(),
              isStreaming: false,
            }],
          }
        }

        return prev
      })

      // completedCount 업데이트
      setTeams(prev => prev.map(t =>
        t.name === teamName ? { ...t, completedCount: (t.completedCount || 0) + 1 } : t
      ))
    })

    // 시퀀스 전체 완료
    const unsubSequenceComplete = window.api.onTeamSequenceComplete((teamName) => {
      setTeams(prev => prev.map(t =>
        t.name === teamName
          ? { ...t, status: 'idle' as const, currentAgent: undefined, completedCount: undefined }
          : t
      ))
    })

    // 에러 발생
    const unsubError = window.api.onTeamError((teamName, agentName, error) => {
      setTeamChatMessages(prev => {
        const msgs = prev[teamName] || []
        const last = msgs[msgs.length - 1]

        if (last && last.role === 'agent' && last.isStreaming) {
          const updated = [...msgs]
          updated[updated.length - 1] = {
            ...last,
            content: last.content + `\n\n[Error: ${error}]`,
            isStreaming: false,
          }
          return { ...prev, [teamName]: updated }
        }

        return {
          ...prev,
          [teamName]: [...msgs, {
            role: 'agent',
            agentName: agentName || undefined,
            content: `[Error: ${error}]`,
            timestamp: Date.now(),
            isStreaming: false,
          }],
        }
      })

      setTeams(prev => prev.map(t =>
        t.name === teamName
          ? { ...t, status: 'error' as const, currentAgent: undefined, completedCount: undefined }
          : t
      ))
    })

    return () => {
      unsubStart()
      unsubChunk()
      unsubAgentComplete()
      unsubSequenceComplete()
      unsubError()
    }
  }, [])

  const createTeam = useCallback(async (name: string, members: string[]) => {
    const team = await window.api.teamCreate(name, members)
    setTeams(prev => [...prev, team])
    setIsCreatingTeam(false)
  }, [])

  const deleteTeam = useCallback(async (name: string) => {
    await window.api.teamDelete(name)
    setTeams(prev => prev.filter(t => t.name !== name))
    setTeamChatMessages(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    if (activeTeamRef.current === name) {
      setActiveTeam(null)
    }
  }, [])

  const askTeam = useCallback((message: string, projectDir?: string) => {
    const name = activeTeamRef.current
    if (!name) return

    // 사용자 메시지 추가
    setTeamChatMessages(prev => ({
      ...prev,
      [name]: [...(prev[name] || []), {
        role: 'user',
        content: message,
        timestamp: Date.now(),
      }],
    }))

    // 즉시 running 상태 전환
    setTeams(prev => prev.map(t =>
      t.name === name ? { ...t, status: 'running' as const, completedCount: 0 } : t
    ))

    window.api.teamAsk(name, message, projectDir)
  }, [])

  const cancelTeam = useCallback(() => {
    const name = activeTeamRef.current
    if (!name) return
    window.api.teamCancel(name)

    setTeams(prev => prev.map(t =>
      t.name === name
        ? { ...t, status: 'cancelled' as const, currentAgent: undefined }
        : t
    ))
  }, [])

  const loadHistory = useCallback((name: string, messages: TeamChatMessage[]) => {
    setTeamChatMessages(prev => {
      if (prev[name] && prev[name].length > 0) return prev
      return { ...prev, [name]: messages }
    })
  }, [])

  const openTeamChat = useCallback((name: string) => {
    setActiveTeam(name)
  }, [])

  const closeTeamChat = useCallback(() => {
    setActiveTeam(null)
  }, [])

  return {
    teams,
    teamChatMessages,
    activeTeam,
    isCreatingTeam,
    createTeam,
    deleteTeam,
    askTeam,
    loadHistory,
    cancelTeam,
    openTeamChat,
    closeTeamChat,
    setCreatingTeam: setIsCreatingTeam,
  }
}
