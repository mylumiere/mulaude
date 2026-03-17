/**
 * usePreviewManager — 세션별 Preview 상태/비율 관리 + 토글/닫기/저장 액션 통합
 *
 * App.tsx의 Preview 관련 상태와 핸들러를 한 곳에서 관리합니다.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { PREVIEW_DEFAULT_RATIO, MIN_PANE_RATIO, PREVIEW_ALERT_TIMEOUT } from '../../shared/constants'
import { savePreviewSessions, loadPreviewSessions, deletePreviewState, savePreviewState } from '../utils/preview-storage'
import { t, type Locale } from '../i18n'
import type { SessionInfo } from '../../shared/types'

/* ─── Types ─── */

export interface SaveConfigInfo {
  sessionId: string
  workingDir: string
  config: {
    version?: string
    configurations: { name: string; runtimeExecutable: string; runtimeArgs?: string[]; port?: number; cwd?: string }[]
  }
}

interface UsePreviewManagerParams {
  /** ref로 전달 — 훅 초기화 순서 제약 우회 (sessionManager보다 먼저 호출됨) */
  sessionsRef: React.MutableRefObject<SessionInfo[]>
  locale: Locale
  /** usePreviewTrigger의 notifyClose */
  notifyPreviewClose: (sessionId: string) => void
}

interface UsePreviewManagerReturn {
  /* ── 코어 상태 ── */
  previewSessions: Set<string>
  previewRatios: Record<string, number>
  pendingUrls: Record<string, string>
  consumePendingUrl: (sessionId: string) => string | null
  openPreview: (sessionId: string) => void
  openPreviewWithUrl: (sessionId: string, url: string | null) => void
  closePreview: (sessionId: string) => void
  cleanupPreview: (sessionId: string) => void
  handlePreviewResize: (sessionId: string) => (e: React.MouseEvent) => void
  /** ref로 최신 상태 즉시 참조 (usePreviewTrigger용) */
  previewSessionsRef: React.MutableRefObject<Set<string>>

  /* ── 액션 (App.tsx에서 이관) ── */
  handleTogglePreview: (sessionId: string) => Promise<void>
  handleClosePreview: (sessionId: string) => Promise<void>
  pendingSaveConfig: SaveConfigInfo | null
  handleSaveLaunchConfig: () => Promise<void>
  handleSkipSaveLaunchConfig: () => void
  previewAlert: { sessionId: string; message: string } | null
  /** 세션 복원 후 호출 — 저장된 미리보기 프로세스 재실행 */
  restorePreview: () => void
  /** 세션별 프로세스 이름 순서 (launch.json 순서) */
  processOrders: Record<string, string[]>
}

/* ─── Hook ─── */

