/**
 * ShortcutsModal - 키보드 단축키 안내 다이얼로그
 *
 * 사이드바 하단 버튼 클릭 시 전체 단축키 목록을 카테고리별로 표시합니다.
 */

import { type Locale, t } from '../i18n'
import './ShortcutsModal.css'

interface ShortcutsModalProps {
  onClose: () => void
  locale: Locale
}

interface ShortcutItem {
  keys: string
  labelKey: string
}

interface ShortcutGroup {
  titleKey: string
  items: ShortcutItem[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.group.general',
    items: [
      { keys: '⌘ ,', labelKey: 'shortcuts.openSettings' },
      { keys: '⌘ /', labelKey: 'shortcuts.openShortcuts' },
    ]
  },
  {
    titleKey: 'shortcuts.group.session',
    items: [
      { keys: '⌘ N', labelKey: 'shortcuts.newProject' },
      { keys: '⌘ 1~9', labelKey: 'shortcuts.switchSession' },
      { keys: '⌥⌘ 1~9', labelKey: 'shortcuts.switchProject' },
      { keys: '⌘ ↑', labelKey: 'shortcuts.prevSession' },
      { keys: '⌘ ↓', labelKey: 'shortcuts.nextSession' },
    ]
  },
  {
    titleKey: 'shortcuts.group.grid',
    items: [
      { keys: '⌘ W', labelKey: 'shortcuts.closePane' },
      { keys: '⌘⇧ ↵', labelKey: 'shortcuts.zoomToggle' },
      { keys: '⌘ ← / →', labelKey: 'shortcuts.gridFocusCol' },
      { keys: '⌘ ↑ / ↓', labelKey: 'shortcuts.gridFocusRow' },
    ]
  },
  {
    titleKey: 'shortcuts.group.pane',
    items: [
      { keys: '⌥⌘ ←', labelKey: 'shortcuts.focusParent' },
      { keys: '⌥⌘ →', labelKey: 'shortcuts.focusAgent' },
      { keys: '⌥⌘ ↑', labelKey: 'shortcuts.prevAgent' },
      { keys: '⌥⌘ ↓', labelKey: 'shortcuts.nextAgent' },
    ]
  },
  {
    titleKey: 'shortcuts.group.terminal',
    items: [
      { keys: '⇧ Enter', labelKey: 'shortcuts.newline' },
      { keys: '⌥ ← / →', labelKey: 'shortcuts.wordMove' },
    ]
  }
]

export default function ShortcutsModal({ onClose, locale }: ShortcutsModalProps): JSX.Element {
  return (
    <div className="shortcuts-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="shortcuts-modal">
        <div className="shortcuts-header">
          <h3>
            <span className="shortcuts-header-icon">⌨</span>
            {t(locale, 'shortcuts.title')}
          </h3>
          <button className="shortcuts-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="shortcuts-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey} className="shortcuts-group">
              <div className="shortcuts-group-title">{t(locale, group.titleKey)}</div>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.labelKey} className="shortcuts-item">
                    <kbd className="shortcuts-kbd">{item.keys}</kbd>
                    <span className="shortcuts-label">{t(locale, item.labelKey)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
