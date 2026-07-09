/**
 * bridge-manager — 세션 브릿지 (세션 간 위임)
 *
 * 세션 안에서 `mulaude ask <대상> "프롬프트"` CLI로 다른 세션에 작업을
 * 위임하고 응답을 회수하는 오케스트레이션 프리미티브.
 *
 * 동작 흐름:
 *   1. CLI(~/.mulaude/bin/mulaude)가 $MULAUDE_IPC_DIR/bridge/req-<id>/ 에
 *      요청 파일(type/target/prompt/from/timeout)을 기록
 *   2. fs.watch가 요청 감지 → 대상 세션 해석 (id → 이름 → 프로젝트명, @cli 필터)
 *   3. tmux paste-buffer(-p 브래킷 페이스트)로 대상 pane에 프롬프트 주입 + Enter
 *      (send-keys -l은 프롬프트 내 개행이 조기 제출을 유발하므로 페이스트 사용)
 *   4. 대상 세션의 Stop 훅으로 턴 완료 감지 (busy 추적도 같은 이벤트 스트림)
 *   5. 세션 히스토리에서 응답 추출:
 *      - claude: ~/.claude/projects/<cwd-slug>/<claudeSessionId>.jsonl 마지막 assistant 텍스트
 *      - codex:  ~/.codex/sessions/YYYY/MM/DD/rollout-*-<sessionId>.jsonl 마지막 task_complete.last_agent_message
 *      - 실패 시 tmux capture-pane 폴백 ([raw-capture] 마킹)
 *   6. res-<id>/ 에 output/status 기록 → done 마커 → CLI가 폴링해 출력
 *
 * 요청/응답을 JSON이 아닌 디렉토리+원시 파일로 주고받는 이유:
 * 프롬프트에 임의 텍스트(따옴표/개행/유니코드)가 들어와도 이스케이프가 필요 없음.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  watch,
  rmSync,
  renameSync,
  readdirSync,
  unlinkSync,
  chmodSync
} from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { SessionManager } from './session-manager'
import type { HookEvent, CliType, BridgeDelegationInfo } from '../shared/types'
import { execTmuxAsync, captureTmuxPaneAsync } from './tmux-utils'

/** 위임 기본 타임아웃 (초) — CLI --timeout으로 재정의 가능 */
const BRIDGE_DEFAULT_TIMEOUT_SEC = 600
/** 페이스트 후 Enter 전 대기 (ms) — TUI가 페이스트를 처리할 시간 */
const BRIDGE_PASTE_DELAY = 300
/** Stop 훅 후 히스토리 flush 대기 (ms) */
const BRIDGE_SETTLE_DELAY = 800
/** 폴백 캡처 라인 수 */
const BRIDGE_CAPTURE_LINES = 80

type DelegationListener = (info: BridgeDelegationInfo) => void
type RoleListener = (sessionId: string, role: string) => void

/** 대상 해석 결과 */
interface ResolvedTarget {
  id: string
  name: string
  workingDir: string
  tmuxSessionName?: string
  cliType: CliType
  claudeSessionId?: string
  role?: string
}

export class BridgeManager {
  private bridgeDir: string
  private watcher: ReturnType<typeof watch> | null = null
  private processed = new Set<string>()
  /** 세션별 작업 중 여부 (훅 이벤트 기반) */
  private working = new Map<string, boolean>()
  /** Stop 대기자 (위임 완료 감지) */
  private stopWaiters = new Map<string, Array<() => void>>()
  /** 대상별 진행 중 위임 (동일 대상 중복 방지) */
  private activeByTarget = new Set<string>()
  private listeners: DelegationListener[] = []
  private roleListeners: RoleListener[] = []

  constructor(
    private sessionManager: SessionManager,
    ipcDir: string
  ) {
    this.bridgeDir = join(ipcDir, 'bridge')
  }

  /** CLI 설치 + 요청 감시 시작 */
  install(): void {
    mkdirSync(this.bridgeDir, { recursive: true })
    this.installCli()
    this.startWatching()
    // 앱 재시작 등으로 남은 요청 정리 (응답 못 받는 고아 요청 방지)
    this.sweepStale()
  }

  /** 위임 상태 변화 리스너 등록 (2단계 시각화) */
  onDelegation(cb: DelegationListener): void {
    this.listeners.push(cb)
  }

