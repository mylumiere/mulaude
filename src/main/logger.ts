/**
 * Logger — 파일 기반 로깅 모듈
 *
 * ~/.mulaude/app.log 에 타임스탬프 + 레벨 + 모듈 형식으로 기록합니다.
 * 앱 크래시 시 사용자가 로그 파일을 제보에 첨부할 수 있도록 합니다.
 *
 * 로그 로테이션: 앱 시작 시 10MB 초과하면 .old로 이동
 */

import { appendFileSync, statSync, renameSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LOG_DIR = join(homedir(), '.mulaude')
const LOG_FILE = join(LOG_DIR, 'app.log')
const LOG_OLD = join(LOG_DIR, 'app.log.old')
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** 로그 디렉토리 초기화 + 로테이션 */
function init(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    // .old 파일이 존재하면 먼저 삭제 (무한 누적 방지)
    try { unlinkSync(LOG_OLD) } catch { /* 없으면 무시 */ }
    const stats = statSync(LOG_FILE)
    if (stats.size > MAX_SIZE) {
      try { renameSync(LOG_FILE, LOG_OLD) } catch { /* ignore */ }
    }
  } catch {
    // 파일 없으면 무시
  }
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function write(level: LogLevel, module: string, message: string, error?: unknown): void {
  const timestamp = formatTimestamp()
  let line = `${timestamp} [${level}] [${module}] ${message}`
  if (error) {
    if (error instanceof Error) {
      line += `\n  Error: ${error.message}`
      if (error.stack) line += `\n  Stack: ${error.stack}`
    } else {
      line += `\n  Detail: ${String(error)}`
    }
  }
  line += '\n'

  // 콘솔 출력 (개발 시 확인용)
  if (level === 'ERROR') {
    console.error(`[${module}]`, message, error || '')
  } else if (level === 'WARN') {
    console.warn(`[${module}]`, message)
  } else {
    console.log(`[${module}]`, message)
  }

  // 파일 기록
  try {
    appendFileSync(LOG_FILE, line, 'utf-8')
  } catch {
    // 파일 쓰기 실패 — 무시 (콘솔에는 이미 출력됨)
  }
}

export const logger = {
  debug: (module: string, message: string): void => write('DEBUG', module, message),
  info: (module: string, message: string): void => write('INFO', module, message),
  warn: (module: string, message: string, error?: unknown): void => write('WARN', module, message, error),
  error: (module: string, message: string, error?: unknown): void => write('ERROR', module, message, error),

  /** 로그 파일 경로 반환 */
  getLogPath: (): string => LOG_FILE,

  /** 앱 시작 시 호출 — 초기화 + 세션 구분선 */
  init: (): void => {
    init()
    const sep = `\n${'='.repeat(60)}\n${formatTimestamp()} APP START (PID: ${process.pid})\n${'='.repeat(60)}\n`
    try {
      appendFileSync(LOG_FILE, sep, 'utf-8')
    } catch {
      try {
        writeFileSync(LOG_FILE, sep, 'utf-8')
      } catch { /* 완전히 실패 */ }
    }
  }
}
