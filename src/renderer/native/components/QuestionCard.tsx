/**
 * QuestionCard — AskUserQuestion 응답 UI
 *
 * Claude가 AskUserQuestion 도구로 사용자에게 질문할 때 표시됩니다.
 * 질문 텍스트와 선택지를 보여주고, 라디오 버튼 또는 텍스트 입력으로 응답합니다.
 *
 * 응답 후에는 카드가 접혀서 선택 결과만 표시됩니다 (→ 선택한 옵션).
 */

import { useState, useCallback } from 'react'
import type { NativeInputRequest } from '../../../shared/types'

interface QuestionCardProps {
  request: NativeInputRequest
  answered: boolean
  responseLabel?: string
  onRespond: (response: Record<string, unknown>) => void
}

export default function QuestionCard({ request, answered, responseLabel, onRespond }: QuestionCardProps): JSX.Element {
  const [selectedOption, setSelectedOption] = useState<string>('')
  const [customText, setCustomText] = useState('')
  const [isOther, setIsOther] = useState(false)

  const handleOptionChange = useCallback((label: string) => {
    setSelectedOption(label)
    setIsOther(false)
  }, [])

  const handleOtherSelect = useCallback(() => {
    setSelectedOption('')
    setIsOther(true)
  }, [])

  const handleSubmit = useCallback(() => {
    const answer = isOther ? customText.trim() : selectedOption
    if (!answer) return
    onRespond({ answer })
  }, [isOther, customText, selectedOption, onRespond])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  // 응답 완료 상태: 접힌 카드
  if (answered) {
    return (
      <div className="question-card question-card-answered">
        <span className="question-answered-icon">→</span>
        <span className="question-answered-text">{request.question || 'Question'}</span>
        <span className="question-answered-label">{responseLabel}</span>
      </div>
    )
  }

  const options = request.options || []
  const canSubmit = isOther ? customText.trim().length > 0 : selectedOption.length > 0

  // 대기 상태: 전체 카드
  return (
    <div className="question-card question-card-pending">
      <div className="question-header">
        <span className="question-icon">?</span>
        <span className="question-title">Claude is asking</span>
      </div>
      {request.question && (
        <div className="question-text">{request.question}</div>
      )}
      <div className="question-options">
        {options.map((opt, i) => (
          <label key={i} className="question-option">
            <input
              type="radio"
              name={`q-${request.requestId}`}
              checked={selectedOption === opt.label && !isOther}
              onChange={() => handleOptionChange(opt.label)}
            />
            <span className="question-option-label">{opt.label}</span>
            {opt.description && (
              <span className="question-option-desc">{opt.description}</span>
            )}
          </label>
        ))}
        {/* Other 옵션 (항상 표시) */}
        <label className="question-option question-option-other">
          <input
            type="radio"
            name={`q-${request.requestId}`}
            checked={isOther}
            onChange={handleOtherSelect}
          />
          <span className="question-option-label">Other:</span>
          <input
            type="text"
            className="question-other-input"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onFocus={handleOtherSelect}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
          />
        </label>
      </div>
      <div className="question-actions">
        <button
          className="question-btn-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Submit
        </button>
      </div>
    </div>
  )
}