  /** 역할 라벨 변경 리스너 등록 (사이드바 실시간 반영) */
  onRoleUpdated(cb: RoleListener): void {
    this.roleListeners.push(cb)
  }

  /**
   * 훅 이벤트 수신 — index.ts의 hooksManager.onEvent에서 호출.
   * busy 추적 + Stop 대기자 해소.
   */
  onHookEvent(mulaudeSessionId: string, event: HookEvent): void {
    const name = event.hook_event_name
    if (name === 'UserPromptSubmit' || name === 'PreToolUse' || name === 'PostToolUse') {
      this.working.set(mulaudeSessionId, true)
      return
    }
    if (name === 'Stop') {
      // 자식 에이전트 Stop 무시: 영속화된 부모 claudeSessionId와 비교
      const persisted = this.sessionManager
        .getSessionStore()
        .getAllSessions()
        .find((s) => s.id === mulaudeSessionId)
      if (
        event.session_id &&
        persisted?.claudeSessionId &&
        event.session_id !== persisted.claudeSessionId
      ) {
        return
      }
      this.working.set(mulaudeSessionId, false)
      const waiters = this.stopWaiters.get(mulaudeSessionId)
      if (waiters?.length) {
        this.stopWaiters.set(mulaudeSessionId, [])
        for (const w of waiters) w()
      }
    }
  }

