/**
 * PreviewPanel — .claude/launch.json 기반 dev 서버 미리보기 패널
 *
 * Chrome DevTools 스타일 레이아웃:
 *   ┌──────────────────────────────────┐
 *   │ ◄ ► ↻ │ URL bar         │ 📱💻│✕│  ← 통합 툴바
 *   ├──────────────────────────────────┤
 *   │        iframe (브라우저)          │  ← 메인 영역
 *   ├─── ↕ drag handle ───────────────┤
 *   │ [dev] [api]  ⊞ split   🗑 ⤴ ▾  │  ← 드로어 헤더
 *   │ dev logs   │  api logs          │  ← 분할 시 좌우 칼럼
 *   └──────────────────────────────────┘
 *
 * 드로어 모드:
 *   - 탭 모드: 하나의 프로세스 로그만 표시 (탭 전환)
 *   - 분할 모드: 모든 프로세스 로그를 좌우 칼럼으로 동시 표시
 *   - 개별 팝아웃: 각 프로세스를 독립 창으로 분리
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import {
  X, Globe, RefreshCw, ScrollText, Trash2, ExternalLink,
  Smartphone, Tablet, Monitor, Loader2, ArrowLeft, ArrowRight,
  ChevronDown, ChevronUp, PanelTopOpen, Columns2,
  Copy, MessageSquare
} from 'lucide-react'
import { loadPreviewState, savePreviewState } from '../utils/preview-storage'
import { PREVIEW_MAX_RETRIES, PREVIEW_RETRY_INTERVAL } from '../../shared/constants'
import { t, type Locale } from '../i18n'
import './PreviewPanel.css'

interface ProcessLogEntry {
  stream: 'stdout' | 'stderr'
  text: string
  ts: number
}

interface PreviewPanelProps {
  sessionId: string
  isFocused: boolean
  locale: Locale
  onClose: () => void
  /** 트리거 또는 launch.json에서 전달된 URL */
  pendingUrl?: string | null
  /** launch.json에 정의된 프로세스 이름 순서 */
  processOrder?: string[]
}

/** 프로세스 로그 최대 라인 수 */
const MAX_LOG_LINES = 2000

/** 뷰포트 프리셋 */
type ViewportPreset = 'responsive' | 'mobile' | 'tablet' | 'desktop'

const VIEWPORT_SIZES: Record<ViewportPreset, { width: number; height: number } | null> = {
  responsive: null,
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 }
}

/** 드로어 높이 제한 */
const DRAWER_MIN_HEIGHT = 60
const DRAWER_DEFAULT_HEIGHT = 160

/** 팝아웃 창 공통 스타일 */
const POPOUT_STYLES = `
  .log-line { display:flex; gap:10px; padding:1px 12px; }
  .log-time { color:#585b70; flex-shrink:0; font-size:11px; user-select:none; }
  .log-text { flex:1; white-space:pre-wrap; word-break:break-all; }
  .log-stderr .log-text { color:#f9e2af; }
  .log-stdout .log-text { color:#a6adc8; }
`

/** HTML 이스케이프 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 시간 포맷 (HH:MM:SS) */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** 로그 엔트리를 DOM에 추가 */
function appendLogEntry(doc: Document, container: HTMLElement, entry: ProcessLogEntry): void {
  const line = doc.createElement('div')
  line.className = `log-line log-${entry.stream}`
  line.innerHTML = `<span class="log-time">${formatTime(entry.ts)}</span><span class="log-text">${escapeHtml(entry.text)}</span>`
  container.appendChild(line)
}

