/**
 * useSessionManager - 세션 CRUD, 프로젝트 그룹핑, tmux 세션 복원
 *
 * 세션 생성/삭제, 프로젝트 그룹 계산, 세션 선택 등을 관리합니다.
 * 앱 시작 시 tmux 세션 복원을 시도하고, tmux 미설치 시 배너 표시를 위한 상태를 노출합니다.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { SessionInfo, ProjectGroup } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'

interface UseSessionManagerParams {
  locale: Locale
  initSession: (id: string, restored: boolean) => void
  cleanupSession: (id: string) => void
}

interface UseSessionManagerReturn {
  sessions: SessionInfo[]
  activeSessionId: string | null
  projects: ProjectGroup[]
  createProject: () => Promise<void>
  addSession: (workingDir: string) => Promise<void>
  destroySession: (id: string) => Promise<void>
  removeProject: (workingDir: string) => Promise<void>
  selectSession: (id: string) => void
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>
  updateSessionName: (id: string, name: string) => void
  updateSessionSubtitle: (id: string, subtitle: string) => void
  /** tmux가 설치되지 않았으면 true */
  tmuxMissing: boolean
  /** tmux 미설치 배너를 사용자가 닫았을 때 호출 */
  dismissTmuxBanner: () => void
}

export function useSessionManager({
  locale,
  initSession,
  cleanupSession
}: UseSessionManagerParams): UseSessionManagerReturn {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const sessionCounter = useRef(0)

  /** tmux 미설치 상태 */
  const [tmuxMissing, setTmuxMissing] = useState(false)
  /** 배너 닫기 */
  const dismissTmuxBanner = useCallback(() => setTmuxMissing(false), [])

  // 앱 시작 시 tmux 확인 + 세션 복원
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const tmuxStatus = await window.api.checkTmux()
        if (cancelled) return

        if (!tmuxStatus.available) {
          setTmuxMissing(true)
          return
        }

        // tmux 사용 가능 → 저장된 세션 복원 시도
        const restored: SessionInfo[] = await window.api.restoreAllSessions()
        if (cancelled) return

        if (restored.length > 0) {
          setSessions(restored)
          // sessionCounter를 복원된 세션 수 이후로 설정
          sessionCounter.current = restored.length
          // 첫 번째 복원 세션을 활성화
          setActiveSessionId(restored[0].id)
          // 각 복원 세션에 대해 initSession 호출 (restored=true)
          for (const s of restored) {
            initSession(s.id, true)
          }
        }
      } catch (err) {
        console.error('[useSessionManager] restore failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const projects = useMemo<ProjectGroup[]>(() => {
    const groups = new Map<string, ProjectGroup>()
    for (const session of sessions) {
      if (!groups.has(session.workingDir)) {
        groups.set(session.workingDir, {
          workingDir: session.workingDir,
          name: session.workingDir.split('/').pop() || session.workingDir,
          sessions: []
        })
      }
      groups.get(session.workingDir)!.sessions.push(session)
    }
    return Array.from(groups.values())
  }, [sessions])

  const updateSessionName = useCallback((id: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
    // 영속 저장소에도 동기화
    window.api.updateSessionName(id, name)
  }, [])

  const updateSessionSubtitle = useCallback((id: string, subtitle: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, subtitle } : s)))
    // 영속 저장소에도 동기화
    window.api.updateSessionSubtitle(id, subtitle)
  }, [])

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  const createProject = useCallback(async () => {
    const dir = await window.api.openDirectory()
    if (!dir) return
    try {
      ++sessionCounter.current
      const session = await window.api.createSession(dir)
      const projectName = dir.split('/').pop() || dir
      setSessions((prev) => [...prev, { ...session, name: projectName }])
      setActiveSessionId(session.id)
      initSession(session.id, false)
      // 영속 저장소에 표시 이름 동기화
      window.api.updateSessionName(session.id, projectName)
    } catch (err) {
      console.error('[SessionManager] createSession failed:', err)
    }
  }, [initSession])

  const addSession = useCallback(
    async (workingDir: string) => {
      try {
        ++sessionCounter.current
        const session = await window.api.createSession(workingDir)
        const projectName = workingDir.split('/').pop() || workingDir
        setSessions((prev) => [...prev, { ...session, name: projectName }])
        setActiveSessionId(session.id)
        initSession(session.id, false)
        // 영속 저장소에 표시 이름 동기화
        window.api.updateSessionName(session.id, projectName)
      } catch (err) {
        console.error('[SessionManager] addSession failed:', err)
      }
    },
    [initSession]
  )

  const destroySession = useCallback(
    async (id: string) => {
      await window.api.destroySession(id)
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== id)
        setActiveSessionId((cur) =>
          cur === id ? (remaining[remaining.length - 1]?.id ?? null) : cur
        )
        return remaining
      })
      cleanupSession(id)
    },
    [cleanupSession]
  )

  const removeProject = useCallback(
    async (workingDir: string) => {
      // 함수형 setState로 sessions 의존성 제거
      let toRemoveIds: string[] = []
      setSessions((prev) => {
        const toRemove = prev.filter((s) => s.workingDir === workingDir)
        toRemoveIds = toRemove.map((s) => s.id)
        return prev.filter((s) => s.workingDir !== workingDir)
      })
      // 병렬 destroy
      await Promise.all(toRemoveIds.map((id) => window.api.destroySession(id)))
      const ids = new Set(toRemoveIds)
      setActiveSessionId((cur) => {
        if (cur && ids.has(cur)) return null
        return cur
      })
      for (const id of toRemoveIds) cleanupSession(id)
    },
    [cleanupSession]
  )

  return {
    sessions,
    activeSessionId,
    projects,
    createProject,
    addSession,
    destroySession,
    removeProject,
    selectSession,
    setActiveSessionId,
    updateSessionName,
    updateSessionSubtitle,
    tmuxMissing,
    dismissTmuxBanner
  }
}
