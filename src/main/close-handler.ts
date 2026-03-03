/**
 * 창 닫기 핸들러 모듈
 *
 * 활성 세션이 있을 때 닫기 동작을 제어합니다.
 * tmux 모드: 세션 유지/종료/취소 3버튼 다이얼로그
 * legacy 모드: 종료/취소 2버튼 다이얼로그
 *
 * 다이얼로그 번역(4개 언어: en/ko/ja/zh)도 이 모듈에서 관리합니다.
 */

import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import type { SessionManager } from './session-manager'

type MainLocale = 'en' | 'ko' | 'ja' | 'zh'

const dialogI18n: Record<MainLocale, Record<string, string>> = {
  en: {
    'close.tmux.btn.keep': 'Keep sessions & close',
    'close.tmux.btn.kill': 'Terminate all & close',
    'close.tmux.btn.cancel': 'Cancel',
    'close.tmux.message': '{count} Claude session(s) are running.',
    'close.tmux.detail': 'Kept sessions will be automatically restored when you reopen the app.',
    'close.legacy.btn.quit': 'Quit',
    'close.legacy.btn.cancel': 'Cancel',
    'close.legacy.message': '{count} Claude session(s) are running.',
    'close.legacy.detail': 'All sessions will be terminated because tmux is not installed.',
    'dialog.openDirectory': 'Select a folder to start a session',
    'orphan.message': '{count} leftover tmux session(s) found.',
    'orphan.detail': 'These sessions remain from a previous run. Would you like to clean them up?',
    'orphan.btn.clean': 'Clean up',
    'orphan.btn.keep': 'Keep'
  },
  ko: {
    'close.tmux.btn.keep': '세션 유지하고 닫기',
    'close.tmux.btn.kill': '모두 종료하고 닫기',
    'close.tmux.btn.cancel': '취소',
    'close.tmux.message': '{count}개의 Claude 세션이 실행 중입니다.',
    'close.tmux.detail': '세션을 유지하면 앱을 다시 열 때 자동으로 복원됩니다.',
    'close.legacy.btn.quit': '종료',
    'close.legacy.btn.cancel': '취소',
    'close.legacy.message': '{count}개의 Claude 세션이 실행 중입니다.',
    'close.legacy.detail': 'tmux가 설치되어 있지 않아 모든 세션이 종료됩니다.',
    'dialog.openDirectory': '세션을 시작할 폴더를 선택하세요',
    'orphan.message': '미연결 tmux 세션 {count}개가 발견되었습니다.',
    'orphan.detail': '이전 실행에서 남은 세션입니다. 정리하시겠습니까?',
    'orphan.btn.clean': '정리',
    'orphan.btn.keep': '유지'
  },
  ja: {
    'close.tmux.btn.keep': 'セッションを維持して閉じる',
    'close.tmux.btn.kill': 'すべて終了して閉じる',
    'close.tmux.btn.cancel': 'キャンセル',
    'close.tmux.message': '{count}個のClaudeセッションが実行中です。',
    'close.tmux.detail': 'セッションを維持すると、アプリを再度開いたときに自動的に復元されます。',
    'close.legacy.btn.quit': '終了',
    'close.legacy.btn.cancel': 'キャンセル',
    'close.legacy.message': '{count}個のClaudeセッションが実行中です。',
    'close.legacy.detail': 'tmuxがインストールされていないため、すべてのセッションが終了します。',
    'dialog.openDirectory': 'セッションを開始するフォルダを選択してください',
    'orphan.message': '未接続のtmuxセッションが{count}個見つかりました。',
    'orphan.detail': '以前の実行で残ったセッションです。クリーンアップしますか？',
    'orphan.btn.clean': 'クリーンアップ',
    'orphan.btn.keep': '保持'
  },
  zh: {
    'close.tmux.btn.keep': '保留会话并关闭',
    'close.tmux.btn.kill': '全部终止并关闭',
    'close.tmux.btn.cancel': '取消',
    'close.tmux.message': '{count}个Claude会话正在运行。',
    'close.tmux.detail': '保留的会话将在您重新打开应用时自动恢复。',
    'close.legacy.btn.quit': '退出',
    'close.legacy.btn.cancel': '取消',
    'close.legacy.message': '{count}个Claude会话正在运行。',
    'close.legacy.detail': '由于未安装tmux，所有会话将被终止。',
    'dialog.openDirectory': '请选择要启动会话的文件夹',
    'orphan.message': '发现{count}个未连接的tmux会话。',
    'orphan.detail': '这些是上次运行遗留的会话。是否清理？',
    'orphan.btn.clean': '清理',
    'orphan.btn.keep': '保留'
  }
}

/** 현재 locale */
let currentLocale: MainLocale = 'en'

