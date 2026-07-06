/**
 * ReviewPanel — Codex 기반 코드 리뷰 결과 뷰어
 *
 * git diff HEAD를 Codex에 리뷰시킨 결과(마크다운)를 터미널 옆에 표시.
 * DiffPanel/ViewerPanel과 동일한 레이아웃 패턴을 사용하되,
 * 리뷰는 비동기 실행이라 로딩/에러/완료 상태를 함께 렌더링합니다.
 */

import { useMemo } from 'react'
import { X, RefreshCw, Loader2, Sparkles, Zap } from 'lucide-react'
import { marked } from 'marked'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import type { ReviewState } from '../hooks/useReviewManager'
import './ReviewPanel.css'

marked.setOptions({ breaks: true, gfm: true })

interface ReviewPanelProps {
  sessionId: string
  review: ReviewState | undefined
  locale: Locale
  /** 자동 리뷰(턴 종료 시 재실행) 활성 여부 */
  autoEnabled?: boolean
  onClose: () => void
  onRerun: () => void
  onToggleAuto?: () => void
}

export default function ReviewPanel({
  sessionId: _sessionId,
  review,
  locale,
  autoEnabled,
  onClose,
  onRerun,
  onToggleAuto
}: ReviewPanelProps): JSX.Element {
  const status = review?.status ?? 'idle'
  const text = review?.text ?? ''

  const html = useMemo(() => {
    if (!text) return ''
    try {
      return marked.parse(text) as string
    } catch {
      return text
    }
  }, [text])

  return (
    <div className="review-panel">
      {/* 헤더 */}
      <div className="review-panel-header">
        <span className="review-panel-title">
          <Sparkles size={13} />
          {t(locale, 'review.title')}
          {status === 'running' && (
            <span className="review-panel-status">{t(locale, 'review.running')}</span>
          )}
        </span>
        <div className="review-panel-actions">
          {onToggleAuto && (
            <button
              className={`review-panel-btn${autoEnabled ? ' review-panel-btn--active' : ''}`}
              onClick={onToggleAuto}
              title={t(locale, 'review.auto')}
            >
              <Zap size={12} />
            </button>
          )}
          <button
            className="review-panel-btn"
            onClick={onRerun}
            disabled={status === 'running'}
            title={t(locale, 'review.rerun')}
          >
            <RefreshCw size={12} />
          </button>
          <button className="review-panel-btn" onClick={onClose} title={t(locale, 'review.close')}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="review-panel-content">
        {status === 'error' ? (
          <div className="review-panel-error">
            <div className="review-panel-error-title">{t(locale, 'review.error')}</div>
            <pre className="review-panel-error-msg">
              {review?.error === 'CODEX_NOT_FOUND'
                ? t(locale, 'review.notInstalled')
                : review?.error}
            </pre>
          </div>
        ) : status === 'done' && !text ? (
          <div className="review-panel-empty">{t(locale, 'review.noChanges')}</div>
        ) : status === 'running' && !text ? (
          <div className="review-panel-loading">
            <Loader2 size={20} className="review-spin" />
            <span>{t(locale, 'review.analyzing')}</span>
          </div>
        ) : (
          <div
            className="review-markdown plan-markdown"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
