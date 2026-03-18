# Changelog

## [1.2.0] - 2026-03-18

### Cowrk Agents — 영속적 AI 팀원

앱 내에서 Claude Code 기반의 영속적 AI 에이전트를 생성하고 채팅할 수 있습니다.
메신저 앱처럼 에이전트별 채팅 패널에서 대화하며, 에이전트는 페르소나·메모리·프로젝트 컨텍스트를 유지합니다.

#### 백엔드 (`src/main/cowrk/`, `cowrk-manager.ts`)
- **CowrkManager**: 에이전트 CRUD + 대화 오케스트레이터
  - `claude -p --output-format stream-json` subprocess 스폰 (NativeChatManager 패턴 재사용)
  - 시스템 프롬프트: 페르소나 + 메모리 + 프로젝트 컨텍스트 (CLAUDE.md + 디렉토리 트리)
  - 히스토리 임베딩 (최근 20턴)
  - Fire-and-forget 메모리 자동 갱신 (haiku 모델)
- **아바타 시스템**: `setAvatar(name, base64)` / `removeAvatar(name)` — base64 → avatar.png 파일 저장, `listAgents()`에서 avatarPath 자동 포함
- **저장소**: `~/.mulaude/cowrk/agents/{name}/` (persona.md, memory.md, history.jsonl, meta.json, avatar.png)
- **IPC 채널 10개**: `cowrk:list-agents`, `cowrk:create-agent`, `cowrk:delete-agent`, `cowrk:set-avatar`, `cowrk:remove-avatar`, `cowrk:ask`, `cowrk:cancel`, `cowrk:stream-chunk`, `cowrk:turn-complete`, `cowrk:turn-error`

#### 프론트엔드
- **사이드바 탭**: Projects | Agents 탭 전환 (채팅 리스트 스타일)
  - 에이전트 아바타 (커스텀 이미지 또는 이니셜 letter badge + 상태 도트), 마지막 메시지 프리뷰, 타임스탬프
- **CowrkChatPanel**: 우측 플로팅 채팅 패널 (400px, 슬라이드 애니메이션)
  - 헤더에 클릭 가능한 아바타 (hover 시 카메라 오버레이 → 이미지 변경)
  - 삭제 시 에이전트 이름 입력 확인 (실수 방지)
  - 스트리밍 응답, 커서 인디케이터, Esc로 닫기
- **CowrkCreateDialog**: 에이전트 생성 모달 (아바타 선택 + 이름 + 페르소나)
  - 카메라 아이콘 클릭으로 프로필 이미지 미리보기 후 생성
- **i18n**: Cowrk 컴포넌트 전체 4개 언어 (en/ko/ja/zh) 다국어 지원

### Session Resume — 재부팅 후 대화 이어받기

- Claude 세션 ID를 hooks에서 감지 → `sessions.json`에 자동 저장
- 재부팅 후 tmux 세션 재생성 시 `claude --resume <savedId>`로 이전 대화 자동 이어받기
- 새 IPC 채널: `session:claude-session-id` (R→M, Claude 세션 ID 저장)

### Web Preview Panel

- dev 서버 실행/프리뷰/프로세스 관리 통합 패널
- 터미널 출력에서 URL 자동 감지 → 프리뷰 자동 열기
- 프리뷰 패널 리사이즈, 런치 설정 저장

### Permission Mode

- 세션별 퍼미션 모드 순환: default → acceptEdits → plan
- 그리드 헤더에 현재 모드 표시

### 사이드바 개선
- **탭 UI**: Projects | Agents 분리로 사이드바 정리
- **StatusLegend 제거**: 불필요한 상태 범례 삭제
- **푸터 컴팩트화**: 텍스트 제거, 아이콘만 표시

