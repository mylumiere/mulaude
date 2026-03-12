/**
 * PlanPanel — Claude Desktop Code 탭 스타일 플랜 마크다운 뷰어
 *
 * 헤더: H1에서 추출한 제목 + 파일 선택 드롭다운 + X 닫기 버튼
 * 콘텐츠: marked로 렌더링된 GFM 마크다운 (실시간 업데이트)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { X, ChevronDown, FolderOpen } from 'lucide-react'
import { marked } from 'marked'
import type { PlanFileInfo } from '../../main/plan-watcher'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import './PlanPanel.css'

// Configure marked for GFM
marked.setOptions({
  breaks: true,
  gfm: true
})

interface PlanPanelProps {
  sessionId: string
  filePath: string
  content: string
  locale: Locale
  onClose: () => void
  onSwitchFile: (sessionId: string, filePath: string) => void
}

/** 마크다운에서 H1 제목 추출 */
function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : null
}

/** 파일 경로에서 파일명 추출 */
function extractFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export default function PlanPanel({
  sessionId,
  filePath,
  content,
  locale,
  onClose,
  onSwitchFile
}: PlanPanelProps): JSX.Element {
  const [showDropdown, setShowDropdown] = useState(false)
  const [planFiles, setPlanFiles] = useState<PlanFileInfo[]>([])
  const contentRef = useRef<HTMLDivElement>(null)
  const prevContentLenRef = useRef(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 마크다운 → HTML 변환
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return content
    }
  }, [content])

  // H1에서 제목 추출, 없으면 파일명
  const title = extractTitle(content) || extractFileName(filePath)

  // 내용 변경 시 스크롤 하단 유지 (실시간 작성 중)
  useEffect(() => {
    if (!contentRef.current) return
    const el = contentRef.current
    const newLen = content.length

    // 내용이 늘어났을 때만 자동 스크롤 (사용자가 위로 스크롤한 경우 방해 안 함)
    if (newLen > prevContentLenRef.current) {
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
      if (isNearBottom) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight
        })
      }
    }
    prevContentLenRef.current = newLen
  }, [content])

  // 드롭다운 열기 시 파일 목록 조회
  const handleToggleDropdown = useCallback(async () => {
    if (!showDropdown) {
      try {
        const files = await window.api.listPlanFiles(sessionId)
        setPlanFiles(files)
      } catch {
        setPlanFiles([])
      }
    }
    setShowDropdown(prev => !prev)
  }, [showDropdown, sessionId])

  // 파일 선택
  const handleSelectFile = useCallback((file: PlanFileInfo) => {
    onSwitchFile(sessionId, file.path)
    setShowDropdown(false)
  }, [sessionId, onSwitchFile])

  // 파일 열기 다이얼로그
  const handleOpenFileDialog = useCallback(async () => {
    setShowDropdown(false)
    try {
      const filePath = await window.api.openPlanFileDialog(sessionId)
      if (filePath) {
        onSwitchFile(sessionId, filePath)
      }
    } catch { /* 무시 */ }
  }, [sessionId, onSwitchFile])

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!showDropdown) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  return (
    <div className="plan-panel">
      {/* 헤더 바 — Claude Desktop 스타일 */}
      <div className="plan-panel-header">
        <div className="plan-panel-title-wrapper" ref={dropdownRef}>
          <button
            className="plan-panel-title-btn"
            onClick={handleToggleDropdown}
            title={t(locale, 'plan.switchFile')}
            aria-label={t(locale, 'plan.switchFile')}
          >
            <span className="plan-panel-title">{title}</span>
            <ChevronDown size={12} className="plan-panel-chevron" />
          </button>

          {/* 파일 선택 드롭다운 */}
          {showDropdown && (
            <div className="plan-panel-dropdown">
              {planFiles.length === 0 ? (
                <div className="plan-panel-dropdown-empty">
                  {t(locale, 'plan.noFiles')}
                </div>
              ) : (
                planFiles.map((file) => (
                  <button
                    key={file.path}
                    className={`plan-panel-dropdown-item${file.path === filePath ? ' plan-panel-dropdown-item--active' : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <span className="plan-panel-dropdown-name">{file.name}</span>
                    <span className="plan-panel-dropdown-date">
                      {new Date(file.mtime).toLocaleDateString()}
                    </span>
                  </button>
                ))
              )}
              <button
                className="plan-panel-dropdown-item plan-panel-dropdown-open"
                onClick={handleOpenFileDialog}
              >
                <FolderOpen size={12} />
                <span className="plan-panel-dropdown-name">{t(locale, 'plan.openFile')}</span>
              </button>
            </div>
          )}
        </div>

        <button
          className="plan-panel-close"
          onClick={onClose}
          title={t(locale, 'plan.close')}
          aria-label={t(locale, 'plan.close')}
        >
          <X size={14} />
        </button>
      </div>

      {/* 마크다운 콘텐츠 영역 */}
      <div className="plan-panel-content" ref={contentRef}>
        {content ? (
          <div
            className="plan-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="plan-panel-empty">
            {t(locale, 'plan.empty')}
          </div>
        )}
      </div>
    </div>
  )
}
