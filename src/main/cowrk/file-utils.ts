/**
 * 파일 유틸리티
 *
 * JSON 원자적 쓰기, NDJSON append, 텍스트 읽기/쓰기 등
 * 에이전트 저장소에서 공통으로 사용합니다.
 */

import { mkdir, readFile, writeFile, rename, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** mkdir -p */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/** JSON 파일 읽기 (파일 없거나 파싱 실패 시 fallback 반환) */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** JSON 원자적 쓰기 (tmp 파일 → rename) */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const dir = dirname(path)
  await ensureDir(dir)
  const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  await rename(tmp, path)
}

/** NDJSON 한 줄 추가 */
export async function appendLine(path: string, line: string): Promise<void> {
  await ensureDir(dirname(path))
  await appendFile(path, line + '\n', 'utf-8')
}

/** 파일에서 마지막 N줄 읽기 (limit 미지정 시 전체) */
export async function readLines(path: string, limit?: number): Promise<string[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter(Boolean)
  if (limit === undefined) return lines
  return lines.slice(-limit)
}

/** 텍스트 파일 읽기 (파일 없으면 null) */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

/** 텍스트 파일 쓰기 (부모 디렉토리 자동 생성) */
export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, content, 'utf-8')
}
