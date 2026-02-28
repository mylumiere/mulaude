/**
 * useNotifications - 알림 + attention 마크 관리
 *
 * 세션 상태 변화를 감지하여 데스크톱 알림을 발송하고,
 * 비활성 세션의 attention 마크를 관리합니다.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { SessionInfo, SessionStatus, AgentInfo } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import { type NotifSettings, type NotifEvent, isNotifEnabled, sendNotification } from '../settings'

interface UseNotificationsParams {
  sessionStatuses: Record<string, SessionStatus>
  sessionAgents: Record<string, AgentInfo[]>
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
  sessionAgents,
  sessions,
  activeSessionId,
  notifSettings,
  locale
}: UseNotificationsParams): UseNotificationsReturn {
  const [attentionSessions, setAttentionSessions] = useState<Set<string>>(new Set())
  const prevStatuses = useRef<Record<string, SessionStatus>>({})
  /** 에이전트 크래시 감지용: sessionId → Set<에이전트명> (이미 exited 알림 보낸 것) */
  const notifiedCrashes = useRef<Map<string, Set<string>>>(new Map())

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

  // ── 에이전트 크래시 감지 → 알림 + attention ──
  useEffect(() => {
    for (const [sessionId, agents] of Object.entries(sessionAgents)) {
      const notified = notifiedCrashes.current.get(sessionId) || new Set()

      for (const agent of agents) {
        if (agent.status !== 'exited') continue
        if (notified.has(agent.name)) continue

        // 크래시 알림 발송
        notified.add(agent.name)
        const sessionName = sessions.find((s) => s.id === sessionId)?.name || sessionId

        // attention 마크 (비활성 세션이든 활성이든 항상)
        setAttentionSessions((s) => { const n = new Set(s); n.add(sessionId); return n })

        // 데스크톱 알림
        if (isNotifEnabled(notifSettings, sessionId, 'onAgent')) {
          const agentLabel = agent.name || 'Agent'
          sendNotification(
            sessionName,
            `${agentLabel}: ${t(locale, 'notif.onAgentCrash')}`
          )
        }
      }

      if (notified.size > 0) {
        notifiedCrashes.current.set(sessionId, notified)
      }

      // 에이전트가 사라지거나 다시 running이 되면 notified 초기화
      const activeNames = new Set(agents.filter((a) => a.status === 'exited').map((a) => a.name))
      if (notified.size > 0 && activeNames.size === 0) {
        notifiedCrashes.current.delete(sessionId)
      } else if (notified.size > 0) {
        // exited가 아닌 에이전트는 notified에서 제거 (재실행 대비)
        for (const name of notified) {
          if (!activeNames.has(name)) notified.delete(name)
        }
      }
    }

    // 삭제된 세션 정리
    for (const key of notifiedCrashes.current.keys()) {
      if (!sessionAgents[key]) notifiedCrashes.current.delete(key)
    }
  }, [sessionAgents, sessions, notifSettings, locale])

  return { attentionSessions, clearAttention }
}