### 임시 파일 정리 (v1.1.22~30 핫픽스 통합)
- 로그 로테이션 (10MB 초과 시 자동 교체)
- 클립보드 이미지 임시 파일 앱 종료 시 정리
- ctx 디렉토리 오래된 파일 자동 정리
- 환경 의존 장애 방어 코드 전수 적용 (9개 파일)
- DMG 환경 세션 생성 실패 수정
- 재부팅 후 세션 복원 안정화
- 드래그 분할 발견성 개선 (코칭 + 넛지)
- 패인 네비게이션 전역 2D 중심점 거리 기반 수정
- ⌘⇧T 닫은 패인 되살리기

---

## [1.1.21] - 2026-03-04

### claude-hud 의존성 제거 — 자체 Statusline 통합

claude-hud 플러그인 없이도 Context %와 Rate Limit 데이터를 표시할 수 있도록 전면 재설계했습니다.

#### Statusline 시스템 (`statusline-manager.ts`)
- **자체 statusline 스크립트** (`~/.mulaude/statusline.mjs`): Claude Code 네이티브 Statusline API를 활용하여 stdin JSON → `~/.mulaude/ctx/{session_id}.json` 기록
- **Context % 수집**: ctx 디렉토리 3초 폴링 → `statusline:context-batch` IPC로 렌더러에 전달
- **프록시 모드**: `~/.mulaude/proxy-cmd` 파일 존재 시 원래 statusline도 실행 (HUD 오버레이 표시 모드)
- **크래시 복구**: 앱 비정상 종료 시 `_mulaudeStatusLineBackup`에서 원래 statusLine 자동 복원

#### Rate Limit 데이터 다중 소스
- **Keychain OAuth API** (opt-in, 우선): `api.anthropic.com/api/oauth/usage` 엔드포인트 60초 간격 호출
  - `anthropic-beta: oauth-2025-04-20` 헤더 필수
  - 응답 구조: `five_hour.utilization`, `seven_day.utilization`, `resets_at`
  - macOS Keychain에서 OAuth 토큰 읽기 (`security find-generic-password -a $(whoami)`)
- **claude-hud 캐시** (fallback): `~/.claude/plugins/claude-hud/.usage-cache.json` 읽기
- **HUD 백그라운드 폴러**: HUD 숨김 시에도 원래 statusline 커맨드를 30초마다 실행하여 캐시 갱신

#### UsageGauge 개선
- **데이터 신선도 표시**: 소스(HUD/API) + 경과 시간(`<1m`, `3m`, `1h` 등) 헤더에 표시
- **Stale 경고**: 데이터가 5분 이상 오래되면 빨간색 `⚠` 표시
- **데이터 미수집 경고**: 데이터 없을 때 `⚠ Rate Limit` + 안내 메시지 표시

#### 설정 UI (고급 탭)
- **HUD 오버레이 숨기기 토글**: claude-hud statusline 오버레이 표시/숨김 전환
- **Keychain 접근 허용 토글**: 인라인 확인 다이얼로그로 OAuth 토큰 사용 동의 확인
- **면책 조항**: "토큰은 사용량 집계에만 사용되며, 다른 곳에 저장·전송되지 않습니다"

#### 기타
- `session-forwarder.ts`에서 HUD 관련 코드 제거 (statusline-manager로 이전)
- 새 IPC 채널: `statusline:context-batch`, `hud:set-hidden`, `keychain:set-access`
- 4개 언어 번역 추가 (HUD/Keychain/Rate Limit 관련 8개 키)

## [1.1.20] - 2026-03-04

### 터미널 안정성 대폭 개선

v1.1.14~19 핫픽스들을 통합한 안정화 릴리스입니다.

#### 스크롤백 시스템 재설계
- **IPC 기반 tmux copy-mode 스크롤**: 마우스 휠로 tmux 스크롤백에 접근 가능
  - 글로벌 tmux 바인딩을 건드리지 않고, tmux 명령을 직접 실행 (copy-mode + send-keys -X -N scroll-up/down)
  - 휠 delta에 비례한 자연스러운 스크롤 속도 (cellHeight 단위 누적)
  - xterm.js 네이티브 텍스트 선택(드래그 복사) 유지
