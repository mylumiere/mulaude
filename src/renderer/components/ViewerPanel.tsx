/**
 * ViewerPanel — 마크다운 렌더 + 이미지 뷰어
 *
 * AI가 수정한 .md 파일 또는 생성한 이미지를 터미널 옆에서 바로 확인
 * PlanPanel/DiffPanel과 동일한 레이아웃 패턴 사용
 */

import { useMemo } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { marked } from 'marked'
import type { ViewerContent } from '../../shared/types'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import './ViewerPanel.css'

// Configure marked for GFM
marked.setOptions({
  breaks: true,
  gfm: true
})

interface ViewerPanelProps {
  sessionId: string
  content: ViewerContent | null
  locale: Locale
  onClose: () => void
  onRefresh: () => void
}

/** 파일 경로에서 파일명 추출 */
function extractFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export default function ViewerPanel({
  sessionId: _sessionId,
  content,
  locale,
  onClose,
  onRefresh
}: ViewerPanelProps): JSX.Element {
  // 마크다운 → HTML 변환
  const html = useMemo(() => {
    if (!content || content.type !== 'markdown') return ''
    try {
      return marked.parse(content.data) as string
    } catch {
      return content.data
    }
  }, [content])

  // 빈 상태
  if (!content) {
    return (
      <div className="viewer-panel">
        <div className="viewer-panel-header">
          <span className="viewer-panel-title">{t(locale, 'viewer.title')}</span>
          <div className="viewer-panel-actions">
            <button className="viewer-panel-btn" onClick={onRefresh} title={t(locale, 'viewer.refresh')}>
              <RefreshCw size={12} />
            </button>
            <button className="viewer-panel-btn" onClick={onClose} title={t(locale, 'viewer.close')}>
              <X size={12} />
            </button>
          </div>
        </div>
        <div className="viewer-panel-empty">{t(locale, 'viewer.empty')}</div>
      </div>
    )
  }

  return (
    <div className="viewer-panel">
      {/* 헤더 */}
      <div className="viewer-panel-header">
        <span className="viewer-panel-title">
          {extractFileName(content.filePath)}
        </span>
        <div className="viewer-panel-actions">
          <button className="viewer-panel-btn" onClick={onRefresh} title={t(locale, 'viewer.refresh')}>
            <RefreshCw size={12} />
          </button>
          <button className="viewer-panel-btn" onClick={onClose} title={t(locale, 'viewer.close')}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="viewer-panel-content">
        {content.type === 'markdown' ? (
          <div
            className="viewer-markdown plan-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="viewer-image-container">
            <img
              src={content.data}
              alt={extractFileName(content.filePath)}
              className="viewer-image"
            />
          </div>
        )}
      </div>
    </div>
  )
}