  cleanup(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    this.processed.clear()
    this.listeners.length = 0
    try {
      rmSync(this.bridgeDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  /* ─────────── CLI 설치 ─────────── */

  /**
   * ~/.mulaude/bin/mulaude 설치.
   * 세션 초기화 시 PATH에 ~/.mulaude/bin이 추가되므로 `mulaude`로 바로 호출 가능.
   * MULAUDE_IPC_DIR 없으면 안내 후 종료 (Mulaude 밖에서 무해).
   */
  private installCli(): void {
    const binDir = join(homedir(), '.mulaude', 'bin')
    mkdirSync(binDir, { recursive: true })
    const cliPath = join(binDir, 'mulaude')

    const script = [
      '#!/bin/bash',
      '# mulaude — Mulaude 세션 브릿지 CLI (bridge-manager가 자동 설치/갱신)',
      '# 세션 안에서 다른 세션에 작업을 위임하거나 세션 목록을 조회합니다.',
      'set -u',
      'if [ -z "${MULAUDE_IPC_DIR:-}" ]; then',
      '  echo "mulaude: not inside a Mulaude session (MULAUDE_IPC_DIR unset)" >&2',
      '  exit 2',
      'fi',
      '# 앱 재시작으로 env의 IPC 디렉토리가 사라진 경우: 포인터 파일에서 현재 경로 재해석',
      'if [ ! -d "$MULAUDE_IPC_DIR" ]; then',
      '  MULAUDE_IPC_DIR=$(cat "$HOME/.mulaude/ipc-current" 2>/dev/null || true)',
      '  if [ -z "$MULAUDE_IPC_DIR" ] || [ ! -d "$MULAUDE_IPC_DIR" ]; then',
      '    echo "mulaude: Mulaude app is not running (IPC dir not found)" >&2',
      '    exit 2',
      '  fi',
      'fi',
      'BRIDGE="$MULAUDE_IPC_DIR/bridge"',
      'mkdir -p "$BRIDGE"',
      '',
      'usage() {',
      // heredoc 구분자를 인용해 내용 내 백틱/변수 확장 방지
      "  cat <<'EOF'",
      'Usage:',
      '  mulaude sessions                              List sessions (id, name, cli, role, state)',
      '  mulaude ask [--timeout SEC] <target> <prompt> Delegate a prompt to another session and wait',
      '  mulaude role <target> [label]                 Set a role label on a session (empty = clear)',
      '  mulaude guide                                 How to orchestrate sessions (for AI conductors)',
      '',
      'Target: session id (session-3), session name, or project dir name.',
      '        Append @claude / @codex to disambiguate (e.g. kdp@codex).',
      'Prompt: remaining args, or stdin when piped.',
      'EOF',
      '}',
      '',
      'guide() {',
      // heredoc 구분자를 인용해 내용 내 백틱(`mulaude sessions` 등)의 명령 치환 방지
      "  cat <<'EOF'",
      '# Mulaude Session Bridge — orchestration guide',
      '',
      'You are inside a Mulaude session. Other AI sessions (Claude Code / Codex) run',
      'side by side, and you can delegate work to them and read their answers.',
      '',
      '## Discover sessions',
      '  mulaude sessions',
      '  # → ID / NAME / CLI / ROLE / STATE(idle|busy|delegating) / PROJECT',
      '',
      '## Delegate and wait for the answer (blocking, default timeout 600s)',
      '  mulaude ask <target> "Review this diff for correctness issues: ..."',
      '  mulaude ask --timeout 120 kdp@codex "Verify the fix in src/foo.ts"',
      '  cat notes.md | mulaude ask session-3   # prompt from stdin',
      '',
      '## Parallel delegation (different targets only — same target rejects)',
      '  mulaude ask reviewer "task A" > /tmp/a.out 2>&1 &',
      '  mulaude ask tester   "task B" > /tmp/b.out 2>&1 &',
      '  wait; cat /tmp/a.out /tmp/b.out',
      '',
      '## Roles (label sessions so targets are self-describing)',
      '  mulaude role kdp@codex "verification"',
      '',
      '## Rules of thumb',
      '- Busy targets are rejected — check STATE via `mulaude sessions` first.',
      '- The delegated session keeps its own context; repeated asks accumulate knowledge.',
      '- Prompts are injected as if typed by the user; responses come from session history.',
      '- Give self-contained prompts: the target cannot see your conversation.',
      'EOF',
      '}',
      '',
      'request() { # $1=type $2=target $3=prompt $4=timeoutSec',
      '  local id="$$-$RANDOM-$(date +%s)"',
      '  local tmp="$BRIDGE/.tmp-$id" req="$BRIDGE/req-$id" res="$BRIDGE/res-$id"',
      '  mkdir -p "$tmp"',
      '  printf %s "$1" > "$tmp/type"',
      '  printf %s "$2" > "$tmp/target"',
      '  printf %s "$3" > "$tmp/prompt"',
      '  printf %s "${MULAUDE_SESSION_ID:-}" > "$tmp/from"',
      '  printf %s "$4" > "$tmp/timeout"',
      '  mv "$tmp" "$req"',
      '  local ticks=0 limit=$(( ($4 + 20) * 5 ))',
      '  while [ ! -f "$res/done" ]; do',
      '    sleep 0.2',
      '    ticks=$((ticks + 1))',
      '    if [ "$ticks" -ge "$limit" ]; then',
      '      echo "mulaude: timed out waiting for response" >&2',
      '      rm -rf "$req" "$res" 2>/dev/null',
      '      exit 1',
      '    fi',
      '  done',
      '  local status',
      '  status=$(cat "$res/status" 2>/dev/null || echo error)',
      '  if [ "$status" = "ok" ]; then',
      '    cat "$res/output" 2>/dev/null',
      '  else',
      '    cat "$res/output" >&2 2>/dev/null',
      '  fi',
      '  rm -rf "$res" 2>/dev/null',
      '  [ "$status" = "ok" ]',
      '}',
      '',
      'CMD="${1:-help}"',
      'shift 2>/dev/null || true',
      'case "$CMD" in',
      '  sessions)',
      '    request sessions "" "" 30',
      '    ;;',
      '  ask)',
      '    TIMEOUT=' + String(BRIDGE_DEFAULT_TIMEOUT_SEC),
      '    if [ "${1:-}" = "--timeout" ]; then',
      '      TIMEOUT="${2:?--timeout needs seconds}"',
      '      shift 2',
      '    fi',
      '    TARGET="${1:?usage: mulaude ask [--timeout SEC] <target> <prompt>}"',
      '    shift',
      '    if [ "$#" -gt 0 ]; then PROMPT="$*"; else PROMPT=$(cat); fi',
      '    if [ -z "$PROMPT" ]; then',
      '      echo "mulaude: empty prompt" >&2',
      '      exit 2',
      '    fi',
      '    request ask "$TARGET" "$PROMPT" "$TIMEOUT"',
      '    ;;',
      '  role)',
      '    TARGET="${1:?usage: mulaude role <target> [label]}"',
      '    shift',
      '    request role "$TARGET" "${*:-}" 30',
      '    ;;',
      '  guide)',
      '    guide',
      '    ;;',
      '  help|--help|-h)',
      '    usage',
      '    ;;',
      '  *)',
      '    echo "mulaude: unknown command: $CMD" >&2',
      '    usage >&2',
      '    exit 2',
      '    ;;',
      'esac',
      ''
    ].join('\n')

    writeFileSync(cliPath, script, 'utf-8')
    try {
      chmodSync(cliPath, '755')
    } catch (err) {
      console.warn('[BridgeManager] Failed to chmod CLI:', err)
    }
    console.log('[BridgeManager] CLI installed:', cliPath)
  }

  /* ─────────── 요청 감시 ─────────── */

  private startWatching(): void {
    this.watcher = watch(this.bridgeDir, (_eventType, filename) => {
      if (!filename || !filename.startsWith('req-')) return
      if (this.processed.has(filename)) return
      this.processed.add(filename)
      const dir = join(this.bridgeDir, filename)
      // mv 완료 직후 처리 (파일들은 이미 tmp 디렉토리에 완성된 상태)
      setTimeout(() => {
        this.processRequest(dir).catch((err) => {
          console.error('[BridgeManager] request processing failed:', err)
        })
        // 재사용 방지 셋 정리 (요청 id는 매번 고유하므로 짧게 유지)
        setTimeout(() => this.processed.delete(filename), 60_000)
      }, 20)
    })
    console.log('[BridgeManager] watching:', this.bridgeDir)
  }

  /** 앱 시작 시 남은 요청/응답 디렉토리 정리 */
  private sweepStale(): void {
    try {
      for (const entry of readdirSync(this.bridgeDir)) {
        if (entry.startsWith('req-') || entry.startsWith('res-') || entry.startsWith('.')) {
          rmSync(join(this.bridgeDir, entry), { recursive: true, force: true })
        }
      }
    } catch {
      /* ignore */
    }
  }

  private async processRequest(dir: string): Promise<void> {
    const read = (f: string): string => {
      try {
        return readFileSync(join(dir, f), 'utf-8')
      } catch {
        return ''
      }
    }
    const id = basename(dir).replace(/^req-/, '')
    const type = read('type').trim()
    const target = read('target').trim()
    const prompt = read('prompt')
    const from = read('from').trim()
    const timeoutSec = parseInt(read('timeout').trim(), 10) || BRIDGE_DEFAULT_TIMEOUT_SEC
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    console.log(`[BridgeManager] request ${id}: type=${type} target=${target} from=${from}`)

    if (type === 'sessions') {
      this.respond(id, 'ok', this.renderSessionList(from))
      return
    }
    if (type === 'ask') {
      await this.handleAsk(id, target, prompt, from, timeoutSec * 1000)
      return
    }
    if (type === 'role') {
      this.handleRole(id, target, prompt.trim())
      return
    }
    this.respond(id, 'error', `unknown request type: ${type}`)
  }

  /* ─────────── 응답 기록 ─────────── */

  private respond(id: string, status: 'ok' | 'error', output: string): void {
    try {
      const tmp = join(this.bridgeDir, `.res-tmp-${id}`)
      mkdirSync(tmp, { recursive: true })
      writeFileSync(join(tmp, 'output'), output, 'utf-8')
      writeFileSync(join(tmp, 'status'), status, 'utf-8')
      const resDir = join(this.bridgeDir, `res-${id}`)
      renameSync(tmp, resDir)
      // done 마커는 내용 기록 후 마지막에 (CLI 폴링 순서 보장)
      writeFileSync(join(resDir, 'done'), '1', 'utf-8')
    } catch (err) {
      console.error('[BridgeManager] respond failed:', err)
    }
  }

  /* ─────────── 세션 목록 ─────────── */

  private renderSessionList(fromId: string): string {
    const targets = this.getTargets()
    if (targets.length === 0) return '(no live sessions)'

    const rows = targets.map((t) => ({
      id: t.id,
      name: t.name,
      cli: t.cliType,
      role: t.role ?? '-',
      state: this.activeByTarget.has(t.id)
        ? 'delegating'
        : this.working.get(t.id)
          ? 'busy'
          : 'idle',
      project: t.workingDir + (t.id === fromId ? '  (self)' : '')
    }))
    const w = (k: 'id' | 'name' | 'cli' | 'role' | 'state'): number =>
      Math.max(k.length, ...rows.map((r) => r[k].length))
    const header =
      'ID'.padEnd(w('id')) +
      '  ' +
      'NAME'.padEnd(w('name')) +
      '  ' +
      'CLI'.padEnd(w('cli')) +
      '  ' +
      'ROLE'.padEnd(w('role')) +
      '  ' +
      'STATE'.padEnd(w('state')) +
      '  PROJECT'
    const lines = rows.map(
      (r) =>
        r.id.padEnd(w('id')) +
        '  ' +
        r.name.padEnd(w('name')) +
        '  ' +
        r.cli.padEnd(w('cli')) +
        '  ' +
        r.role.padEnd(w('role')) +
        '  ' +
        r.state.padEnd(w('state')) +
        '  ' +
        r.project
    )
    return [header, ...lines].join('\n')
  }

  /* ─────────── 역할 라벨 (role) ─────────── */

  private handleRole(id: string, selector: string, role: string): void {
    const resolved = this.resolveTarget(selector)
    if ('error' in resolved) {
      this.respond(id, 'error', resolved.error)
      return
    }
    const target = resolved.target
    this.sessionManager.getSessionStore().updateRole(target.id, role)
    for (const cb of this.roleListeners) {
      try {
        cb(target.id, role)
      } catch {
        /* ignore */
      }
    }
    this.respond(
      id,
      'ok',
      role ? `role set: ${target.name} (${target.id}) → "${role}"` : `role cleared: ${target.name} (${target.id})`
    )
  }

  /* ─────────── 위임 (ask) ─────────── */

  private async handleAsk(
    id: string,
    selector: string,
    prompt: string,
    fromId: string,
    timeoutMs: number
  ): Promise<void> {
    const resolved = this.resolveTarget(selector)
    if ('error' in resolved) {
      this.respond(id, 'error', resolved.error)
      return
    }
    const target = resolved.target

    if (target.id === fromId) {
      this.respond(id, 'error', 'cannot delegate to self')
      return
    }
    if (!target.tmuxSessionName) {
      this.respond(id, 'error', `target ${target.id} has no tmux session (legacy mode unsupported)`)
      return
    }
    if (this.activeByTarget.has(target.id)) {
      this.respond(id, 'error', `target ${target.name} (${target.id}) already has a delegation in progress`)
      return
    }
    if (this.working.get(target.id)) {
      this.respond(id, 'error', `target ${target.name} (${target.id}) is busy — try again when idle`)
      return
    }

    const fromName =
      this.getTargets().find((t) => t.id === fromId)?.name ?? (fromId || 'external')
    const preview = prompt.length > 80 ? prompt.slice(0, 80) + '…' : prompt

    this.activeByTarget.add(target.id)
    this.emit({
      id,
      fromSessionId: fromId,
      toSessionId: target.id,
      promptPreview: preview,
      status: 'started'
    })

    try {
      // Stop 대기자를 주입 전에 등록 (아주 빠른 응답 레이스 방지)
      const stopped = this.waitForStop(target.id, timeoutMs)
      await this.injectPrompt(target, prompt, fromName)

      if (!(await stopped)) {
        this.respond(id, 'error', `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${target.name}`)
        this.emit({
          id,
          fromSessionId: fromId,
          toSessionId: target.id,
          promptPreview: preview,
          status: 'error',
          error: 'timeout'
        })
        return
      }

      // 히스토리 파일 flush 대기
      await new Promise((r) => setTimeout(r, BRIDGE_SETTLE_DELAY))
      const output = await this.extractResponse(target)
      this.respond(id, 'ok', output)
      this.emit({
        id,
        fromSessionId: fromId,
        toSessionId: target.id,
        promptPreview: preview,
        status: 'done'
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.respond(id, 'error', `delegation failed: ${msg}`)
      this.emit({
        id,
        fromSessionId: fromId,
        toSessionId: target.id,
        promptPreview: preview,
        status: 'error',
        error: msg
      })
    } finally {
      this.activeByTarget.delete(target.id)
    }
  }

  /** 대상 셀렉터 해석: id 정확 → 이름 정확 → 프로젝트 디렉토리명. @claude/@codex 필터 지원 */
  private resolveTarget(
    selector: string
  ): { target: ResolvedTarget } | { error: string } {
    if (!selector) return { error: 'target is required' }

    const [raw, cliFilter] = selector.split('@')
    const targets = this.getTargets().filter(
      (t) => !cliFilter || t.cliType === cliFilter
    )
    if (targets.length === 0) {
      return { error: `no live sessions${cliFilter ? ` with cli "${cliFilter}"` : ''}` }
    }

    const lower = raw.toLowerCase()
    let matches = targets.filter((t) => t.id === raw)
    if (matches.length === 0) {
      matches = targets.filter((t) => t.name.toLowerCase() === lower)
    }
    if (matches.length === 0) {
      matches = targets.filter(
        (t) => basename(t.workingDir).toLowerCase() === lower
      )
    }
    if (matches.length === 0) {
      // 역할 라벨로도 매칭 — 지휘 세션이 "verification"처럼 역할명으로 위임 가능
      matches = targets.filter((t) => t.role?.toLowerCase() === lower)
    }

    if (matches.length === 0) {
      const available = targets.map((t) => `  ${t.id}  ${t.name} (${t.cliType})`).join('\n')
      return { error: `no session matches "${selector}". Available:\n${available}` }
    }
    if (matches.length > 1) {
      const list = matches.map((t) => `  ${t.id}  ${t.name} (${t.cliType})`).join('\n')
      return {
        error: `"${selector}" is ambiguous — use session id or @cli filter:\n${list}`
      }
    }
    return { target: matches[0] }
  }

  /** 라이브 세션 + 영속 메타데이터 조인 */
  private getTargets(): ResolvedTarget[] {
    const live = this.sessionManager.getSessionList()
    const store = this.sessionManager.getSessionStore().getAllSessions()
    const metaById = new Map(store.map((s) => [s.id, s]))
    return live.map((s) => {
      const meta = metaById.get(s.id)
      return {
        id: s.id,
        // 이름 변경은 store에 영속화되므로 store 우선
        name: meta?.name ?? s.name,
        workingDir: s.workingDir,
        tmuxSessionName: s.tmuxSessionName,
        cliType: (meta?.cliType ?? s.cliType ?? 'claude') as CliType,
        claudeSessionId: meta?.claudeSessionId,
        role: meta?.role
      }
    })
  }

  /** Stop 훅 대기 (타임아웃 시 false) */
  private waitForStop(sessionId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const waiters = this.stopWaiters.get(sessionId) ?? []
        this.stopWaiters.set(
          sessionId,
          waiters.filter((w) => w !== waiter)
        )
        resolve(false)
      }, timeoutMs)
      const waiter = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const waiters = this.stopWaiters.get(sessionId) ?? []
      waiters.push(waiter)
      this.stopWaiters.set(sessionId, waiters)
    })
  }

  /**
   * 대상 pane에 프롬프트 주입.
   * 브래킷 페이스트(-p)로 개행 포함 프롬프트도 조기 제출 없이 전달 후 Enter.
   */
  private async injectPrompt(
    target: ResolvedTarget,
    prompt: string,
    fromName: string
  ): Promise<void> {
    const tmuxPath = this.sessionManager.getTmuxPath()
    if (!tmuxPath) throw new Error('tmux not available')

    const paneTarget = `${target.tmuxSessionName}:0.0`
    const full = `[mulaude-bridge from ${fromName}] ${prompt}`

    // 버퍼 이름은 요청마다 고유해야 함 — 고정 이름을 쓰면 병렬 위임 시
    // load-buffer가 서로 덮어쓰고 -d 삭제로 늦은 paste가 빈손이 되는 레이스 발생
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const bufName = `mulaude-bridge-${suffix}`
    const tmpFile = join(this.bridgeDir, `.paste-${suffix}`)
    writeFileSync(tmpFile, full, 'utf-8')
    try {
      await execTmuxAsync(tmuxPath, ['load-buffer', '-b', bufName, tmpFile])
      await execTmuxAsync(tmuxPath, [
        'paste-buffer',
        '-p',
        '-d',
        '-b',
        bufName,
        '-t',
        paneTarget
      ])
    } finally {
      try {
        unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, BRIDGE_PASTE_DELAY))
    await execTmuxAsync(tmuxPath, ['send-keys', '-t', paneTarget, 'Enter'])
  }

  /* ─────────── 응답 추출 ─────────── */

  private async extractResponse(target: ResolvedTarget): Promise<string> {
    // claudeSessionId는 위임 도중 처음 기록될 수 있으므로(신규 세션의 첫 훅 이벤트)
    // resolve 시점 스냅샷 대신 최신 메타데이터로 갱신 후 추출
    const fresh = this.getTargets().find((t) => t.id === target.id) ?? target
    try {
      if (fresh.claudeSessionId) {
        const text =
          fresh.cliType === 'codex'
            ? this.extractCodexResponse(fresh.claudeSessionId)
            : this.extractClaudeResponse(fresh.workingDir, fresh.claudeSessionId)
        if (text) return text
      }
    } catch (err) {
      console.warn('[BridgeManager] history extraction failed, falling back to capture:', err)
    }
    return this.captureFallback(fresh)
  }

  /** claude 트랜스크립트에서 마지막 assistant 텍스트 추출 */
  private extractClaudeResponse(workingDir: string, claudeSessionId: string): string | null {
    const slug = workingDir.replace(/[^A-Za-z0-9]/g, '-')
    const file = join(homedir(), '.claude', 'projects', slug, `${claudeSessionId}.jsonl`)
    if (!existsSync(file)) return null

    let last: string | null = null
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.includes('"type":"assistant"')) continue
      try {
        const entry = JSON.parse(line) as {
          type?: string
          isSidechain?: boolean
          message?: { content?: Array<{ type?: string; text?: string }> }
        }
        if (entry.type !== 'assistant' || entry.isSidechain) continue
        const text = (entry.message?.content ?? [])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n')
        if (text.trim()) last = text
      } catch {
        /* 부분 기록 라인 무시 */
      }
    }
    return last
  }

  /** codex rollout에서 마지막 task_complete.last_agent_message 추출 */
  private extractCodexResponse(codexSessionId: string): string | null {
    const sessionsDir = join(homedir(), '.codex', 'sessions')
    if (!existsSync(sessionsDir)) return null

    // rollout-<ts>-<session_id>.jsonl — 연/월/일 하위 디렉토리 탐색
    const file = this.findRolloutFile(sessionsDir, codexSessionId)
    if (!file) return null

    let last: string | null = null
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      if (!line.includes('"task_complete"')) continue
      try {
        const entry = JSON.parse(line) as {
          payload?: { type?: string; last_agent_message?: string }
        }
        if (entry.payload?.type === 'task_complete' && entry.payload.last_agent_message) {
          last = entry.payload.last_agent_message
        }
      } catch {
        /* ignore */
      }
    }
    return last
  }

  /** ~/.codex/sessions/YYYY/MM/DD/ 를 최신순으로 훑어 세션 id가 포함된 rollout 파일 탐색 */
  private findRolloutFile(root: string, sessionId: string): string | null {
    const walk = (dir: string, depth: number): string | null => {
      let entries: string[]
      try {
        entries = readdirSync(dir).sort().reverse() // 최신(큰 값) 우선
      } catch {
        return null
      }
      for (const entry of entries) {
        const full = join(dir, entry)
        if (depth < 3) {
          const found = walk(full, depth + 1)
          if (found) return found
        } else if (entry.endsWith(`${sessionId}.jsonl`)) {
          return full
        }
      }
      return null
    }
    return walk(root, 0)
  }

  /** 히스토리 추출 실패 시 pane 캡처 폴백 */
  private async captureFallback(target: ResolvedTarget): Promise<string> {
    const tmuxPath = this.sessionManager.getTmuxPath()
    if (!tmuxPath || !target.tmuxSessionName) {
      return '[bridge] response extraction failed (no history, no capture)'
    }
    const text = await captureTmuxPaneAsync(
      tmuxPath,
      target.tmuxSessionName,
      0,
      BRIDGE_CAPTURE_LINES
    )
    return `[raw-capture] history unavailable — last ${BRIDGE_CAPTURE_LINES} pane lines:\n${text.trim()}`
  }

  private emit(info: BridgeDelegationInfo): void {
    for (const cb of this.listeners) {
      try {
        cb(info)
      } catch {
        /* ignore */
      }
    }
  }
}