export default function PreviewPanel({ sessionId, isFocused, locale, onClose, pendingUrl, processOrder }: PreviewPanelProps): JSX.Element {
  const [url, setUrl] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [urlKey, setUrlKey] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [viewport, setViewport] = useState<ViewportPreset>('responsive')
  const pendingConsumed = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval>>()

  // 닫기: iframe TCP 연결 먼저 정리 → CLOSE_WAIT 방지
  const handleClose = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = 'about:blank'
    }
    onClose()
  }, [onClose])

  // 히스토리
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < history.length - 1

  // 프로세스 로그
  const [processLogs, setProcessLogs] = useState<Record<string, ProcessLogEntry[]>>({})
  const [activeLogTab, setActiveLogTab] = useState<string | null>(null)
  const logEndRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 드로어 상태
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerHeight, setDrawerHeight] = useState(DRAWER_DEFAULT_HEIGHT)
  const [drawerSplit, setDrawerSplit] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // 프로세스별 팝아웃 창 (각각 독립)
  const popoutWindows = useRef<Record<string, Window>>({})

  // 분할 칼럼 드래그 리사이즈: flex 비율 배열
  const [splitRatios, setSplitRatios] = useState<number[]>([])
  const splitRatiosRef = useRef<number[]>([])
  splitRatiosRef.current = splitRatios

  // 프로세스 목록 (launch.json 순서 유지)
  const processNames = useMemo(() => {
    const keys = Object.keys(processLogs)
    if (!processOrder?.length) return keys
    return keys.sort((a, b) => {
      const ia = processOrder.indexOf(a)
      const ib = processOrder.indexOf(b)
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
    })
  }, [processLogs, processOrder])
  const hasProcesses = processNames.length > 0
  const multiProcess = processNames.length > 1

  // 프로세스가 처음 등장하면 드로어 자동 오픈 + 첫 번째 탭 활성화
  useEffect(() => {
    if (hasProcesses && !activeLogTab) {
      setActiveLogTab(processNames[0])
      setDrawerOpen(true)
    }
  }, [hasProcesses, activeLogTab, processNames])

  // 2개 이상이면 자동 분할 모드 제안 (한 번만)
  const autoSplitDone = useRef(false)
  useEffect(() => {
    if (multiProcess && !autoSplitDone.current) {
      autoSplitDone.current = true
      setDrawerSplit(true)
    }
  }, [multiProcess])

  // 분할 비율 초기화 (프로세스 수 변경 시)
  useEffect(() => {
    const count = processNames.length
    setSplitRatios(prev =>
      prev.length === count ? prev : Array(count).fill(1)
    )
  }, [processNames.length])

  // storage에서 URL 복원
  useEffect(() => {
    const saved = loadPreviewState(sessionId)
    if (saved?.url) {
      setUrl(saved.url)
      setUrlInput(saved.url)
      setHistory([saved.url])
      setHistoryIndex(0)
    }
  }, [sessionId])

  // pending URL을 한번만 소비
  useEffect(() => {
    if (pendingUrl && !pendingConsumed.current) {
      pendingConsumed.current = true
      navigateTo(pendingUrl)
    }
  }, [pendingUrl, sessionId])

  // 프로세스 로그 수신 (preview-launcher 경유)
  useEffect(() => {
    const cleanup = window.api.onPreviewProcessLog((sid, processName, stream, data) => {
      if (sid !== sessionId) return
      setProcessLogs(prev => {
        const existing = prev[processName] || []
        const newEntries = data.split('\n').filter(Boolean).map(line => ({
          stream, text: line, ts: Date.now()
        }))
        const updated = [...existing, ...newEntries].slice(-MAX_LOG_LINES)
        return { ...prev, [processName]: updated }
      })
    })
    return cleanup
  }, [sessionId])

  // 드로어 내 로그 자동 스크롤
  useEffect(() => {
    if (!drawerOpen) return
    if (drawerSplit) {
      // 분할 모드: 모든 칼럼 스크롤
      for (const name of processNames) {
        const ref = logEndRefs.current[name]
        if (ref) ref.scrollIntoView({ behavior: 'smooth' })
      }
    } else {
      // 탭 모드: 활성 탭만
      const ref = activeLogTab ? logEndRefs.current[activeLogTab] : null
      if (ref) ref.scrollIntoView({ behavior: 'smooth' })
    }
  }, [processLogs, drawerOpen, drawerSplit, activeLogTab, processNames])

  // 팝아웃 창에 실시간 로그 동기화
  useEffect(() => {
    for (const name of processNames) {
      const popup = popoutWindows.current[name]
      if (!popup || popup.closed) {
        delete popoutWindows.current[name]
        continue
      }
      const container = popup.document.getElementById('log-container')
      if (!container) continue
      const logs = processLogs[name] || []
      const existing = container.children.length

      // 로그가 초기화되었거나 MAX_LOG_LINES로 잘려서 DOM과 불일치 → 전체 재렌더
      if (logs.length < existing) {
        container.innerHTML = ''
        for (const entry of logs) {
          appendLogEntry(popup.document, container, entry)
        }
      } else {
        // 차분만 추가 (일반 경로)
        const newLogs = logs.slice(existing)
        for (const entry of newLogs) {
          appendLogEntry(popup.document, container, entry)
        }
      }
      container.scrollTop = container.scrollHeight
    }
  }, [processLogs, processNames])

  // 컴포넌트 언마운트 시 모든 팝아웃 창 닫기
  useEffect(() => {
    return () => {
      for (const w of Object.values(popoutWindows.current)) {
        if (w && !w.closed) w.close()
      }
    }
  }, [])

  // 언마운트 시 폴링 타이머 정리
  useEffect(() => {
    return () => { clearInterval(pollTimerRef.current) }
  }, [])

  /** URL 이동 (히스토리 추가) */
  const navigateTo = useCallback((rawUrl: string) => {
    const finalUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`
    clearInterval(pollTimerRef.current)
    setUrl(finalUrl)
    setUrlInput(finalUrl)
    setUrlKey(k => k + 1)
    setIsLoading(true)
    savePreviewState(sessionId, { url: finalUrl })

    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1)
      return [...trimmed, finalUrl]
    })
    setHistoryIndex(prev => prev + 1)
  }, [sessionId, historyIndex])

  const handleUrlSubmit = useCallback(() => {
    const trimmed = urlInput.trim()
    if (!trimmed) return
    navigateTo(trimmed)
  }, [urlInput, navigateTo])

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleUrlSubmit()
  }, [handleUrlSubmit])

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    setUrl(history[newIndex])
    setUrlInput(history[newIndex])
    setUrlKey(k => k + 1)
    setIsLoading(true)
  }, [canGoBack, historyIndex, history])

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return
    const newIndex = historyIndex + 1
    setHistoryIndex(newIndex)
    setUrl(history[newIndex])
    setUrlInput(history[newIndex])
    setUrlKey(k => k + 1)
    setIsLoading(true)
  }, [canGoForward, historyIndex, history])

  const reloadUrl = useCallback(() => {
    setUrlKey(k => k + 1)
    setIsLoading(true)
  }, [])

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false)
    // 정상 로드 확인
    try {
      const doc = iframeRef.current?.contentDocument
      if (doc && doc.body !== null) return // same-origin 정상 로드
    } catch {
      return // cross-origin (SSO 등) → 정상 로드로 간주
    }
    // contentDocument가 빈 페이지 = 서버 미준비 → fetch 폴링으로 대기 후 1회 새로고침
    if (!url) return
    clearInterval(pollTimerRef.current)
    setIsLoading(true)
    let attempts = 0
    pollTimerRef.current = setInterval(async () => {
      attempts++
      if (attempts > PREVIEW_MAX_RETRIES) {
        clearInterval(pollTimerRef.current)
        setIsLoading(false)
        return
      }
      try {
        const res = await fetch(url, { method: 'HEAD', mode: 'no-cors' })
        // no-cors fetch는 opaque response (status 0) 반환 — 서버 응답 있으면 성공
        if (res.status === 0 || res.ok) {
          clearInterval(pollTimerRef.current)
          setUrlKey(k => k + 1)
        }
      } catch {
        // 서버 아직 미준비 → 다음 폴링까지 대기
      }
    }, PREVIEW_RETRY_INTERVAL)
  }, [url])

  const openExternal = useCallback(() => {
    if (url) window.open(url, '_blank')
  }, [url])

  /** 특정 프로세스를 새 창으로 팝아웃 */
  const popoutProcess = useCallback((processName: string) => {
    // 이미 열려 있으면 포커스만
    const existing = popoutWindows.current[processName]
    if (existing && !existing.closed) {
      existing.focus()
      return
    }

    const popup = window.open('', `preview-log-${sessionId}-${processName}`, 'width=700,height=500')
    if (!popup) return
    popoutWindows.current[processName] = popup

    const doc = popup.document
    doc.title = `Logs — ${processName}`
    doc.documentElement.style.cssText = 'margin:0; padding:0; height:100%;'
    doc.body.style.cssText = `
      margin:0; padding:0; height:100%;
      background:#11111b; color:#a6adc8;
      font-family:'Menlo','SF Mono','Fira Code',monospace;
      font-size:12px; line-height:1.6; overflow-y:auto;
    `

    const style = doc.createElement('style')
    style.textContent = `
      ${POPOUT_STYLES}
      .header { display:flex; align-items:center; gap:6px; padding:6px 12px; background:#181825;
                border-bottom:1px solid #313244; position:sticky; top:0; z-index:1; }
      .header-title { font-size:12px; font-weight:600; color:#cdd6f4; flex:1; }
      .header-btn { background:none; border:none; color:#585b70; cursor:pointer; padding:3px 6px;
                    border-radius:3px; font-size:11px; font-family:inherit; }
      .header-btn:hover { color:#a6adc8; background:#1e1e2e; }
    `
    doc.head.appendChild(style)

    // 헤더
    const header = doc.createElement('div')
    header.className = 'header'
    header.innerHTML = `<span class="header-title">${escapeHtml(processName)}</span>`
    const clearBtn = doc.createElement('button')
    clearBtn.className = 'header-btn'
    clearBtn.textContent = '⌫ Clear'
    clearBtn.onclick = () => {
      const c = doc.getElementById('log-container')
      if (c) c.innerHTML = ''
      setProcessLogs(prev => ({ ...prev, [processName]: [] }))
    }
    header.appendChild(clearBtn)
    doc.body.appendChild(header)

    // 로그 컨테이너
    const container = doc.createElement('div')
    container.id = 'log-container'
    container.style.padding = '4px 0'
    doc.body.appendChild(container)

    // 기존 로그 렌더
    const logs = processLogs[processName] || []
    for (const entry of logs) {
      appendLogEntry(doc, container, entry)
    }
    container.scrollTop = container.scrollHeight

    // 닫힐 때 정리
    popup.addEventListener('beforeunload', () => {
      delete popoutWindows.current[processName]
    })
  }, [sessionId, processLogs])

  /** 드로어 리사이즈 */
  const handleDrawerResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const panel = panelRef.current
    if (!panel) return

    const startY = e.clientY
    const startHeight = drawerHeight

    const onMouseMove = (ev: MouseEvent): void => {
      const panelRect = panel.getBoundingClientRect()
      const maxHeight = panelRect.height * 0.7
      const delta = startY - ev.clientY
      const newHeight = Math.max(DRAWER_MIN_HEIGHT, Math.min(maxHeight, startHeight + delta))
      setDrawerHeight(newHeight)
    }

    const onMouseUp = (): void => {
      document.body.classList.remove('resizing')
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.classList.add('resizing')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [drawerHeight])

  /** 분할 칼럼 드래그 리사이즈 */
  const handleColumnResize = useCallback((e: React.MouseEvent, handleIndex: number) => {
    e.preventDefault()
    const splitContainer = panelRef.current?.querySelector('.preview-drawer-split') as HTMLElement | null
    if (!splitContainer) return

    const startX = e.clientX
    const containerWidth = splitContainer.getBoundingClientRect().width
    const startRatios = [...splitRatiosRef.current]
    const total = startRatios.reduce((a, b) => a + b, 0)
    const MIN_FLEX = 0.3

    const onMouseMove = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX
      const dRatio = (dx / containerWidth) * total
      const left = startRatios[handleIndex] + dRatio
      const right = startRatios[handleIndex + 1] - dRatio
      if (left < MIN_FLEX || right < MIN_FLEX) return
      const newRatios = [...startRatios]
      newRatios[handleIndex] = left
      newRatios[handleIndex + 1] = right
      setSplitRatios(newRatios)
    }

    const onMouseUp = (): void => {
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
  }, [])

  // 로그 텍스트 선택 시 플로팅 액션 바
  const [logSelection, setLogSelection] = useState<{ x: number; y: number; text: string } | null>(null)

  /** 로그 영역에서 텍스트 선택 감지 */
  const handleLogMouseUp = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (text && text.length > 0) {
      const panel = panelRef.current
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      setLogSelection({
        x: Math.min(e.clientX - rect.left, rect.width - 200),
        y: Math.max(0, e.clientY - rect.top - 36),
        text
      })
    }
  }, [])

  // 플로팅 바 외부 클릭 시 닫기
  useEffect(() => {
    if (!logSelection) return
    const dismiss = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.preview-log-selection-bar')) {
        setLogSelection(null)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', dismiss), 100)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', dismiss) }
  }, [logSelection])

  /** 로그를 Claude 터미널에 전송 */
  const askClaudeAboutLogs = useCallback((logText: string) => {
    const trimmed = logText.trim()
    if (!trimmed) return
    // ANSI 코드 제거
    const clean = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // 5000자 초과 시 잘라내기
    const truncated = clean.length > 5000 ? '...(truncated)\n' + clean.slice(-5000) : clean
    const prompt = t(locale, 'preview.askClaudePrompt')
    const message = `${prompt}\n\`\`\`\n${truncated}\n\`\`\``
    // 멀티라인 입력을 위해 bracketed paste 모드 사용
    window.api.writeSession(sessionId, `\x1b[200~${message}\x1b[201~\r`)
    setLogSelection(null)
  }, [sessionId])

  /** 로그 엔트리 → 텍스트 변환 */
  const logsToText = useCallback((logs: ProcessLogEntry[]): string => {
    return logs.map(e => `[${formatTime(e.ts)}] ${e.text}`).join('\n')
  }, [])

  /** 로그 라인 렌더 (공통) */
  const renderLogLines = (logs: ProcessLogEntry[], refName: string): JSX.Element => (
    <>
      {logs.map((entry, i) => (
        <div key={i} className={`preview-log-line preview-log-line--${entry.stream}`}>
          <span className="preview-log-time">{formatTime(entry.ts)}</span>
          <span className="preview-log-text">{entry.text}</span>
        </div>
      ))}
      <div ref={el => { logEndRefs.current[refName] = el }} />
    </>
  )

  const viewportSize = VIEWPORT_SIZES[viewport]

  return (
    <div ref={panelRef} className={`preview-panel${isFocused ? ' preview-panel--focused' : ''}`}>
      {/* ── 통합 툴바 ── */}
      <div className="preview-toolbar">
        <div className="preview-nav-group">
          <button
            className={`preview-nav-btn${!canGoBack ? ' preview-nav-btn--disabled' : ''}`}
            onClick={handleGoBack}
            disabled={!canGoBack}
            title={t(locale, 'preview.back')}
          >
            <ArrowLeft size={12} />
          </button>
          <button
            className={`preview-nav-btn${!canGoForward ? ' preview-nav-btn--disabled' : ''}`}
            onClick={handleGoForward}
            disabled={!canGoForward}
            title={t(locale, 'preview.forward')}
          >
            <ArrowRight size={12} />
          </button>
          <button className="preview-nav-btn" onClick={reloadUrl} title={t(locale, 'preview.reload')}>
            {isLoading ? <Loader2 size={12} className="preview-spinner" /> : <RefreshCw size={12} />}
          </button>
        </div>

        <div className="preview-url-bar">
          <input
            className="preview-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder={t(locale, 'preview.urlPlaceholder')}
            spellCheck={false}
          />
        </div>

        {url && (
          <button className="preview-nav-btn" onClick={openExternal} title={t(locale, 'preview.openExternal')}>
            <ExternalLink size={12} />
          </button>
        )}

        <div className="preview-toolbar-spacer" />

        {url && (
          <div className="preview-viewport-group">
            <button
              className={`preview-viewport-btn${viewport === 'responsive' ? ' preview-viewport-btn--active' : ''}`}
              onClick={() => setViewport('responsive')}
              title={t(locale, 'preview.responsive')}
            >
              <Monitor size={11} />
            </button>
            <button
              className={`preview-viewport-btn${viewport === 'mobile' ? ' preview-viewport-btn--active' : ''}`}
              onClick={() => setViewport('mobile')}
              title={`${t(locale, 'preview.mobile')} (375×812)`}
            >
              <Smartphone size={11} />
            </button>
            <button
              className={`preview-viewport-btn${viewport === 'tablet' ? ' preview-viewport-btn--active' : ''}`}
              onClick={() => setViewport('tablet')}
              title={`${t(locale, 'preview.tablet')} (768×1024)`}
            >
              <Tablet size={11} />
            </button>
          </div>
        )}

        {hasProcesses && (
          <button
            className={`preview-toolbar-btn${drawerOpen ? ' preview-toolbar-btn--active' : ''}`}
            onClick={() => setDrawerOpen(v => !v)}
            title={t(locale, 'preview.toggleLogs')}
          >
            <ScrollText size={12} />
          </button>
        )}

        <button className="preview-toolbar-btn preview-toolbar-close" onClick={handleClose}>
          <X size={12} />
        </button>
      </div>

      {/* ── 브라우저 (항상 표시) ── */}
      <div className="preview-iframe-container">
        {url ? (
          <div className={`preview-iframe-wrapper${viewportSize ? ' preview-iframe-wrapper--framed' : ''}`}>
            {viewportSize && (
              <div className="preview-viewport-label">
                {viewportSize.width} × {viewportSize.height}
              </div>
            )}
            <iframe
              ref={iframeRef}
              key={urlKey}
              className="preview-iframe"
              src={url}
              sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups"
              title="Preview"
              onLoad={handleIframeLoad}
              style={viewportSize ? {
                width: `${viewportSize.width}px`,
                height: `${viewportSize.height}px`,
                maxWidth: '100%',
                maxHeight: '100%'
              } : undefined}
            />
            {isLoading && (
              <div className="preview-loading-overlay">
                <Loader2 size={24} className="preview-spinner" />
              </div>
            )}
          </div>
        ) : (
          <div className="preview-empty-state">
            <div className="preview-empty-icon"><Globe size={36} /></div>
            <p className="preview-empty-title">{t(locale, 'preview.urlEmpty')}</p>
            <p className="preview-empty-hint">{t(locale, 'preview.urlHint')}</p>
          </div>
        )}
      </div>

      {/* ── 하단 로그 드로어 ── */}
      {hasProcesses && drawerOpen && (
        <>
          <div className="preview-drawer-handle" onMouseDown={handleDrawerResize} />

          <div className="preview-drawer" style={{ height: drawerHeight }}>
            {/* 드로어 헤더 */}
            <div className="preview-drawer-header">
              {/* 탭 모드일 때만 탭 표시 */}
              {!drawerSplit && (
                <div className="preview-drawer-tabs">
                  {processNames.map(name => (
                    <button
                      key={name}
                      className={`preview-drawer-tab${activeLogTab === name ? ' preview-drawer-tab--active' : ''}`}
                      onClick={() => setActiveLogTab(name)}
                    >
                      <ScrollText size={10} />
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 분할 모드일 때 라벨 */}
              {drawerSplit && (
                <div className="preview-drawer-split-label">
                  <Columns2 size={10} />
                  <span>{t(locale, 'preview.splitView')}</span>
                </div>
              )}

              <div className="preview-drawer-actions">
                {/* 탭 모드: 활성 탭 액션 */}
                {!drawerSplit && activeLogTab && (
                  <>
                    <button
                      className="preview-drawer-action preview-drawer-action--ask"
                      onClick={() => askClaudeAboutLogs(logsToText(processLogs[activeLogTab] || []))}
                      title={t(locale, 'preview.askClaude')}
                    >
                      <MessageSquare size={10} />
                    </button>
                    <button
                      className="preview-drawer-action"
                      onClick={() => processNames.forEach(name => popoutProcess(name))}
                      title={t(locale, 'preview.popoutLogs')}
                    >
                      <PanelTopOpen size={10} />
                    </button>
                    <button
                      className="preview-drawer-action"
                      onClick={() => setProcessLogs(prev => ({ ...prev, [activeLogTab]: [] }))}
                      title={t(locale, 'preview.clearConsole')}
                    >
                      <Trash2 size={10} />
                    </button>
                  </>
                )}

                {/* 분할 토글 (2개 이상일 때만) */}
                {multiProcess && (
                  <button
                    className={`preview-drawer-action${drawerSplit ? ' preview-drawer-action--active' : ''}`}
                    onClick={() => setDrawerSplit(v => !v)}
                    title={t(locale, 'preview.splitToggle')}
                  >
                    <Columns2 size={10} />
                  </button>
                )}

                <button
                  className="preview-drawer-action"
                  onClick={() => setDrawerOpen(false)}
                  title={t(locale, 'preview.collapseLogs')}
                >
                  <ChevronDown size={10} />
                </button>
              </div>
            </div>

            {/* ── 탭 모드: 단일 로그 ── */}
            {!drawerSplit && activeLogTab && (
              <div className="preview-drawer-content" onMouseUp={handleLogMouseUp}>
                {renderLogLines(processLogs[activeLogTab] || [], activeLogTab)}
              </div>
            )}

            {/* ── 분할 모드: 좌우 칼럼 (드래그 리사이즈) ── */}
            {drawerSplit && (
              <div className="preview-drawer-split">
                {processNames.flatMap((name, index) => {
                  const elements: JSX.Element[] = []
                  if (index > 0) {
                    elements.push(
                      <div
                        key={`handle-${index}`}
                        className="preview-drawer-col-handle"
                        onMouseDown={(e) => handleColumnResize(e, index - 1)}
                        onDoubleClick={() => setSplitRatios(prev => prev.map(() => 1))}
                      />
                    )
                  }
                  elements.push(
                    <div
                      key={name}
                      className="preview-drawer-column"
                      style={{ flex: splitRatios[index] ?? 1 }}
                    >
                      <div className="preview-drawer-col-header">
                        <span className="preview-drawer-col-title">{name}</span>
                        <button
                          className="preview-drawer-action preview-drawer-action--ask"
                          onClick={() => askClaudeAboutLogs(logsToText(processLogs[name] || []))}
                          title={t(locale, 'preview.askClaude')}
                        >
                          <MessageSquare size={9} />
                        </button>
                        <button
                          className="preview-drawer-action"
                          onClick={() => popoutProcess(name)}
                          title={t(locale, 'preview.popoutLogs')}
                        >
                          <PanelTopOpen size={9} />
                        </button>
                        <button
                          className="preview-drawer-action"
                          onClick={() => setProcessLogs(prev => ({ ...prev, [name]: [] }))}
                          title={t(locale, 'preview.clearConsole')}
                        >
                          <Trash2 size={9} />
                        </button>
                      </div>
                      <div className="preview-drawer-content" onMouseUp={handleLogMouseUp}>
                        {renderLogLines(processLogs[name] || [], name)}
                      </div>
                    </div>
                  )
                  return elements
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* 드로어 닫힌 상태 — 알림 바 */}
      {hasProcesses && !drawerOpen && (
        <button className="preview-drawer-collapsed" onClick={() => setDrawerOpen(true)}>
          <ChevronUp size={10} />
          <ScrollText size={10} />
          <span>{t(locale, 'preview.showLogs')}</span>
          <span className="preview-drawer-badge">{processNames.length}</span>
        </button>
      )}

      {/* 로그 텍스트 선택 시 플로팅 액션 바 */}
      {logSelection && (
        <div
          className="preview-log-selection-bar"
          style={{ left: logSelection.x, top: logSelection.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="preview-log-selection-btn"
            onClick={() => { navigator.clipboard.writeText(logSelection.text); setLogSelection(null) }}
          >
            <Copy size={10} />
            <span>{t(locale, 'preview.copy')}</span>
          </button>
          <button
            className="preview-log-selection-btn preview-log-selection-btn--ask"
            onClick={() => askClaudeAboutLogs(logSelection.text)}
          >
            <MessageSquare size={10} />
            <span>{t(locale, 'preview.askClaude')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
