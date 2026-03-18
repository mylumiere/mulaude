/**
 * CowrkCreateDialog — 에이전트 생성 모달
 *
 * 이름과 페르소나를 입력받아 새 에이전트를 생성합니다.
 * 이름: 영문+숫자+하이픈, 1-30자
 * 페르소나: 선택, 미입력 시 기본 페르소나 사용
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import './CowrkPanel.css'

interface CowrkCreateDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string, persona?: string) => Promise<void>
}

const NAME_REGEX = /^[a-zA-Z0-9-]{1,30}$/

export default function CowrkCreateDialog({
  isOpen,
  onClose,
  onCreate,
}: CowrkCreateDialogProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  // 열릴 때 초기화 + 포커스
  useEffect(() => {
    if (isOpen) {
      setName('')
      setPersona('')
      setError('')
      setLoading(false)
      setTimeout(() => nameRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Esc로 닫기
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required')
      return
    }
    if (!NAME_REGEX.test(trimmed)) {
      setError('Use letters, numbers, hyphens (1-30 chars)')
      return
    }

    setLoading(true)
    setError('')
    try {
      await onCreate(trimmed, persona.trim() || undefined)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [name, persona, onCreate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault()
      handleCreate()
    }
  }, [handleCreate])

  if (!isOpen) return null

  return (
    <div className="cowrk-dialog-overlay" onClick={onClose}>
      <div className="cowrk-dialog" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cowrk-dialog-header">
          <span className="cowrk-dialog-title">New Agent</span>
          <button className="cowrk-dialog-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="cowrk-dialog-body">
          <label className="cowrk-dialog-label">
            Name
            <input
              ref={nameRef}
              className="cowrk-dialog-input"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="reviewer"
              maxLength={30}
              disabled={loading}
            />
          </label>

          <label className="cowrk-dialog-label">
            Persona <span className="cowrk-dialog-optional">(optional)</span>
            <textarea
              className="cowrk-dialog-textarea"
              value={persona}
              onChange={e => setPersona(e.target.value)}
              placeholder="시니어 코드 리뷰어. 보안 취약점과 성능 문제에 집중..."
              rows={4}
              disabled={loading}
            />
          </label>

          {error && <div className="cowrk-dialog-error">{error}</div>}
        </div>

        <div className="cowrk-dialog-footer">
          <button className="cowrk-dialog-btn cowrk-dialog-btn--cancel" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="cowrk-dialog-btn cowrk-dialog-btn--create" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