- **파괴적 시퀀스 차단**: `\e[3J` (clear scrollback), `\ec` (full reset) 차단으로 스크롤백 보호
- **PTY 응답 소비**: DA1/CPR 응답이 raw 텍스트로 출력되지 않도록 파서 핸들러 등록

#### 리사이즈 안정화
- **Atomic resize+capture**: cols 변경 시 tmux resize를 await한 후 캡처 (경쟁 조건 제거)
- **PTY 데이터 버퍼링**: recapture 중(reset+write) PTY 데이터를 pendingDataRef에 버퍼링 → 완료 후 순차 재생
- **maxBuffer: Infinity**: 긴 대화 세션에서 캡처 사이즈 초과 에러 방지

#### 줌 토글 안정화
- **CSS zoom 방식**: TerminalGrid에서 `display: none` 전환으로 xterm 인스턴스 유지 (언마운트 없음)
- Cmd+Shift+Enter 줌 토글 시 스크롤백과 터미널 상태 완전 보존

#### 기타
- **Shift+Enter 줄바꿈 수정**: `\n`(LF) 직접 전송 방식으로 변경 (CSI u 프로토콜 의존 제거, tmux 설정 무관하게 동작)
- 새 IPC 채널: `session:scroll` (R→M, tmux copy-mode 스크롤)

## [1.1.12] - 2026-03-02

### 신규 기능
- **파일 드래그 앤 드롭**: Finder에서 터미널로 파일을 드래그하면 경로가 자동 입력 (이미지, PDF, 코드 등)
- **이미지 붙여넣기 개선**: Finder 파일 복사 → 실제 경로 추출, 스크린샷 → temp 파일 저장 후 경로 입력
- **패인 네비게이션 개선**: 중심선 거리 기반 인접 패인 탐색 (비대칭 분할에서도 직관적 이동)

### 버그 수정
- tmux capture-pane `\n` → `\r\n` 변환으로 xterm.js 스크롤백 호환성 수정
- Electron will-navigate 차단으로 파일 드롭 시 페이지 네비게이션 방지

## [1.1.11] - 2026-03-02

### 버그 수정
- **스크롤백 깨짐 수정**: 전체화면 토글/리사이즈 시 tmux 캡처 내용이 깨지는 문제 수정

## [1.1.10] - 2026-03-01

### 버그 수정
- **전체화면 토글 시 스크롤백 깨짐 수정**: 리사이즈 후 tmux 스크롤백 재캡처 로직 개선
- **tmux allow-passthrough 활성화**: 이미지 붙여넣기를 위한 passthrough 시퀀스 허용

## [1.1.9] - 2026-03-01

### 신규 기능
- **Claude 세션 ID 칩**: 사이드바 + 그리드 패인 헤더에 Claude 세션 ID 앞 4자리 표시
- **기본 세션 이름 단순화**: 프로젝트 디렉토리명만 표시

### 버그 수정
- **그리드 레이아웃 복원**: 앱 재시작 시 그리드 레이아웃이 정상 복원되도록 수정
- **레이아웃 복원 레이스 컨디션**: 세션 restore와 레이아웃 복원 순서 보장

## [1.1.8] - 2026-03-01

### 버그 수정
- **중첩 세션 방지**: Claude Code 내에서 Mulaude 실행 시 CLAUDECODE 환경변수 제거로 에러 방지
- **statusLine 크래시 복구**: 앱 비정상 종료 시 statusLine 백업 자동 복원

## [1.1.7] - 2026-03-01

### 개선
- **터미널 리사이즈 reflow 개선**: cols 변경 시 tmux reflow된 내용 재캡처 (xterm 스크롤백 비우고 재구성)

## [1.1.6] - 2026-03-01

