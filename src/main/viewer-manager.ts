/**
 * viewer-manager — 파일 뷰어 (마크다운 렌더 + 이미지 표시)
 *
 * 세션별로 뷰어 패널이 열려있는지 추적하고,
 * PostToolUse(Edit/Write) 이벤트 시 자동으로 파일을 재로드합니다.
 * diff-manager.ts와 동일한 패턴.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import { BrowserWindow } from 'electron'
import type { ViewerContent } from '../shared/types'

/** 지원 확장자 */
const MARKDOWN_EXTS = new Set(['.md', '.mdx'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])

/** MIME 타입 매핑 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

/** auto-refresh 대상 세션 + workingDir */
const activeSessions = new Map<string, string>()

/** 세션별 마지막 표시 파일 경로 */
const lastFilePaths = new Map<string, string>()

/** debounce 타이머 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 확장자가 뷰어에서 지원되는지 확인
 */
export function isViewerSupported(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return MARKDOWN_EXTS.has(ext) || IMAGE_EXTS.has(ext)
}

/**
 * 파일 읽기 → ViewerContent 생성 → 렌더러에 전송
 */
export async function fetchViewerContent(
  sessionId: string,
  filePath: string
): Promise<ViewerContent | null> {
  const ext = extname(filePath).toLowerCase()

  try {
    let content: ViewerContent

    if (MARKDOWN_EXTS.has(ext)) {
      const data = await readFile(filePath, 'utf-8')
      content = { filePath, type: 'markdown', data }
    } else if (IMAGE_EXTS.has(ext)) {
      const buffer = await readFile(filePath)
      const mime = MIME_MAP[ext] || 'application/octet-stream'
      const data = `data:${mime};base64,${buffer.toString('base64')}`
      content = { filePath, type: 'image', data }
    } else {
      return null
    }

    // 마지막 파일 경로 기록
    lastFilePaths.set(sessionId, filePath)

    // 결과를 렌더러에 전송
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('viewer:result', sessionId, content)
      }
    }

    return content
  } catch {
    return null
  }
}

/**
 * auto-refresh 대상으로 등록
 */
export function registerViewerSession(sessionId: string, workingDir: string): void {
  activeSessions.set(sessionId, workingDir)
}

/**
 * auto-refresh 대상에서 해제
 */
export function unregisterViewerSession(sessionId: string): void {
  activeSessions.delete(sessionId)
  lastFilePaths.delete(sessionId)
  const timer = debounceTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(sessionId)
  }
}

/**
 * 해당 세션이 뷰어 패널이 열려있는지 확인
 */
export function isViewerActive(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}

/**
 * PostToolUse(Edit/Write) 이벤트 시 호출 — 지원 파일이면 debounced re-fetch
 */
export function viewerOnFileChange(sessionId: string, filePath: string, debounceMs: number): void {
  if (!activeSessions.has(sessionId)) return

  // 지원 타입이면 해당 파일로 fetch, 아니면 무시
  if (!isViewerSupported(filePath)) return

  const existing = debounceTimers.get(sessionId)
  if (existing) clearTimeout(existing)

  debounceTimers.set(sessionId, setTimeout(() => {
    debounceTimers.delete(sessionId)
    fetchViewerContent(sessionId, filePath)
  }, debounceMs))
}

/**
 * 앱 종료 시 정리
 */
export function cleanupAllViewers(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()
  activeSessions.clear()
  lastFilePaths.clear()
}
