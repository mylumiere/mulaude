# Mulaude Architecture

## 프로세스 계층

```
┌─────────────────────────────────────────────────┐
│  Electron Main (Node.js)                        │
│  ├─ index.ts          앱 진입점, 윈도우 관리      │
│  ├─ ipc-handlers.ts   IPC 핸들러 등록             │
│  ├─ session-manager   세션 CRUD, PTY 관리         │
│  ├─ session-store     ~/.mulaude/sessions.json   │
│  ├─ session-forwarder 배치 데이터 전송             │
│  ├─ pane-poller       에이전트 pane 폴링           │
│  ├─ close-handler     닫기 다이얼로그              │
│  ├─ hooks-manager     Hook 파일 감시              │
│  ├─ child-pane-streamer 자식 pane 스트리밍         │
│  ├─ tmux-utils        tmux CLI 래퍼              │
│  ├─ team-config-scanner 팀 config.json 비동기 스캔 │
│  ├─ agent-matcher     Config SSOT 에이전트 매칭    │
│  └─ logger            파일 기반 앱 로거            │
├─────────────────────────────────────────────────┤
│  Preload (contextBridge)                        │
│  └─ 30개+ API → window.api                      │
├─────────────────────────────────────────────────┤
│  Renderer (React + xterm.js)                    │
│  ├─ App.tsx           루트 컴포넌트               │
│  ├─ hooks (12개)      상태 관리                    │
│  └─ components (15개) UI 컴포넌트                  │
└─────────────────────────────────────────────────┘
```

## 데이터 흐름

### 세션 라이프사이클

```
사용자 "새 프로젝트"
  → createSession(workingDir)
  → tmux new-session -d -s mulaude-{id} -x 120 -y 30
  → PTY attach (node-pty spawn: tmux attach -t ...)
  → SessionStore.add (sessions.json 저장)
  → onSessionData 콜백 등록 (16ms 배치)
  → Renderer: useSessionManager → sessions 상태 업데이트
  → xterm.js 렌더링
```

### PTY 데이터 → 상태 파싱 → UI 반영

```
PTY stdout
  → createBatchForwarder (16ms 버퍼)
  → session:data IPC
  → xterm.js write()
  → useSessionPtyState: PTY 출력 파싱
    └─ 프롬프트 "❯" 감지 → idle
    └─ 도구 호출 감지 → tool (Read, Edit, Bash 등)
    └─ 에이전트 감지 → agent
    └─ 에러 감지 → error
  → SessionStatus { state, label }
  → Sidebar/StatusLegend 반영
```

### Hook 이벤트 흐름

```
앱 시작
  → ~/.claude/mulaude-hook.sh 생성
  → ~/.claude/settings.json에 hooks 등록

세션 생성
  → 환경변수 주입: MULAUDE_SESSION_ID, MULAUDE_IPC_DIR

Claude Code 실행 중 hook 발생
  → mulaude-hook.sh 호출
  → $MULAUDE_IPC_DIR/{sessionId}.json 기록
  → HooksManager fs.watch 감지
  → session:hook IPC → Renderer
  → useSessionHooks: 이벤트 처리
    └─ PreToolUse/PostToolUse → tool 상태
    └─ Notification → permission/완료
    └─ Stop → idle
  → 소스 태깅: hook > pty (Hook이 PTY보다 우선)
```

### 에이전트/팀 감지

```
Claude Code 팀 모드 활성화
  → tmux에서 child pane 생성

pane-poller (2초 간격)
  → tmux list-panes → pane 목록
  → 새 pane 감지 → session:panes IPC
  → team-config-scanner.ts: scanTeamConfigs (async fs/promises)
    → 팀 config.json 비동기 스캔
  → agent-matcher.ts: Config SSOT 기반 에이전트 매칭
    → pane 출력과 config 정보를 대조하여 AgentInfo 생성

child-pane-streamer
  → tmux pipe-pane으로 pane 출력 캡처
  → 50ms 폴링 → childpane:data IPC (16ms 배치)
  → AgentTerminal에서 xterm.js 렌더링
```

