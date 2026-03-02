/**
 * useNativeChat — Native 모드 채팅 상태 관리 훅
 *
 * `claude --output-format stream-json --input-format stream-json --verbose`의
 * NDJSON 이벤트를 ChatMessage[] 형태로 변환합니다.
 *
 * stream-json 이벤트 형식:
 *   { type: "system", subtype: "init", ... }        → 무시
 *   { type: "assistant", message: { content: [...] } } → 응답 블록 추출
 *   { type: "result", subtype: "success", ... }     → 턴 완료 통계
 *   { type: "input_request", ... }                  → Permission/Question UI 표시
 *
 * 상태 머신: idle → streaming → idle/error
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import type {
  ChatMessage, ChatContentBlock, ChatTextBlock, ChatToolUseBlock,
  ChatToolResultBlock, ChatThinkingBlock, ChatInputRequestBlock,
  TurnStats, NativeInputRequest
} from '../../../shared/types'

type ChatPhase = 'idle' | 'streaming' | 'error'

interface UseNativeChatParams {
  activeSessionId: string | null
}

interface UseNativeChatReturn {
  messages: Record<string, ChatMessage[]>
  phase: ChatPhase
  sendMessage: (text: string) => void
  cancelStream: () => void
  /** Permission/Question 응답 전송 */
  respondToInput: (requestId: string, response: Record<string, unknown>) => void
  /** 큐 대기 중 메시지 수정 */
  editQueuedMessage: (index: number, newText: string) => void
  /** 큐 대기 중 메시지 삭제 */
  removeQueuedMessage: (index: number) => void
  errorMessage: string | null
}