### 개선
- **터미널 렌더링 단순화**: 불필요한 렌더링 제거, 줌 UI 개선
- **HUD 폴링 개선**: HUD 상태 폴링 최적화
- **세션 탐색 수정**: 상/하 화살표 세션 전환 버그 수정

## [1.1.5] - 2026-03-01

### 버그 수정
- **HUD 숨기기 시 토큰 사용량 미갱신 수정**: claude-hud 플러그인을 비활성화하지 않고 statusLine만 제거하여 usage-cache.json 갱신 유지
- **터미널 텍스트 선택 불가 수정**: Claude Code의 마우스 트래킹 시퀀스(`\x1b[?1000h` 등) 차단으로 드래그 텍스트 선택 정상 동작
- **드래그 시 터미널 스크롤 초기화 수정**: `focusPane` 중복 state 갱신 방지 + `isActive` effect에서 `isFocused` 의존성 제거

## [1.1.3] - 2026-03-01

### 성능 최적화
- Main Process: 동기 I/O (`execFileSync`) → 비동기 (`execFile` + `Promise.all`) 전환
  - `tmux-utils.ts`: `execTmuxAsync`, 비동기 pane 조회 함수 5개 추가
  - `session-manager.ts`: `getSessionPaneContents()`, `captureScreen()` 비동기화
  - `pane-poller.ts`: setInterval 콜백 비동기화, 이중 호출 제거
  - `team-config-scanner.ts`: `fs/promises` 기반, `Promise.all` 병렬 스캔
  - `agent-matcher.ts`: `getPaneCommandAsync()` + 러닝 멤버 병렬 조회
- `child-pane-streamer.ts`: 개별 pane당 타이머 → 단일 글로벌 타이머 통합
- `session-store.ts`: `save()` 500ms 디바운싱
- Renderer: `classifyChunk` 100ms 쓰로틀, TerminalGrid 세션 Map 인덱싱
- CSS: box-shadow 애니메이션 → opacity 기반 GPU 가속

### 에이전트 시스템

#### Hook 기반 Task 에이전트 추적
- Claude Code의 Task tool 백그라운드/포그라운드 에이전트를 Hook 이벤트로 추적
- 카운터 방식 표시 ("2/3 agents", "3/3 done")
- `tool_input.team_name`으로 팀/비팀 에이전트 구분
- Foreground Task: `PostToolUse[Task]`에서 완료 처리
- Background Task: `run_in_background` 추적, child Stop에서 완료 처리
- `parentStopped` 플래그로 부모/자식 이벤트 라우팅

#### 팀 에이전트 분리
- Config SSOT (`teamAgents`) vs Hook 카운터 (`hookAgents`) 완전 분리
- `mergedAgents` 제거, 각각 독립 경로로 전달
- 팀 에이전트 config `color` 필드 → AgentTree 이름 색상 적용

### 코드 정리
- `useSessionHooks.ts`: `handleLegacyEvent` 제거 (handleParentEvent로 통합)
- `handlePreToolUse`/`handlePostToolUse` 공통 함수 추출
- 디버그 로그 제거

---

## [1.1.2] - 2026-02-28

### 코드 리팩토링
- 매직 넘버 상수화 완료
- Main Process 모듈 분리 세분화
- `useSessionHooks`: 부모/자식 이벤트 분류 로직 개선

---

## [1.1.0] - 2026-02-28

### 신규 기능

#### 인터랙티브 튜토리얼
- 7단계 인터랙티브 가이드 (프로젝트 생성 → 터미널 영역 → 세션 추가 → 세션 전환 → 드래그 분할 → 패인 포커스 → 설정)
- 액션 유형별 진행 방식: `click` (실제 버튼 클릭), `drag` (드래그&드롭), `shortcut` (⌘↑/↓/←/→), `null` (Next/Prev)
- SVG 스포트라이트 마스크로 타겟 요소 하이라이트
- 튜토리얼 진행 중 허용되지 않은 단축키 차단 (⌘Q 제외)
- 드래그 스텝에서 center 드롭 차단 (분할만 허용)
- `selectorAll` 지원: 여러 요소의 union bounding box 하이라이트

