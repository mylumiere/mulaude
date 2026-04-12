/**
 * useCowrkAgents — Cowrk 에이전트 상태 및 채팅 메시지 관리
 *
 * 에이전트 목록, 채팅 메시지, 스트리밍 상태를 관리하고
 * IPC 리스너를 통해 main process와 통신합니다.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { CowrkAgentState, CowrkChatMessage } from '../../shared/types'

interface UseCowrkAgentsReturn {
  /** 에이전트 목록 */
  agents: CowrkAgentState[]
  /** 에이전트별 채팅 메시지 */
  chatMessages: Record<string, CowrkChatMessage[]>
  /** 현재 열린 채팅 패널의 에이전트 이름 */
  activeAgent: string | null
  /** 생성 다이얼로그 표시 여부 */
  isCreating: boolean
  /** 에이전트 생성 */
  createAgent: (name: string, persona?: string, avatarBase64?: string) => Promise<void>
  /** 에이전트 삭제 */
  deleteAgent: (name: string) => Promise<void>
  /** 에이전트에게 질문 */
  askAgent: (message: string, projectDir?: string) => void
  /** 스트리밍 취소 */
  cancelAgent: () => void
  /** 채팅 패널 열기 */
  openChat: (name: string) => void
  /** 채팅 패널 닫기 */
  closeChat: () => void
  /** 생성 다이얼로그 토글 */
  setCreating: (open: boolean) => void
  /** 에이전트 아바타 설정 */
  setAvatar: (name: string, base64: string) => Promise<void>
}

export function useCowrkAgents(): UseCowrkAgentsReturn {
  const [agents, setAgents] = useState<CowrkAgentState[]>([])
  const [chatMessages, setChatMessages] = useState<Record<string, CowrkChatMessage[]>>({})
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const activeAgentRef = useRef(activeAgent)
  activeAgentRef.current = activeAgent

  // 초기 로드
  useEffect(() => {
    window.api.cowrkListAgents().then(setAgents).catch(() => {})
  }, [])

  // IPC 리스너 등록
  useEffect(() => {
    const unsubChunk = window.api.onCowrkStreamChunk((agentName, chunk) => {
      setChatMessages(prev => {
        const msgs = prev[agentName] || []
        const last = msgs[msgs.length - 1]

        if (last && last.role === 'assistant' && last.isStreaming) {
          // 기존 스트리밍 메시지에 추가
          const updated = [...msgs]
          updated[updated.length - 1] = { ...last, content: last.content + chunk }
          return { ...prev, [agentName]: updated }
        }

        // 새 스트리밍 메시지 시작
        return {
          ...prev,
          [agentName]: [...msgs, {
            role: 'assistant',
            content: chunk,
            timestamp: Date.now(),
            isStreaming: true,
          }],
        }
      })

      // 에이전트 상태 → thinking
      setAgents(prev => prev.map(a =>
        a.name === agentName ? { ...a, status: 'thinking' as const } : a
      ))
    })

    const unsubComplete = window.api.onCowrkTurnComplete((agentName, response) => {
      setChatMessages(prev => {
        const msgs = prev[agentName] || []
        const last = msgs[msgs.length - 1]

        if (last && last.role === 'assistant' && last.isStreaming) {
          // 스트리밍 완료: isStreaming → false
          const updated = [...msgs]
          updated[updated.length - 1] = {
            ...last,
            content: response || last.content,
            isStreaming: false,
          }
          return { ...prev, [agentName]: updated }
        }

        // 스트리밍 없이 완료 (짧은 응답)
        if (response) {
          return {
            ...prev,
            [agentName]: [...msgs, {
              role: 'assistant',
              content: response,
              timestamp: Date.now(),
              isStreaming: false,
            }],
          }
        }

        return prev
      })

      // 에이전트 상태 → idle
      setAgents(prev => prev.map(a =>
        a.name === agentName ? { ...a, status: 'idle' as const } : a
      ))
    })

    const unsubError = window.api.onCowrkTurnError((agentName, error) => {
      setChatMessages(prev => {
        const msgs = prev[agentName] || []
        // 스트리밍 중이던 메시지에 에러 표시
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          const updated = [...msgs]
          updated[updated.length - 1] = {
            ...last,
            content: last.content + `\n\n[Error: ${error}]`,
            isStreaming: false,
          }
          return { ...prev, [agentName]: updated }
        }

        return {
          ...prev,
          [agentName]: [...msgs, {
            role: 'assistant',
            content: `[Error: ${error}]`,
            timestamp: Date.now(),
            isStreaming: false,
          }],
        }
      })

      setAgents(prev => prev.map(a =>
        a.name === agentName ? { ...a, status: 'error' as const } : a
      ))
    })

    return () => {
      unsubChunk()
      unsubComplete()
      unsubError()
    }
  }, [])

  const createAgent = useCallback(async (name: string, persona?: string, avatarBase64?: string) => {
    const agent = await window.api.cowrkCreateAgent(name, persona)
    if (avatarBase64) {
      const avatarPath = await window.api.cowrkSetAvatar(name, avatarBase64)
      agent.avatarPath = avatarPath
    }
    setAgents(prev => [...prev, agent])
    setIsCreating(false)
  }, [])

  const setAvatar = useCallback(async (name: string, base64: string) => {
    try {
      const avatarPath = await window.api.cowrkSetAvatar(name, base64)
      setAgents(prev => prev.map(a =>
        a.name === name ? { ...a, avatarPath } : a
      ))
    } catch (err) {
      console.error('[useCowrkAgents] setAvatar failed:', err)
    }
  }, [])

  const deleteAgent = useCallback(async (name: string) => {
    await window.api.cowrkDeleteAgent(name)
    setAgents(prev => prev.filter(a => a.name !== name))
    setChatMessages(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    if (activeAgentRef.current === name) {
      setActiveAgent(null)
    }
  }, [])

  const askAgent = useCallback((message: string, projectDir?: string) => {
    const name = activeAgentRef.current
    if (!name) return

    // 사용자 메시지 추가
    setChatMessages(prev => ({
      ...prev,
      [name]: [...(prev[name] || []), {
        role: 'user',
        content: message,
        timestamp: Date.now(),
      }],
    }))

    // 즉시 thinking 상태 전환 (스트림 시작 전 pending 표시)
    setAgents(prev => prev.map(a =>
      a.name === name ? { ...a, status: 'thinking' as const } : a
    ))

    window.api.cowrkAsk(name, message, projectDir)
  }, [])

  const cancelAgent = useCallback(() => {
    const name = activeAgentRef.current
    if (!name) return
    window.api.cowrkCancel(name)
  }, [])

  const openChat = useCallback((name: string) => {
    setActiveAgent(name)
  }, [])

  const closeChat = useCallback(() => {
    setActiveAgent(null)
  }, [])

  const loadHistory = useCallback((name: string, messages: CowrkChatMessage[]) => {
    setChatMessages(prev => {
      if (prev[name] && prev[name].length > 0) return prev // 이미 로드됨
      return { ...prev, [name]: messages }
    })
  }, [])

  const refreshAgents = useCallback(async () => {
    const updated = await window.api.cowrkListAgents()
    setAgents(updated)
  }, [])

  return {
    agents,
    setAgents,
    chatMessages,
    activeAgent,
    isCreating,
    createAgent,
    deleteAgent,
    askAgent,
    cancelAgent,
    openChat,
    closeChat,
    setCreating: setIsCreating,
    setAvatar,
    refreshAgents,
    loadHistory,
  }
}
