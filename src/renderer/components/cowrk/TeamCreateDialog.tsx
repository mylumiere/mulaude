/**
 * TeamCreateDialog — 팀 생성 모달
 *
 * 팀 이름 입력 + 기존 에이전트 체크리스트 (2개 이상 선택).
 * CowrkCreateDialog와 동일한 모달 패턴.
 */

import { useState, useCallback, useEffect } from 'react'
import type { CowrkAgentState } from '../../../shared/types'
import { type Locale, t } from '../../i18n'
import './CowrkPanel.css'

interface TeamCreateDialogProps {
  isOpen: boolean
  agents: CowrkAgentState[]
  locale: Locale
  onClose: () => void
  onCreate: (name: string, members: string[]) => Promise<void>
}

const NAME_RE = /^[a-zA-Z0-9-]{1,30}$/

export default function TeamCreateDialog({
  isOpen,
  agents,
  locale,
  onClose,
  onCreate,
}: TeamCreateDialogProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 닫을 때 초기화
  useEffect(() => {
    if (!isOpen) {
      setName('')
      setSelectedMembers([])
      setError('')
      setLoading(false)
    }
  }, [isOpen])

  // Esc 키
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const toggleMember = useCallback((agentName: string) => {
    setSelectedMembers(prev =>
      prev.includes(agentName)
        ? prev.filter(m => m !== agentName)
        : [...prev, agentName]
    )
    setError('')
  }, [])

  const moveMember = useCallback((index: number, direction: -1 | 1) => {
    setSelectedMembers(prev => {
      const next = [...prev]
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= next.length) return prev
      ;[next[index]!, next[newIndex]!] = [next[newIndex]!, next[index]!]
      return next
    })
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t(locale, 'team.nameRequired'))
      return
    }
    if (!NAME_RE.test(trimmed)) {
      setError(t(locale, 'team.nameInvalid'))
      return
    }
    if (selectedMembers.length < 2) {
      setError(t(locale, 'team.minMembers'))
      return
    }

    setLoading(true)
    try {
      await onCreate(trimmed, selectedMembers)
    } catch (err) {
      setError((err as Error).message)
      setLoading(false)
    }
  }, [name, selectedMembers, locale, onCreate])

  if (!isOpen) return null

  return (
    <div className="cowrk-dialog-overlay" onClick={onClose}>
      <div className="cowrk-dialog" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="cowrk-dialog-header">
          <span className="cowrk-dialog-title">{t(locale, 'team.newTeam')}</span>
          <button className="cowrk-dialog-close" onClick={onClose}>&times;</button>
        </div>

        {/* 바디 */}
        <div className="cowrk-dialog-body">
          {/* 팀 이름 */}
          <label className="cowrk-dialog-label">{t(locale, 'team.name')}</label>
          <input
            className="cowrk-dialog-input"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="design-review"
            maxLength={30}
            autoFocus
          />

          {/* 멤버 선택 */}
          <label className="cowrk-dialog-label" style={{ marginTop: 12 }}>
            {t(locale, 'team.members')}
            <span className="cowrk-dialog-hint">{t(locale, 'team.membersHint')}</span>
          </label>

          {agents.length < 2 ? (
            <p className="team-no-agents">{t(locale, 'team.noAgents')}</p>
          ) : (
            <div className="team-member-list">
              {agents.map(agent => {
                const isSelected = selectedMembers.includes(agent.name)
                const orderIndex = selectedMembers.indexOf(agent.name)
                return (
                  <div
                    key={agent.name}
                    className={`team-member-item${isSelected ? ' team-member-item--selected' : ''}`}
                    onClick={() => toggleMember(agent.name)}
                  >
                    {/* 체크박스 */}
                    <div className={`team-member-check${isSelected ? ' team-member-check--on' : ''}`}>
                      {isSelected ? '✓' : ''}
                    </div>

                    {/* 아바타 */}
                    <div className="team-member-avatar">
                      {agent.avatarPath ? (
                        <img src={`file://${agent.avatarPath}?t=1`} alt={agent.name} draggable={false} />
                      ) : (
                        <span>{agent.name[0]?.toUpperCase()}</span>
                      )}
                    </div>

                    {/* 이름 */}
                    <span className="team-member-name">{agent.name}</span>

                    {/* 순서 표시 + 이동 버튼 */}
                    {isSelected && (
                      <div className="team-member-order" onClick={e => e.stopPropagation()}>
                        <span className="team-member-badge">#{orderIndex + 1}</span>
                        <button
                          className="team-member-move"
                          disabled={orderIndex === 0}
                          onClick={() => moveMember(orderIndex, -1)}
                        >↑</button>
                        <button
                          className="team-member-move"
                          disabled={orderIndex === selectedMembers.length - 1}
                          onClick={() => moveMember(orderIndex, 1)}
                        >↓</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* 에러 */}
          {error && <p className="cowrk-dialog-error">{error}</p>}
        </div>

        {/* 푸터 */}
        <div className="cowrk-dialog-footer">
          <button className="cowrk-dialog-btn-cancel" onClick={onClose}>
            {t(locale, 'team.cancel')}
          </button>
          <button
            className="cowrk-dialog-btn-create"
            disabled={!name.trim() || selectedMembers.length < 2 || loading}
            onClick={handleCreate}
          >
            {loading ? t(locale, 'team.creating') : t(locale, 'team.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