export function useNativeChat({ activeSessionId }: UseNativeChatParams): UseNativeChatReturn {
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({})
  const [phase, setPhase] = useState<ChatPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const streamingSessionRef = useRef<string | null>(null)
  /** result 이벤트에서 추출한 턴 통계 (턴 완료 시 메시지에 첨부) */
  const pendingStatsRef = useRef<TurnStats | null>(null)

  // Send message (스트리밍 중이면 큐에 저장, main에서 자동 전송)
  const sendMessage = useCallback((text: string) => {
    if (!activeSessionId) return
    const sid = activeSessionId

    if (phase === 'streaming') {
      // 큐: 유저 메시지를 queued 상태로 표시, main 쪽 큐에 저장
      const userMsg: ChatMessage = { role: 'user', text, queued: true, timestamp: Date.now() }
      setMessages(prev => ({
        ...prev,
        [sid]: [...(prev[sid] || []), userMsg]
      }))
      window.api.sendNativeMessage(sid, text) // main의 messageQueue에 저장됨
      return
    }

    const userMsg: ChatMessage = { role: 'user', text, timestamp: Date.now() }
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      blocks: [],
      isStreaming: true,
      timestamp: Date.now()
    }

    setMessages(prev => ({
      ...prev,
      [sid]: [...(prev[sid] || []), userMsg, assistantMsg]
    }))

    streamingSessionRef.current = sid
    pendingStatsRef.current = null
    setPhase('streaming')
    setErrorMessage(null)

    window.api.sendNativeMessage(sid, text)
  }, [activeSessionId, phase])

  // Cancel streaming
  const cancelStream = useCallback(() => {
    if (!activeSessionId) return
    window.api.cancelNativeStream(activeSessionId)

    const sid = activeSessionId
    setMessages(prev => {
      const sessionMsgs = [...(prev[sid] || [])]
      const lastIdx = sessionMsgs.length - 1
      if (lastIdx >= 0 && sessionMsgs[lastIdx].role === 'assistant') {
        sessionMsgs[lastIdx] = { ...sessionMsgs[lastIdx], isStreaming: false, cancelled: true }
      }
      return { ...prev, [sid]: sessionMsgs }
    })
    setPhase('idle')
    streamingSessionRef.current = null
    pendingStatsRef.current = null
  }, [activeSessionId])

  // Edit queued message (큐 대기 중 메시지 수정)
  const editQueuedMessage = useCallback((index: number, newText: string) => {
    if (!activeSessionId) return
    const sid = activeSessionId

    setMessages(prev => {
      const sessionMsgs = [...(prev[sid] || [])]
      if (index < 0 || index >= sessionMsgs.length) return prev
      const msg = sessionMsgs[index]
      if (msg.role !== 'user' || !msg.queued) return prev

      sessionMsgs[index] = { ...msg, text: newText }
      return { ...prev, [sid]: sessionMsgs }
    })

    // main 프로세스 큐도 업데이트
    window.api.updateNativeQueue(sid, newText)
  }, [activeSessionId])

  // Remove queued message (큐 대기 중 메시지 삭제)
  const removeQueuedMessage = useCallback((index: number) => {
    if (!activeSessionId) return
    const sid = activeSessionId

    setMessages(prev => {
      const sessionMsgs = [...(prev[sid] || [])]
      if (index < 0 || index >= sessionMsgs.length) return prev
      const msg = sessionMsgs[index]
      if (msg.role !== 'user' || !msg.queued) return prev

      sessionMsgs.splice(index, 1)
      return { ...prev, [sid]: sessionMsgs }
    })

    // main 프로세스 큐에서도 제거
    window.api.clearNativeQueue(sid)
  }, [activeSessionId])

  // Respond to input request (Permission/Question)
  const respondToInput = useCallback((requestId: string, response: Record<string, unknown>) => {
    if (!activeSessionId) return

    // IPC로 main 프로세스에 응답 전달
    window.api.respondToNativeInput(activeSessionId, requestId, response)

    // 메시지 상태에서 해당 input_request 블록을 answered로 업데이트
    const sid = activeSessionId
    setMessages(prev => {
      const sessionMsgs = [...(prev[sid] || [])]
      for (let i = sessionMsgs.length - 1; i >= 0; i--) {
        const msg = sessionMsgs[i]
        if (!msg.blocks) continue

        const blockIdx = msg.blocks.findIndex(b =>
          b.type === 'input_request' && (b as ChatInputRequestBlock).request.requestId === requestId
        )
        if (blockIdx >= 0) {
          const updatedBlocks = [...msg.blocks]
          const block = updatedBlocks[blockIdx] as ChatInputRequestBlock

          // 응답 라벨 생성
          let responseLabel = ''
          if (block.request.type === 'permission') {
            responseLabel = response.approved ? '✓ Allowed' : '✗ Denied'
          } else {
            responseLabel = `→ ${response.answer || ''}`
          }

          updatedBlocks[blockIdx] = { ...block, answered: true, responseLabel }
          sessionMsgs[i] = { ...msg, blocks: updatedBlocks }
          break
        }
      }
      return { ...prev, [sid]: sessionMsgs }
    })
  }, [activeSessionId])

  // Register IPC listeners
  useEffect(() => {
    const cleanupStream = window.api.onNativeStreamEvent((sessionId, event) => {
      // 큐 메시지 자동 전송 시: streamingSessionRef가 null → 새 턴 시작
      if (streamingSessionRef.current === null) {
        const type = event.type as string
        if (type === 'assistant' || type === 'system') {
          // 큐에서 자동 전송된 새 턴 → assistant placeholder 추가
          streamingSessionRef.current = sessionId
          pendingStatsRef.current = null
          setPhase('streaming')
          setErrorMessage(null)

          setMessages(prev => {
            const sessionMsgs = [...(prev[sessionId] || [])]
            const last = sessionMsgs[sessionMsgs.length - 1]
            // 이미 assistant placeholder가 있으면 스킵
            if (last?.role === 'assistant' && last.isStreaming) return prev
            // 큐 메시지 → active로 전환 (queued 플래그 제거)
            for (let i = sessionMsgs.length - 1; i >= 0; i--) {
              if (sessionMsgs[i].role === 'user' && sessionMsgs[i].queued) {
                sessionMsgs[i] = { ...sessionMsgs[i], queued: false }
                break
              }
            }
            return {
              ...prev,
              [sessionId]: [...sessionMsgs, { role: 'assistant', blocks: [], isStreaming: true, timestamp: Date.now() }]
            }
          })
        }
      }

      if (sessionId !== streamingSessionRef.current) return

      const type = event.type as string

      // assistant 이벤트: 완성된 응답 메시지
      if (type === 'assistant') {
        const message = event.message as Record<string, unknown> | undefined
        if (!message) return

        const content = message.content as Array<Record<string, unknown>> | undefined
        if (!content || !Array.isArray(content)) return

        const blocks: ChatContentBlock[] = content.map(block => {
          if (block.type === 'thinking') {
            return { type: 'thinking', thinking: block.thinking as string } as ChatThinkingBlock
          }
          if (block.type === 'text') {
            return { type: 'text', text: block.text as string } as ChatTextBlock
          }
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use',
              id: (block.id as string) || '',
              name: (block.name as string) || '',
              input: block.input as Record<string, unknown> || {}
            } as ChatToolUseBlock
          }
          if (block.type === 'tool_result') {
            // tool_result.content는 문자열 또는 배열
            let resultText = ''
            const rc = block.content
            if (typeof rc === 'string') {
              resultText = rc
            } else if (Array.isArray(rc)) {
              resultText = (rc as Array<Record<string, unknown>>)
                .filter(c => c.type === 'text')
                .map(c => c.text as string)
                .join('\n')
            }
            return {
              type: 'tool_result',
              tool_use_id: (block.tool_use_id as string) || '',
              content: resultText,
              is_error: block.is_error as boolean | undefined
            } as ChatToolResultBlock
          }
          return null
        }).filter((b): b is ChatContentBlock => b !== null)

        setMessages(prev => {
          const sessionMsgs = [...(prev[sessionId] || [])]
          const lastIdx = sessionMsgs.length - 1
          if (lastIdx >= 0 && sessionMsgs[lastIdx].role === 'assistant' && sessionMsgs[lastIdx].isStreaming) {
            const existingBlocks = sessionMsgs[lastIdx].blocks || []
            sessionMsgs[lastIdx] = {
              ...sessionMsgs[lastIdx],
              blocks: [...existingBlocks, ...blocks]
            }
          }
          return { ...prev, [sessionId]: sessionMsgs }
        })
      }

      // result 이벤트: 턴 통계 추출 (턴 완료 시 메시지에 첨부됨)
      if (type === 'result') {
        const costUsd = event.cost_usd as number | undefined
        const durationMs = event.duration_ms as number | undefined
        const model = event.model as string | undefined

        // tool_use 블록 수 세기
        let numTools = 0
        setMessages(prev => {
          const sessionMsgs = prev[sessionId] || []
          const lastMsg = sessionMsgs[sessionMsgs.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.blocks) {
            numTools = lastMsg.blocks.filter(b => b.type === 'tool_use').length
          }
          return prev // 변경 없음
        })

        pendingStatsRef.current = { costUsd, durationMs, numTools, model }
      }
    })

    // Turn complete
    const cleanupComplete = window.api.onNativeTurnComplete((sessionId, _claudeSessionId) => {
      if (sessionId !== streamingSessionRef.current) return

      const stats = pendingStatsRef.current

      setMessages(prev => {
        const sessionMsgs = [...(prev[sessionId] || [])]
        const lastIdx = sessionMsgs.length - 1
        if (lastIdx >= 0 && sessionMsgs[lastIdx].role === 'assistant') {
          // tool 수 최종 계산
          const blocks = sessionMsgs[lastIdx].blocks || []
          const numTools = blocks.filter(b => b.type === 'tool_use').length
          const turnStats: TurnStats = stats
            ? { ...stats, numTools }
            : { numTools }

          sessionMsgs[lastIdx] = {
            ...sessionMsgs[lastIdx],
            isStreaming: false,
            turnStats
          }
        }
        return { ...prev, [sessionId]: sessionMsgs }
      })

      setPhase('idle')
      streamingSessionRef.current = null
      pendingStatsRef.current = null
    })

    // Turn error
    const cleanupError = window.api.onNativeTurnError((sessionId, error) => {
      if (sessionId !== streamingSessionRef.current) return

      setMessages(prev => {
        const sessionMsgs = [...(prev[sessionId] || [])]
        const lastIdx = sessionMsgs.length - 1
        if (lastIdx >= 0 && sessionMsgs[lastIdx].role === 'assistant') {
          const existingBlocks = sessionMsgs[lastIdx].blocks || []
          sessionMsgs[lastIdx] = {
            ...sessionMsgs[lastIdx],
            isStreaming: false,
            blocks: [...existingBlocks, { type: 'text', text: `\n\n**Error:** ${error}` } as ChatTextBlock]
          }
        }
        return { ...prev, [sessionId]: sessionMsgs }
      })

      setPhase('error')
      setErrorMessage(error)
      streamingSessionRef.current = null
      pendingStatsRef.current = null
    })

    // Input request (Permission/Question)
    const cleanupInputRequest = window.api.onNativeInputRequest((sessionId, request) => {
      if (sessionId !== streamingSessionRef.current) return

      // input_request 블록을 현재 스트리밍 중인 assistant 메시지에 추가
      const inputBlock: ChatInputRequestBlock = {
        type: 'input_request',
        request,
        answered: false
      }

      setMessages(prev => {
        const sessionMsgs = [...(prev[sessionId] || [])]
        const lastIdx = sessionMsgs.length - 1
        if (lastIdx >= 0 && sessionMsgs[lastIdx].role === 'assistant' && sessionMsgs[lastIdx].isStreaming) {
          const existingBlocks = sessionMsgs[lastIdx].blocks || []
          sessionMsgs[lastIdx] = {
            ...sessionMsgs[lastIdx],
            blocks: [...existingBlocks, inputBlock]
          }
        }
        return { ...prev, [sessionId]: sessionMsgs }
      })
    })

    return () => {
      cleanupStream()
      cleanupComplete()
      cleanupError()
      cleanupInputRequest()
    }
  }, [])

  return { messages, phase, sendMessage, cancelStream, respondToInput, editQueuedMessage, removeQueuedMessage, errorMessage }
}