/**
 * 다이얼로그 번역 함수
 *
 * @param key - 번역 키 (예: 'close.tmux.btn.keep')
 * @param vars - 치환 변수 (예: { count: 3 })
 * @returns 번역된 문자열
 */
export function dt(key: string, vars?: Record<string, string | number>): string {
  let text = dialogI18n[currentLocale]?.[key] ?? dialogI18n['en'][key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v))
    }
  }
  return text
}

/**
 * locale을 변경합니다.
 *
 * @param locale - 새 locale (en/ko/ja/zh)
 */
export function setLocale(locale: string): void {
  if (locale in dialogI18n) {
    currentLocale = locale as MainLocale
  }
}

/** 앱 종료 시 세션 처리 방식 (close 다이얼로그에서 결정됨) */
let closeAction: 'keep' | 'kill' | null = null

/**
 * 마지막으로 결정된 closeAction을 반환합니다.
 * window-all-closed 핸들러에서 세션 처리 방식을 결정할 때 사용합니다.
 */
export function getCloseAction(): 'keep' | 'kill' | null {
  return closeAction
}

/**
 * closeAction을 초기화합니다.
 * window-all-closed 핸들러에서 처리 후 호출합니다.
 */
export function resetCloseAction(): void {
  closeAction = null
}

/**
 * 창 닫기 이벤트에 다이얼로그를 연결합니다.
 *
 * 활성 세션이 있고 tmux 모드일 때:
 *   - "세션 유지하고 닫기" -> detachAll() (tmux 세션 보존)
 *   - "모두 종료하고 닫기" -> destroyAll() (tmux 세션 kill)
 *   - "취소" -> 닫기 취소
 *
 * 세션이 없거나 legacy 모드면 바로 닫습니다.
 */
export function setupCloseHandler(
  mainWindow: BrowserWindow,
  sessionManager: SessionManager
): void {
  mainWindow.on('close', (e) => {
    const sessions = sessionManager.getSessionList()
    const tmuxStatus = sessionManager.checkTmux()

    // 세션 없으면 바로 닫기
    if (sessions.length === 0) {
      closeAction = 'kill'
      return
    }

    // 이미 결정된 상태면 (다이얼로그 후 재호출) 바로 진행
    if (closeAction !== null) return

    // tmux 모드: 3-버튼 다이얼로그
    if (tmuxStatus.available) {
      e.preventDefault()
      const count = sessions.length
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [
          dt('close.tmux.btn.keep'),
          dt('close.tmux.btn.kill'),
          dt('close.tmux.btn.cancel')
        ],
        defaultId: 0,
        cancelId: 2,
        title: 'Mulaude',
        message: dt('close.tmux.message', { count }),
        detail: dt('close.tmux.detail')
      }).then(({ response }) => {
        if (response === 0) {
          // 세션 유지하고 닫기
          closeAction = 'keep'
          mainWindow.close()
        } else if (response === 1) {
          // 모두 종료하고 닫기
          closeAction = 'kill'
          mainWindow.close()
        }
        // response === 2 -> 취소, 아무 것도 안 함
      }).catch(() => {
        // 다이얼로그 표시 실패 시 세션 유지하고 닫기
        closeAction = 'keep'
        mainWindow.close()
      })
    } else {
      // legacy 모드: 확인 다이얼로그
      e.preventDefault()
      const count = sessions.length
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: [
          dt('close.legacy.btn.quit'),
          dt('close.legacy.btn.cancel')
        ],
        defaultId: 0,
        cancelId: 1,
        title: 'Mulaude',
        message: dt('close.legacy.message', { count }),
        detail: dt('close.legacy.detail')
      }).then(({ response }) => {
        if (response === 0) {
          closeAction = 'kill'
          mainWindow.close()
        }
      }).catch(() => {
        // 다이얼로그 표시 실패 시 종료 진행
        closeAction = 'kill'
        mainWindow.close()
      })
    }
  })
}

/**
 * 고아 tmux 세션 정리 확인 다이얼로그를 표시합니다.
 *
 * @param mainWindow - 다이얼로그의 부모 윈도우
 * @param count - 발견된 고아 세션 수
 * @returns 사용자 선택 ('clean' 또는 'keep')
 */
export async function showOrphanDialog(
  mainWindow: BrowserWindow,
  count: number
): Promise<'clean' | 'keep'> {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: [
      dt('orphan.btn.clean'),
      dt('orphan.btn.keep')
    ],
    defaultId: 0,
    cancelId: 1,
    title: 'Mulaude',
    message: dt('orphan.message', { count }),
    detail: dt('orphan.detail')
  })
  return response === 0 ? 'clean' : 'keep'
}
