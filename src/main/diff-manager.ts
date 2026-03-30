/**
 * diff-manager — git diff HEAD 실행 + unified diff 파서
 *
 * 세션별로 diff 패널이 열려있는지 추적하고,
 * PostToolUse(Edit/Write) 이벤트 시 자동으로 diff를 재요청합니다.
 */

import { execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import type { DiffFile, DiffHunk, DiffLine } from '../shared/types'

/** auto-refresh 대상 세션 + workingDir */
const activeSessions = new Map<string, string>()

/** debounce 타이머 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * git diff HEAD 실행 → DiffFile[] 파싱 → 렌더러에 전송
 */
export function fetchDiff(sessionId: string, workingDir: string): Promise<DiffFile[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['diff', 'HEAD', '--unified=3', '--no-color'],
      { cwd: workingDir, maxBuffer: 10 * 1024 * 1024, timeout: 10000 },
      (err, stdout) => {
        if (err) {
          // git 저장소가 아니거나 HEAD가 없는 경우 빈 배열 반환
          resolve([])
          return
        }
        const files = parseUnifiedDiff(stdout)
        // 결과를 렌더러에 전송
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send('diff:result', sessionId, files)
          }
        }
        resolve(files)
      }
    )
  })
}

/**
 * unified diff 출력을 DiffFile[]로 파싱
 */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return []

  const files: DiffFile[] = []
  const lines = raw.split('\n')
  let i = 0

  while (i < lines.length) {
    // diff --git a/... b/... 라인 찾기
    if (!lines[i].startsWith('diff --git ')) {
      i++
      continue
    }

    const diffLine = lines[i]
    i++

    // 파일 경로 추출
    let path = ''
    let oldPath: string | undefined
    let status: DiffFile['status'] = 'modified'

    // diff --git a/path b/path 형태에서 경로 추출
    const gitMatch = diffLine.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitMatch) {
      oldPath = gitMatch[1]
      path = gitMatch[2]
    }

    // 메타데이터 라인 파싱 (new file, deleted, rename 등)
    while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@')) {
      const line = lines[i]
      if (line.startsWith('new file mode')) {
        status = 'added'
      } else if (line.startsWith('deleted file mode')) {
        status = 'deleted'
      } else if (line.startsWith('rename from')) {
        status = 'renamed'
      } else if (line.startsWith('--- /dev/null')) {
        status = 'added'
      } else if (line.startsWith('+++ /dev/null')) {
        status = 'deleted'
      }
      i++
    }

    // renamed인 경우 oldPath 유지, 아니면 undefined
    if (status !== 'renamed') {
      oldPath = undefined
    }

    // hunks 파싱
    const hunks: DiffHunk[] = []
    let additions = 0
    let deletions = 0

    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      if (lines[i].startsWith('@@')) {
        const hunk = parseHunk(lines, i)
        hunks.push(hunk.hunk)
        additions += hunk.additions
        deletions += hunk.deletions
        i = hunk.nextIndex
      } else {
        i++
      }
    }

    files.push({ path, status, oldPath, additions, deletions, hunks })
  }

  return files
}

/**
 * @@ 라인부터 시작하는 하나의 hunk 파싱
 */
function parseHunk(lines: string[], startIndex: number): {
  hunk: DiffHunk
  additions: number
  deletions: number
  nextIndex: number
} {
  const header = lines[startIndex]
  // @@ -oldStart,oldLines +newStart,newLines @@
  const match = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  const oldStart = match ? parseInt(match[1], 10) : 1
  const oldLines = match ? parseInt(match[2] ?? '1', 10) : 1
  const newStart = match ? parseInt(match[3], 10) : 1
  const newLines = match ? parseInt(match[4] ?? '1', 10) : 1

  const diffLines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  let oldLineNo = oldStart
  let newLineNo = newStart
  let i = startIndex + 1

  while (i < lines.length) {
    const line = lines[i]

    // 다음 hunk 또는 다음 파일
    if (line.startsWith('@@') || line.startsWith('diff --git ')) break

    // \ No newline at end of file
    if (line.startsWith('\\ ')) {
      i++
      continue
    }

    if (line.startsWith('+')) {
      diffLines.push({ type: 'add', content: line.slice(1), newLineNo })
      newLineNo++
      additions++
    } else if (line.startsWith('-')) {
      diffLines.push({ type: 'delete', content: line.slice(1), oldLineNo })
      oldLineNo++
      deletions++
    } else {
      // context line (starts with ' ' or is empty for trailing newlines)
      diffLines.push({ type: 'context', content: line.slice(1), oldLineNo, newLineNo })
      oldLineNo++
      newLineNo++
    }

    i++
  }

  return {
    hunk: { header, oldStart, oldLines, newStart, newLines, lines: diffLines },
    additions,
    deletions,
    nextIndex: i
  }
}

/**
 * auto-refresh 대상으로 등록
 */
export function registerDiffSession(sessionId: string, workingDir: string): void {
  activeSessions.set(sessionId, workingDir)
}

/**
 * auto-refresh 대상에서 해제
 */
export function unregisterDiffSession(sessionId: string): void {
  activeSessions.delete(sessionId)
  const timer = debounceTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(sessionId)
  }
}

/**
 * 해당 세션이 diff 패널이 열려있는지 확인
 */
export function isDiffActive(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}

/**
 * PostToolUse(Edit/Write) 이벤트 시 호출 — debounced re-fetch
 */
export function debouncedRefresh(sessionId: string, debounceMs: number): void {
  const workingDir = activeSessions.get(sessionId)
  if (!workingDir) return

  const existing = debounceTimers.get(sessionId)
  if (existing) clearTimeout(existing)

  debounceTimers.set(sessionId, setTimeout(() => {
    debounceTimers.delete(sessionId)
    fetchDiff(sessionId, workingDir)
  }, debounceMs))
}

/**
 * 앱 종료 시 정리
 */
export function cleanupAllDiffs(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()
  activeSessions.clear()
}