#### 첫 실행 온보딩
- Setup 페이즈: 첫 실행 시 언어/테마 선택 화면
- 플로우: Setup → Welcome → Steps → Idle
- 사이드바에서 튜토리얼 재시작 가능

#### 키보드 단축키 모달
- `⌘/`로 전체 단축키 목록 확인
- 카테고리별 정리 (일반, 세션&프로젝트, 에이전트 패인, 그리드, 터미널)

#### HUD 오버레이 토글
- 설정에서 터미널 내 HUD 오버레이 숨기기 옵션
- Mulaude가 사용량을 이미 표시하므로 중복 제거

#### 로드맵 리디자인
- 수평 타임라인 + 버전 점 시각화
- 글로벌 진행률 트랙
- 버전 점 클릭으로 마일스톤 스크롤

### UX 개선
- 그리드 포커스 변경 시 사이드바 activeSessionId 자동 동기화
- 비-그리드 모드에서도 현재 세션 아이콘 표시
- 스플래시 스크린에 앱 아이콘 인라인 base64 삽입 (로딩 지연 제거)
- CSS 애니메이션 최적화 (`backdrop-filter: blur` 제거, 정적 그라디언트 보더)

### 단축키 변경
- `⌘D` / `⌘⇧D` (수평/수직 분할) 단축키 제거 — 드래그로 대체

---

## [1.0.0] - 2026-02-27

### 코드 리팩토링

#### Main 프로세스 분할
- `index.ts` (618줄) → 5개 모듈로 분할
  - `index.ts` — 앱 진입점 (~116줄)
  - `ipc-handlers.ts` — IPC 핸들러 등록 (~167줄)
  - `session-forwarder.ts` — 배치 데이터 포워딩 (~95줄)
  - `pane-poller.ts` — pane 폴링 + 팀 config (~221줄)
  - `close-handler.ts` — 닫기 다이얼로그 (~196줄)
- `tmux-utils.ts` — `execTmux()` 공통 래퍼로 반복 try-catch 제거 (485줄 → 382줄)

#### Renderer 리팩토링
- `useSessionStatus.ts` (476줄) → 3개 훅 + 래퍼로 분할
  - `useSessionPtyState.ts` — PTY 출력 파싱
  - `useSessionHooks.ts` — Hook 이벤트 처리
  - `useSessionAgents.ts` — 에이전트 관리
- `Sidebar.tsx` (383줄) → 컨테이너 + 5개 하위 컴포넌트
  - `ProjectHeader`, `SessionRow`, `AgentTree`, `UsageGauge`, `StatusLegend`
- `useChildPaneManager.ts` — App.tsx에서 child pane 상태 관리 추출
- `useXtermTerminal.ts` — TerminalView/AgentTerminal 공통 xterm 훅 추출
  - TerminalView: 139줄 → 55줄
  - AgentTerminal: 151줄 → 70줄

#### 공유 모듈
- `src/shared/constants.ts` — 17개 매직 넘버 상수화

### 버그 수정
- `hooks-manager.ts`: processedFiles Set 메모리 누수 — cleanup()에서 clear() 호출
- `hooks-manager.ts`: 콜백 참조 누수 — cleanup()에서 callbacks 해제
- `session-forwarder.ts`: watchFile 리스너 누수 — cleanup 함수 반환 패턴으로 수정
- `pane-poller.ts`: 타이머 정리 보장 — cleanup 함수 반환

### 패키징
- `electron-builder` 설치 및 설정
- macOS entitlements.mac.plist 추가 (node-pty JIT 권한)
- `npm run package:dmg` 스크립트 추가

### 문서
- `README.md` — 프로젝트 소개, 설치, 사용법
- `ARCHITECTURE.md` — 아키텍처, 데이터 흐름, IPC 채널
- `CHANGELOG.md` — 릴리즈 노트