export function usePreviewManager({
  sessionsRef,
  locale,
  notifyPreviewClose
}: UsePreviewManagerParams): UsePreviewManagerReturn {
  const [previewSessions, setPreviewSessions] = useState<Set<string>>(() => {
    return new Set(loadPreviewSessions())
  })
  const [previewRatios, setPreviewRatios] = useState<Record<string, number>>({})
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({})
  const containerRef = useRef<HTMLElement | null>(null)

  // 최신 상태를 ref로 동기화 (useEffect closure stale 방지)
  const previewSessionsRef = useRef(previewSessions)
  previewSessionsRef.current = previewSessions

  const persist = useCallback((s: Set<string>) => {
    savePreviewSessions(Array.from(s))
  }, [])

  const openPreview = useCallback((sessionId: string) => {
    setPreviewSessions(prev => {
      if (prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.add(sessionId)
      persist(next)
      return next
    })
  }, [persist])

  const openPreviewWithUrl = useCallback((sessionId: string, url: string | null) => {
    if (url) {
      setPendingUrls(prev => ({ ...prev, [sessionId]: url }))
      savePreviewState(sessionId, { url })
    }
    openPreview(sessionId)
  }, [openPreview])

  const consumePendingUrl = useCallback((sessionId: string): string | null => {
    const url = pendingUrls[sessionId] || null
    if (url) {
      setPendingUrls(prev => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
    }
    return url
  }, [pendingUrls])

  const closePreview = useCallback((sessionId: string) => {
    setPreviewSessions(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      persist(next)
      return next
    })
  }, [persist])

  const cleanupPreview = useCallback((sessionId: string) => {
    closePreview(sessionId)
    deletePreviewState(sessionId)
  }, [closePreview])

  const handlePreviewResize = useCallback((sessionId: string) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      const container = (e.target as HTMLElement).parentElement
      if (!container) return
      containerRef.current = container

      const startX = e.clientX
      const startRatio = previewRatios[sessionId] ?? PREVIEW_DEFAULT_RATIO

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const delta = (ev.clientX - startX) / rect.width
        const newRatio = Math.max(MIN_PANE_RATIO, Math.min(1 - MIN_PANE_RATIO, startRatio + delta))
        setPreviewRatios(prev => ({ ...prev, [sessionId]: newRatio }))
      }

      const onMouseUp = () => {
        document.body.classList.remove('resizing')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.classList.add('resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    }
  }, [previewRatios])

  /* ── 프로세스 이름 순서 (launch.json 순서 유지) ── */
  const [processOrders, setProcessOrders] = useState<Record<string, string[]>>({})

  /* ── launch.json 저장 확인 ── */
  const [pendingSaveConfig, setPendingSaveConfig] = useState<SaveConfigInfo | null>(null)

  const handleSaveLaunchConfig = useCallback(async () => {
    if (!pendingSaveConfig) return
    try {
      await window.api.saveLaunchConfig(pendingSaveConfig.workingDir, pendingSaveConfig.config)
    } catch { /* 저장 실패 무시 */ }
    setPendingSaveConfig(null)
  }, [pendingSaveConfig])

  const handleSkipSaveLaunchConfig = useCallback(() => {
    setPendingSaveConfig(null)
  }, [])

  /* ── 미지원 프로젝트 토스트 알림 ── */
  const [previewAlert, setPreviewAlert] = useState<{ sessionId: string; message: string } | null>(null)
  useEffect(() => {
    if (!previewAlert) return
    const timer = setTimeout(() => setPreviewAlert(null), PREVIEW_ALERT_TIMEOUT)
    return () => clearTimeout(timer)
  }, [previewAlert])

  /* ── 토글 + 자동 dev server 실행 ── */
  const previewTogglingRef = useRef<Set<string>>(new Set())

  const handleTogglePreview = useCallback(async (sessionId: string) => {
    // 중복 클릭 방지 (launchPreview IPC 대기 중 재클릭 무시)
    if (previewTogglingRef.current.has(sessionId)) return
    previewTogglingRef.current.add(sessionId)
    try {
      // 이미 열려있으면 닫기 + 프로세스 종료
      if (previewSessionsRef.current.has(sessionId)) {
        // iframe TCP 연결 먼저 정리 → CLOSE_WAIT 방지
        document.querySelectorAll<HTMLIFrameElement>('.preview-iframe').forEach((f) => { f.src = 'about:blank' })
        closePreview(sessionId)
        notifyPreviewClose(sessionId)
        await window.api.stopPreview(sessionId)
        return
      }
      // 세션의 workingDir 조회
      const session = sessionsRef.current.find(s => s.id === sessionId)
      if (!session) {
        openPreview(sessionId)
        return
      }
      const result = await window.api.launchPreview(sessionId, session.workingDir)
      if (result) {
        // dev 서버 프로세스가 실행됨 → URL로 열기
        openPreviewWithUrl(sessionId, result.previewUrl)
        // 프로세스 순서 저장 (launch.json 순서)
        if (result.processOrder?.length) {
          setProcessOrders(prev => ({ ...prev, [sessionId]: result.processOrder }))
        }
        // 새로 감지된 설정이면 저장 확인 표시
        if (result.created) {
          setPendingSaveConfig({ sessionId, workingDir: session.workingDir, config: result.config })
        }
      } else {
        // 프로젝트 감지 실패 → 알림 표시
        setPreviewAlert({ sessionId, message: t(locale, 'preview.notSupported') })
      }
    } catch {
      setPreviewAlert({ sessionId, message: t(locale, 'preview.notSupported') })
    } finally {
      previewTogglingRef.current.delete(sessionId)
    }
  }, [locale, closePreview, openPreview, openPreviewWithUrl, notifyPreviewClose]) // sessionsRef는 ref이므로 deps 불필요

  /* ── Preview X 버튼으로 닫기 ── */
  const handleClosePreview = useCallback(async (sessionId: string) => {
    closePreview(sessionId)
    notifyPreviewClose(sessionId)
    await window.api.stopPreview(sessionId)
  }, [closePreview, notifyPreviewClose])

  /* ── 세션 복원 시 미리보기 프로세스 재실행 ── */
  const previewRestoredRef = useRef(false)
  const restorePreview = useCallback(() => {
    if (previewRestoredRef.current) return
    const currentSessions = sessionsRef.current
    if (currentSessions.length === 0) return
    previewRestoredRef.current = true

    const sessionIds = new Set(currentSessions.map(s => s.id))
    const savedPreviews = Array.from(previewSessionsRef.current)

    // 존재하지 않는 세션의 미리보기 정리
    for (const sid of savedPreviews) {
      if (!sessionIds.has(sid)) cleanupPreview(sid)
    }

    // 존재하는 세션의 프로세스 재실행
    for (const sid of savedPreviews) {
      if (!sessionIds.has(sid)) continue
      const session = currentSessions.find(s => s.id === sid)
      if (session) {
        window.api.launchPreview(sid, session.workingDir).then(result => {
          if (result?.processOrder?.length) {
            setProcessOrders(prev => ({ ...prev, [sid]: result.processOrder }))
          }
        }).catch(() => {})
      }
    }
  }, [cleanupPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    previewSessions, previewRatios, pendingUrls, consumePendingUrl,
    openPreview, openPreviewWithUrl, closePreview, cleanupPreview,
    handlePreviewResize, previewSessionsRef,
    handleTogglePreview, handleClosePreview,
    pendingSaveConfig, handleSaveLaunchConfig, handleSkipSaveLaunchConfig,
    previewAlert, restorePreview, processOrders
  }
}
