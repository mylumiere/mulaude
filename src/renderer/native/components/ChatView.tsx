import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import type { ChatMessage as ChatMessageType } from '../../../shared/types'
import ChatMessageComponent from './ChatMessage'
import ChatInput from './ChatInput'

interface ChatViewProps {
  messages: ChatMessageType[]
  isStreaming: boolean
  onSendMessage: (text: string) => void
  onCancel: () => void
  /** Permission/Question 응답 콜백 */
  onRespondToInput: (requestId: string, response: Record<string, unknown>) => void
  /** 큐 메시지 수정 콜백 */
  onEditQueued: (index: number, newText: string) => void
  /** 큐 메시지 삭제 콜백 */
  onRemoveQueued: (index: number) => void
  sessionName?: string
}

export default function ChatView({
  messages,
  isStreaming,
  onSendMessage,
  onCancel,
  onRespondToInput,
  onEditQueued,
  onRemoveQueued,
  sessionName
}: ChatViewProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, autoScroll])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }, [])

  /** 마지막 assistant 턴의 모델명 추출 */
  const lastModel = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].turnStats?.model) {
        return messages[i].turnStats!.model
      }
    }
    return undefined
  }, [messages])

  return (
    <div className="chat-view">
      <div className="chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-logo">✦</div>
            <div className="chat-empty-title">Claude</div>
            <div className="chat-empty-session">{sessionName || 'New session'}</div>
          </div>
        ) : (
          messages.map((msg, i) => {
            // 턴 구분선: assistant 이후 user가 올 때
            const showSeparator = i > 0 && msg.role === 'user' && messages[i - 1].role === 'assistant'
            return (
              <div key={i}>
                {showSeparator && <div className="chat-turn-separator">───</div>}
                <ChatMessageComponent
                  message={msg}
                  messageIndex={i}
                  onRespondToInput={onRespondToInput}
                  onEditQueued={onEditQueued}
                  onRemoveQueued={onRemoveQueued}
                />
              </div>
            )
          })
        )}
      </div>
      <ChatInput
        onSend={onSendMessage}
        onCancel={onCancel}
        isStreaming={isStreaming}
        disabled={false}
        modelName={lastModel}
      />
    </div>
  )
}