### Hook 기반 Task 에이전트 추적

팀 에이전트와 별도로, Claude Code가 Task tool로 스폰하는 백그라운드/포그라운드 에이전트를 Hook 이벤트로 추적합니다.

```
PreToolUse(Task)
  ├─ tool_input.team_name 있음 → 팀 에이전트 (Config SSOT, 카운터 스킵)
  └─ tool_input.team_name 없음 → Hook 에이전트
      ├─ run_in_background: true → bg 카운터++
      └─ run_in_background: false → fg (PostToolUse에서 완료 처리)

PostToolUse(Task)
  ├─ bg 카운터 > 0 → bg 카운터-- (에이전트 아직 실행 중)
  └─ bg 카운터 == 0 → fg 에이전트 완료 → running--

부모 Stop (첫 번째)
  → parentStopped = true
  → 이후 같은 session_id 이벤트는 child로 라우팅

child Stop (parentStopped 이후)
  → bg 에이전트 완료 → running--

PreToolUse (parentStopped 이후, 같은 session_id)
  → 부모 활동 재개 → parentStopped = false

UserPromptSubmit
  → running > 0이면 카운터 유지
  → running == 0이면 카운터 리셋
```

UI 표시:
- 팀 에이전트: AgentTree (접기/펼치기 트리, config 색상)
- Hook 에이전트: 단순 카운터 라벨 ("2/3 agents", "3/3 done")
- 팀 에이전트가 있으면 Hook 카운터 숨김 (중복 방지)

### 이미지 붙여넣기 & 파일 드래그 앤 드롭

```
⌘V (이미지 붙여넣기)
  → keydown 감지 (useXtermTerminal)
  → saveClipboardImage() IPC
  → Main: clipboard.availableFormats() 확인
    ├─ text/uri-list → Finder 파일 복사
    │   → public.file-url에서 실제 경로 추출
    │   → 이미지 확장자면 경로 반환, 아니면 null
    ├─ 텍스트 있음 → null (일반 paste에 위임)
    └─ 이미지 데이터 → toPNG() → /tmp/ 저장 → 경로 반환
  → Renderer: onData(filePath) → PTY → Claude Code 입력

Finder → 터미널 드래그 앤 드롭
  → dragover/drop 감지 (useXtermTerminal, capture phase)
  → webUtils.getPathForFile(file) → 실제 경로 추출
  → onData(filePath) → PTY → Claude Code 입력
  → index.ts will-navigate 차단 (file:// 네비게이션 방지)
```

### 패인 네비게이션 알고리즘

키보드(⌘←→↑↓)로 그리드 패인 간 이동 시, 중심선 거리 기반으로 대상 패인을 결정합니다.

```
findAdjacentPane(root, currentId, direction)
  1. 현재 패인에서 루트까지 경로(path) 역추적
  2. 이동 방향 축(horizontal/vertical)과 일치하는 가장 가까운 branch 탐색
  3. 대상 서브트리에서 모든 리프의 정규화 rect(0~1 좌표계) 계산
  4. 소스 패인의 수직 중심(좌우 이동) 또는 수평 중심(상하 이동) 계산
  5. 대상 리프 중 수직/수평 중심이 가장 가까운 패인 선택

예시: 2×2 그리드 (A|B / C|D)
  C에서 →: D 선택 (수직 중심 0.75 ≈ 0.75)
  A에서 →: B 선택 (수직 중심 0.25 ≈ 0.25)
```

## 상태 관리

### SessionStatus 상태 머신

```
         ┌──────────────────────────┐
         │         idle             │ ← 프롬프트 대기
         └──┬───────────────────┬───┘
            │ 사용자 입력        │ hook Stop
            ▼                   │
    ┌───────────────┐           │
    │   thinking    │ ← 응답 생성 중
    └──┬────────┬───┘           │
       │        │               │
       ▼        ▼               │
  ┌────────┐ ┌────────┐        │
  │  tool  │ │ agent  │        │
  └────┬───┘ └────┬───┘        │
       │          │             │
       ▼          ▼             │
  ┌─────────────────┐          │
  │   permission    │ ← 사용자 확인 요청
  └─────────┬───────┘          │
            │ 승인/거부          │
            └──────────────────┘

  error ← 에러 발생 (어디서든 전이 가능)
  shell ← Claude 종료 후 일반 셸
  exited ← PTY 프로세스 종료
```

