# Session Bridge — 세션 간 위임 & 오케스트레이션

Mulaude 세션 안의 AI(Claude Code / Codex)가 **다른 세션에 작업을 위임하고 응답을
회수**할 수 있게 하는 시스템입니다. "Claude가 코드를 짜면 옆 Codex 세션이 검증한다"
같은 크로스 세션 워크플로우의 기반이며, 지휘 세션 하나가 여러 세션을 팀처럼 부리는
오케스트레이션까지 지원합니다.

## 사용법 (세션 안에서)

```bash
# 세션 목록 (ID / NAME / CLI / ROLE / STATE / PROJECT)
mulaude sessions

# 위임 — 대상 세션에 프롬프트를 보내고 응답을 기다림 (기본 타임아웃 600초)
mulaude ask kdp@codex "이 diff를 검증해줘: ..."
mulaude ask --timeout 120 session-3 "빠른 질문"
cat notes.md | mulaude ask reviewer        # stdin으로 프롬프트 전달

# 역할 라벨 — 세션에 역할 부여 (사이드바 칩 표시 + 셀렉터로 사용 가능)
mulaude role kdp@codex "verification"
mulaude role kdp@codex                     # 라벨 해제

# 병렬 위임 — 서로 다른 대상이면 동시 실행 가능
mulaude ask reviewer "작업 A" > /tmp/a.out 2>&1 &
mulaude ask tester   "작업 B" > /tmp/b.out 2>&1 &
wait; cat /tmp/a.out /tmp/b.out

# 지휘 세션(AI)용 안내
mulaude guide
```

**대상 셀렉터** 해석 순서: 세션 ID 정확 일치 → 세션 이름 → 프로젝트 디렉토리명 →
역할 라벨. `@claude` / `@codex` 접미사로 CLI 종류를 필터링합니다 (예: `kdp@codex`).
복수 매칭 시 후보 목록과 함께 에러를 반환합니다.

## 동작 원리

```
요청 세션                          Mulaude main                     대상 세션
   │                                   │                               │
   ├─ mulaude ask <대상> "..."          │                               │
   │    └→ $MULAUDE_IPC_DIR/bridge/    │                               │
   │       req-<id>/{type,target,      │                               │
   │       prompt,from,timeout}        │                               │
   │                                   ├─ fs.watch 감지                 │
   │                                   ├─ 대상 해석 + busy 체크          │
   │                                   ├─ tmux 브래킷 페이스트 주입 ────→ │ (사용자 눈에 보임)
   │                                   │                               ├─ AI가 작업/응답
   │                                   ├─ Stop 훅으로 턴 완료 감지 ←──── │
   │                                   ├─ 세션 히스토리에서 응답 추출     │
   │    res-<id>/{output,status,done} ←┤                               │
   ├─ CLI 폴링 → stdout 출력            │                               │
   ▼                                   │                               │
 응답을 받아 작업 계속                    │                               │
```

- **요청/응답 프로토콜**: JSON이 아닌 디렉토리 + 원시 파일. 프롬프트에 어떤
  텍스트(따옴표/개행/유니코드)가 와도 이스케이프가 필요 없습니다.
- **주입**: `tmux load-buffer` + `paste-buffer -p`(브래킷 페이스트). 멀티라인
  프롬프트도 조기 제출되지 않습니다. 버퍼 이름은 요청마다 고유 — 병렬 위임 시
  덮어쓰기 레이스가 없습니다.
- **완료 감지**: 대상 세션의 Stop 훅. 자식 에이전트의 Stop은 부모
  claudeSessionId 비교로 무시합니다.
- **응답 추출**:
  - Claude: `~/.claude/projects/<cwd-slug>/<claudeSessionId>.jsonl` 마지막
    assistant 텍스트 (사이드체인 제외)
  - Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl` 마지막
    `task_complete.last_agent_message`
  - 둘 다 실패 시 tmux pane 캡처 폴백 (`[raw-capture]` 마킹)
- **가드**: busy(작업 중) 대상 거부, 동일 대상 중복 위임 거부, 자기 자신 위임
  거부, 타임아웃 (CLI `--timeout`, 기본 600초).

## 시각화

- 위임 시작 시 **대상 세션 패인이 요청 세션 옆에 자동 분할 표시**됩니다
  (이미 표시 중이거나 MAX_PANES 초과 시 스킵, 포커스는 유지).
- 요청 세션 패인 헤더에 **"→ 대상 위임 중" 펄스 배지**가 뜨고 완료 시 사라집니다.
- 역할 라벨은 사이드바 세션 행에 칩으로 표시됩니다.

## 지휘 세션에 알려주기

브릿지는 세션 안 어디서든 `mulaude` 명령으로 사용 가능하지만, AI가 스스로 알아채게
하려면 프로젝트 CLAUDE.md에 한 줄 추가하는 것을 권장합니다:

```markdown
## Session Delegation
다른 AI 세션에 작업을 위임할 수 있다: `mulaude guide` 참고.
검증이 필요하면 `mulaude sessions`로 대상을 찾아 `mulaude ask <대상> "..."`로 맡길 것.
```

## 구성 요소

| 파일 | 역할 |
|---|---|
| `src/main/bridge-manager.ts` | 요청 감시, 대상 해석, 주입, 완료 감지, 추출, CLI 설치 |
| `~/.mulaude/bin/mulaude` | 세션 내 CLI (bridge-manager가 자동 설치/갱신) |
| `src/renderer/hooks/useBridgeDelegations.ts` | 위임 상태 → 패인 자동 표시 + 배지 |
| `useTerminalLayout.ensureSessionBeside` | 대상 패인을 요청 세션 옆에 분할 |
| IPC | `bridge:delegation`, `session:role-updated` (M→R) |

## 제약

- tmux 모드 전용 (legacy PTY 세션은 위임 대상이 될 수 없음)
- 대상 세션이 권한 프롬프트 등에서 멈추면 타임아웃까지 대기 — STATE 확인 후 위임 권장
- 위임된 프롬프트는 대상 세션의 대화 히스토리에 남습니다 (의도된 동작 —
  반복 위임 시 대상 세션에 컨텍스트가 축적되는 것이 장점)
