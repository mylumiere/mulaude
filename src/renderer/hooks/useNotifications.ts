/**
 * useNotifications - 알림 + attention 마크 관리
 *
 * 세션 상태 변화를 감지하여 데스크톱 알림을 발송하고,
 * 비활성 세션의 attention 마크를 관리합니다.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionInfo, SessionStatus } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import { type NotifSettings, type NotifEvent, isNotifEnabled, sendNotification } from '../settings'

interface UseNotificationsParams {
  sessionStatuses: Record<string, SessionStatus>
  sessions: SessionInfo[]
  activeSessionId: string | null
  notifSettings: NotifSettings
  locale: Locale
}

interface UseNotificationsReturn {
  attentionSessions: Set<string>
  clearAttention: (id: string) => void
}

export function useNotifications({
  sessionStatuses,
  sessions,
  activeSessionId,
  notifSettings,
  locale
}: UseNotificationsParams): UseNotificationsReturn {
  const [attentionSessions, setAttentionSessions] = useState<Set<string>>(new Set())
  const prevStatuses = useRef<Record<string, SessionStatus>>({})

  const clearAttention = useCallback((id: string) => {
    setAttentionSessions((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
  }, [])

  useEffect(() => {
    for (const [id, status] of Object.entries(sessionStatuses)) {
      const prev = prevStatuses.current[id]
      if (!prev || prev.state === status.state) continue

      const sessionName = sessions.find((s) => s.id === id)?.name || id

      // 작업 완료 (thinking/tool/agent → idle)
      if (status.state === 'idle' && ['thinking', 'tool', 'agent'].includes(prev.state)) {
        if (id !== activeSessionId) {
          setAttentionSessions((s) => { const n = new Set(s); n.add(id); return n })
        }
        if (isNotifEnabled(notifSettings, id, 'onIdle')) {
          sendNotification(sessionName, t(locale, 'notif.onIdle'))
        }
      }
      // permission (항상 알림 + attention)
      if (status.state === 'permission') {
        setAttentionSessions((s) => { const n = new Set(s); n.add(id); return n })
        sendNotification(sessionName, status.label || 'Permission required')
      }
      // error
      if (status.state === 'error') {
        if (id !== activeSessionId) {
          setAttentionSessions((s) => { const n = new Set(s); n.add(id); return n })
        }
        if (isNotifEnabled(notifSettings, id, 'onError')) {
          sendNotification(sessionName, status.label || t(locale, 'notif.onError'))
        }
      }
      // exited
      if (status.state === 'exited') {
        if (isNotifEnabled(notifSettings, id, 'onComplete')) {
          sendNotification(sessionName, t(locale, 'notif.onComplete'))
        }
      }
      // agent 시작
      if (status.state === 'agent' && prev.state !== 'agent') {
        if (isNotifEnabled(notifSettings, id, 'onAgent')) {
          sendNotification(sessionName, status.label || t(locale, 'notif.onAgent'))
        }
      }
    }
    prevStatuses.current = { ...sessionStatuses }
  }, [sessionStatuses, notifSettings, sessions, locale, activeSessionId])

  return { attentionSessions, clearAttention }
}