### 소스 태깅 우선순위

PTY 파싱과 Hook 이벤트가 동시에 상태를 업데이트할 수 있으므로, 소스 태깅으로 충돌 해소:

| 우선순위 | 소스 | 설명 |
|---------|------|------|
| 1 (높음) | Hook | Claude Code hooks 시스템에서 직접 보고 |
| 2 (낮음) | PTY | 터미널 출력 파싱으로 추론 |

Hook 이벤트가 최근(400ms 이내)에 발생했으면 PTY 파싱 결과를 무시합니다.

## IPC 채널 (19개)

### 세션 관리 (7)
| 채널 | 방향 | 설명 |
|------|------|------|
| `session:create` | R→M | 세션 생성 |
| `session:destroy` | R→M | 세션 삭제 |
| `session:list` | R→M | 세션 목록 조회 |
| `session:write` | R→M | PTY 입력 전송 |
| `session:resize` | R→M | 터미널 리사이즈 |
| `session:restore-all` | R→M | 앱 시작 시 세션 복원 |
| `session:name/subtitle-update` | M→R | 이름/부제목 변경 알림 |

### 세션 이벤트 (5)
| 채널 | 방향 | 설명 |
|------|------|------|
| `session:data-batch` | M→R | PTY 출력 데이터 (16ms 배치) |
| `session:exit` | M→R | 세션 종료 |
| `session:hook` | M→R | Hook 이벤트 |
| `session:panes` | M→R | pane 목록 변경 |
| `session:team-agents` | M→R | 팀 에이전트 정보 |

### 자식 Pane (5)
| 채널 | 방향 | 설명 |
|------|------|------|
| `childpane:write` | R→M | pane 입력 전송 |
| `childpane:resize` | R→M | pane 리사이즈 |
| `childpane:data` | M→R | pane 출력 데이터 |
| `childpane:discovered` | M→R | 새 pane 감지 |
| `childpane:removed` | M→R | pane 제거 |

### 유틸리티 (2)
| 채널 | 방향 | 설명 |
|------|------|------|
| `clipboard:save-paste-image` | R→M | 클립보드 이미지 → 파일 경로 |
| `session:capture-screen` | R→M | 세션 화면 캡처 (전환/복원용) |

## tmux 세션 영속화

```
앱 실행 중
  └─ tmux session: mulaude-{id}
  └─ PTY: tmux attach -t mulaude-{id}

앱 종료 (세션 유지 선택)
  └─ detachAll(): PTY kill, tmux session 보존
  └─ sessions.json 메타데이터 유지

앱 재시작
  └─ restoreAllSessions()
  └─ isTmuxSessionAlive(name) 체크
  └─ 살아있으면 reattach → 스크롤백 버퍼로 이전 출력 복원
  └─ 죽었으면 세션 제거
```

## 공유 상수 (constants.ts, 37개)

| 상수 | 값 | 용도 |
|------|---|------|
| `IPC_BATCH_INTERVAL` | 16ms | ~60fps 배치 전송 |
| `PANE_POLL_INTERVAL` | 2000ms | pane 폴링 주기 |
| `IDLE_TIMEOUT` | 300ms | idle 전환 대기 |
| `DEFAULT_COLS` | 120 | 기본 터미널 너비 |
| `DEFAULT_ROWS` | 30 | 기본 터미널 높이 |
| `HOOK_THINKING_DEBOUNCE` | 400ms | Hook→thinking 디바운스 |
| `TERMINAL_FONT_SIZE` | 14 | 메인 터미널 폰트 |
| `AGENT_TERMINAL_FONT_SIZE` | 13 | 에이전트 터미널 폰트 |
| `AGENT_SCROLLBACK` | 5000 | 에이전트 스크롤백 |
