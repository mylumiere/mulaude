# Changelog

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
