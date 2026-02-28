/**
 * TmuxMissingBanner — tmux 미설치 시 표시되는 안내 배너
 *
 * 앱 시작 시 tmux가 설치되어 있지 않으면 전체 화면 오버레이로 표시됩니다.
 * 사용자는 tmux를 설치하거나, "tmux 없이 계속" 버튼으로 legacy 모드로 진행할 수 있습니다.
 *
 * tmux 설치 시 세션 영속화 기능을 사용할 수 있습니다:
 *   - 앱 종료 후에도 Claude 세션이 백그라운드에서 유지됨
 *   - 앱 재시작 시 이전 세션 자동 복원
 */

import { t, type Locale } from '../i18n'
import './TmuxMissingBanner.css'

interface TmuxMissingBannerProps {
  locale: Locale
  onDismiss: () => void
}

export default function TmuxMissingBanner({ locale, onDismiss }: TmuxMissingBannerProps): JSX.Element {
  return (
    <div className="tmux-banner-overlay">
      <div className="tmux-banner">
        <div className="tmux-banner-icon">⚠</div>
        <h2 className="tmux-banner-title">{t(locale, 'tmux.missing.title')}</h2>
        <p className="tmux-banner-body">{t(locale, 'tmux.missing.body')}</p>
        <div className="tmux-banner-install">
          <code>brew install tmux</code>
        </div>
        <div className="tmux-banner-actions">
          <button className="tmux-banner-continue" onClick={onDismiss}>
            {t(locale, 'tmux.missing.continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
