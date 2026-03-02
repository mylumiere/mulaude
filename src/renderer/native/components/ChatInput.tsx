import { useState, useRef, useCallback, useEffect } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled: boolean
  /** 마지막으로 사용된 모델명 */
  modelName?: string
}

export default function ChatInput({ onSend, onCancel, isStreaming, disabled, modelName }: ChatInputProps): JSX.Element {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** 한글 IME 조합 상태 추적 (composing 중에는 Enter 무시) */
  const isComposingRef = useRef(false)

  /** 입력 히스토리 (전송된 메시지 목록) */
  const historyRef = useRef<string[]>([])
  /** 히스토리 탐색 인덱스 (-1 = 현재 입력) */
  const historyIndexRef = useRef(-1)
  /** 히스토리 진입 전 임시 저장 (현재 입력 보존) */
  const savedTextRef = useRef('')

  useEffect(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
    }
  }, [text])

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus()
  }, [disabled])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    // 히스토리에 추가 (중복 제거)
    const history = historyRef.current
    if (history[history.length - 1] !== trimmed) {
      history.push(trimmed)
    }
    historyIndexRef.current = -1
    savedTextRef.current = ''
    onSend(trimmed)
    setText('')
  }, [text, isStreaming, disabled, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 한글 IME 조합 중에는 Enter/키 이벤트 무시
    if (isComposingRef.current) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault()
      onCancel()
      return
    }

    // ↑↓ 히스토리 탐색 (커서가 첫/마지막 줄에 있을 때만)
    const ta = textareaRef.current
    if (!ta || isStreaming || disabled) return
    const history = historyRef.current
    if (history.length === 0) return

    if (e.key === 'ArrowUp') {
      // 커서가 첫 줄에 있을 때만 히스토리 탐색
      const beforeCursor = ta.value.slice(0, ta.selectionStart)
      if (beforeCursor.includes('\n')) return

      e.preventDefault()
      if (historyIndexRef.current === -1) {
        // 최초 진입: 현재 입력 저장
        savedTextRef.current = text
        historyIndexRef.current = history.length - 1
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--
      }
      setText(history[historyIndexRef.current])
    }

    if (e.key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return
      // 커서가 마지막 줄에 있을 때만
      const afterCursor = ta.value.slice(ta.selectionEnd)
      if (afterCursor.includes('\n')) return

      e.preventDefault()
      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++
        setText(history[historyIndexRef.current])
      } else {
        // 히스토리 끝 → 원래 입력 복원
        historyIndexRef.current = -1
        setText(savedTextRef.current)
      }
    }
  }, [handleSend, isStreaming, disabled, onCancel, text])

  // 직접 타이핑하면 히스토리 탐색 리셋
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    if (historyIndexRef.current !== -1) {
      historyIndexRef.current = -1
      savedTextRef.current = ''
    }
  }, [])

  /** 모델명 단축 (claude-sonnet-4-20250514 → sonnet-4) */
  const shortModel = modelName
    ? modelName.replace('claude-', '').replace(/-\d{8}$/, '')
    : null

  return (
    <div className={`chat-input-box ${isStreaming ? 'chat-input-streaming' : ''}`}>
      {/* 상단: 모델명 + 단축키 힌트 */}
      <div className="chat-input-topbar">
        {shortModel && <span className="chat-input-model">{shortModel}</span>}
        <span className="chat-input-hints">
          {isStreaming ? (
            <span className="chat-input-hint-esc">esc to cancel</span>
          ) : (
            <>
              <span className="chat-input-hint">↑↓ history</span>
              <span className="chat-input-hint">↵ send</span>
              <span className="chat-input-hint">⇧↵ newline</span>
            </>
          )}
        </span>
      </div>
      {/* 하단: 입력 영역 */}
      <div className="chat-input-row">
        <span className="chat-input-prompt">&gt;</span>
        <textarea
          ref={textareaRef}
          className="chat-input-field"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder={isStreaming ? 'Claude is responding...' : 'Message Claude...'}
          disabled={disabled}
          rows={1}
        />
      </div>
    </div>
  )
}
