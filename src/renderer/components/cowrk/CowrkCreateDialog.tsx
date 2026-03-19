/**
 * CowrkCreateDialog — 에이전트 생성 모달
 *
 * 이름과 페르소나를 입력받아 새 에이전트를 생성합니다.
 * 이름: 영문+숫자+하이픈, 1-30자
 * 페르소나: 선택, 미입력 시 기본 페르소나 사용
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { X, Camera } from 'lucide-react'
import { type Locale, t } from '../../i18n'
import './CowrkPanel.css'

interface CowrkCreateDialogProps {
  isOpen: boolean
  locale: Locale
  onClose: () => void
  onCreate: (name: string, persona?: string, avatarBase64?: string) => Promise<void>
}

const NAME_REGEX = /^[a-zA-Z0-9-]{1,30}$/

export default function CowrkCreateDialog({
  isOpen,
  locale,
  onClose,
  onCreate,
}: CowrkCreateDialogProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // 열릴 때 초기화 + 포커스
  useEffect(() => {
    if (isOpen) {
      setName('')
      setPersona('')
      setError('')
      setLoading(false)
      setAvatarBase64(null)
      setAvatarPreview(null)
      setTimeout(() => nameRef.current?.focus(), 100)
    }
  }, [isOpen])

  // 아바타 파일 선택 (최대 5MB)
  const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError(t(locale, 'cowrk.fileTooLarge'))
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setAvatarPreview(dataUrl)
      setAvatarBase64(dataUrl.split(',')[1] || null)
    }
    reader.onerror = () => {
      console.error('[CowrkCreateDialog] FileReader error:', reader.error)
      setError('Failed to read file')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [locale])

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
      setError(t(locale, 'cowrk.nameRequired'))
      return
    }
    if (!NAME_REGEX.test(trimmed)) {
      setError(t(locale, 'cowrk.nameInvalid'))
      return
    }

    setLoading(true)
    setError('')
    try {
      await onCreate(trimmed, persona.trim() || undefined, avatarBase64 || undefined)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [name, persona, avatarBase64, locale, onCreate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault()
      handleCreate()
    }
  }, [handleCreate])

  if (!isOpen) return null

  return (
    <div className="cowrk-dialog-overlay" onClick={onClose}>
      <div className="cowrk-dialog" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="cowrk-dialog-header">
          <span className="cowrk-dialog-title">{t(locale, 'cowrk.newAgent')}</span>
          <button className="cowrk-dialog-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="cowrk-dialog-body">
          {/* 아바타 선택 */}
          <div className="cowrk-dialog-avatar-row">
            <div
              className="cowrk-dialog-avatar"
              onClick={() => avatarInputRef.current?.click()}
              title={t(locale, 'cowrk.selectAvatar')}
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="cowrk-dialog-avatar-img" draggable={false} />
              ) : (
                <Camera size={20} className="cowrk-dialog-avatar-icon" />
              )}
              <div className="cowrk-dialog-avatar-overlay">
                <Camera size={12} />
              </div>
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarSelect}
            />
          </div>

          <label className="cowrk-dialog-label">
            {t(locale, 'cowrk.name')}
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
            {t(locale, 'cowrk.persona')} <span className="cowrk-dialog-optional">{t(locale, 'cowrk.personaOptional')}</span>
            <textarea
              className="cowrk-dialog-textarea"
              value={persona}
              onChange={e => setPersona(e.target.value)}
              placeholder={t(locale, 'cowrk.personaPlaceholder')}
              rows={4}
              disabled={loading}
            />
          </label>

          {error && <div className="cowrk-dialog-error">{error}</div>}
        </div>

        <div className="cowrk-dialog-footer">
          <button className="cowrk-dialog-btn cowrk-dialog-btn--cancel" onClick={onClose} disabled={loading}>
            {t(locale, 'cowrk.cancel')}
          </button>
          <button className="cowrk-dialog-btn cowrk-dialog-btn--create" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? t(locale, 'cowrk.creating') : t(locale, 'cowrk.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
