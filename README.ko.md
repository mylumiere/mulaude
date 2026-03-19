[English](README.md) | **한국어** | [日本語](README.ja.md) | [中文](README.zh.md)

# Mulaude

**Multi-session Claude Code Terminal** — 여러 Claude Code 세션을 동시에 관리하는 macOS 데스크톱 앱

## 주요 기능

- **멀티 세션**: 여러 프로젝트에서 독립 Claude Code 세션을 동시 실행
- **터미널 그리드 분할**: 이진 트리 기반 수평/수직 자유 분할 (최대 10패인), 드래그로 패인 위치 교환/재배치
- **세션 영속화**: tmux 기반 — 앱을 종료해도 세션이 유지되고, 재시작 시 자동 복원
- **에이전트/팀 뷰**: Claude의 팀 모드 활성화 시 하위 에이전트를 split pane으로 실시간 모니터링
- **Hook 통합**: Claude Code Hooks 시스템과 연동하여 정확한 상태 추적 (idle, thinking, tool, permission 등)
- **인터랙티브 튜토리얼**: 첫 실행 시 7단계 가이드 (언어/테마 설정 → 프로젝트 생성 → 분할 → 단축키)
- **6가지 테마**: Void, Ocean, Ember, Forest, Arctic, Rosé
- **4개 언어**: English, 한국어, 日本語, 中文
- **이미지 & 파일 지원**: 클립보드 이미지 붙여넣기 (⌘V) + Finder에서 파일 드래그 앤 드롭
- **사용량 모니터**: Claude 플랜 사용량을 사이드바에서 실시간 확인
- **Cowrk Agents**: 영속적 AI 팀원 — 사이드바에서 에이전트 생성/채팅/관리, 페르소나·메모리 유지
- **세션 이어받기**: 재부팅 후 `--resume`으로 이전 Claude 대화를 자동으로 이어받기
- **웹 미리보기**: dev 서버 실행/프리뷰/프로세스 관리 통합 패널

## 왜 Mulaude인가?

Claude Code는 일반 터미널, tmux, 공식 Claude Desktop 앱에서 사용할 수 있습니다. Mulaude가 제공하는 차별점:

### vs. 일반 터미널 (iTerm2, Terminal.app)

| | 일반 터미널 | Mulaude |
|---|---|---|
| 멀티 세션 | 탭을 수동으로 열고 각각 `claude` 실행 | 사이드바에서 프로젝트/세션 계층 관리, 원클릭 전환 |
| 동시 모니터링 | 한 번에 하나만 보임 (탭 전환 필요) | 그리드 분할로 최대 10개 세션 동시 관찰 |
| 세션 영속화 | 터미널 닫으면 끝 | tmux 기반 — 앱 종료해도 유지, 재시작 시 자동 복원 |
| 상태 파악 | 직접 화면을 봐야 함 | 사이드바에서 idle/thinking/tool/permission 실시간 표시 |
| 팀 에이전트 | 별도 터미널에서 일일이 확인 | 자동 감지 + split pane으로 실시간 모니터링 |
| 사용량 추적 | `claude` 내부 또는 웹 대시보드에서 확인 | 사이드바에서 실시간 사용량 게이지 |

### vs. tmux (수동 관리)

| | tmux 수동 관리 | Mulaude |
|---|---|---|
| 설정 | tmux 설정, 분할, 세션 관리 직접 해야 함 | 드래그 앤 드롭으로 분할, 자동 세션 관리 |
| 스크롤백 | 수동 copy-mode 진입 (`Ctrl+B [`) | 마우스 휠로 자연스럽게 스크롤 (IPC 기반 자동 copy-mode) |
| 텍스트 선택 | copy-mode에서만 가능 (별도 조작) | 일반 드래그로 바로 텍스트 선택 + 복사 |
| 상태 추적 | 없음 — 화면 직접 확인 | Hook 시스템으로 정확한 자동 상태 추적 |
| 에이전트 관리 | pane을 수동으로 찾아서 전환 | team config 기반 자동 감지 + 사이드바 트리 |
| 리사이즈 | tmux reflow만 의존 | atomic resize+capture + PTY 버퍼링으로 깨짐 없음 |

### vs. Claude Desktop 앱 (공식)

| | Claude Desktop | Mulaude |
|---|---|---|
| 본질 | 웹 채팅 UI를 감싼 네이티브 앱 | Claude Code CLI를 감싼 터미널 IDE |
| 코드 실행 | MCP 서버를 통한 제한적 접근 | 풀 CLI 접근 — git, npm, 빌드 도구 등 모든 것 |
| 멀티 세션 | 대화 탭 전환 | 프로젝트별 독립 세션 + 그리드 동시 모니터링 |
| 팀/에이전트 | 미지원 | 자동 감지 + 에이전트 split view |
| 세션 영속화 | 서버 기반 대화 히스토리 | 로컬 tmux 영속화 (오프라인에서도 유지) |
| 커스터마이징 | 거의 없음 | 6테마, 4언어, 자유 분할, Hook 통합 |

### 한마디로

Mulaude는 **"Claude Code 관제탑"** — 여러 프로젝트를 한 화면에서 모니터링하고, 컨텍스트 전환 없이 permission 프롬프트를 캐치하고, Claude의 팀 에이전트가 작업하는 동안 모든 것을 실시간으로 관찰합니다. 터미널의 풀 파워에 GUI의 편의성을 더한 앱입니다.

## 설치

### 방법 1: DMG 다운로드 (일반 사용자)

1. [Releases](https://github.com/mylumiere/mulaude/releases) 에서 최신 `.dmg` 파일 다운로드
2. DMG 마운트 → Mulaude를 Applications로 드래그
3. 첫 실행 시 **"확인되지 않은 개발자"** 경고가 나타남:

   **방법 A** — `시스템 설정` > `개인정보 보호 및 보안` > **"그래도 열기"** 클릭

   **방법 B** — 터미널에서 아래 명령어 실행:
   ```bash
   find /Applications/Mulaude.app -exec xattr -d com.apple.quarantine {} + 2>/dev/null
   ```

   > Ad-hoc 서명은 되어 있으나 공증(Notarization)이 없어 macOS Gatekeeper가 첫 실행을 차단합니다. 위 방법 중 하나를 사용하면 이후 정상 실행됩니다.

### 방법 2: 소스 빌드 (개발자)

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### 사전 요구사항

| 요구사항 | 설치 방법 | 필수 |
|---------|----------|------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅ (소스 빌드 시) |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLI가 인증 완료 상태여야 합니다 (`claude` 명령어가 동작하는지 확인).

## 사용법

### 첫 실행

1. 앱 실행 → 언어/테마 선택 → 튜토리얼 시작
2. 튜토리얼을 따라 프로젝트 생성, 세션 추가, 분할 등을 체험
3. 튜토리얼은 스킵 가능하며, 사이드바 하단에서 언제든 재시작 가능

### 기본 워크플로우

1. `+` 버튼 또는 `⌘N` → 프로젝트 디렉토리 선택
2. 세션이 자동 생성되며 선택한 디렉토리에서 `claude` CLI 실행
3. 같은 프로젝트에 세션을 추가하거나, 다른 프로젝트를 추가 가능
4. 사이드바에서 세션 간 전환, 상태 확인

### 그리드 분할

- 사이드바에서 세션을 **드래그**하여 터미널 영역에 드롭 → 자동 분할
- 패인 헤더를 드래그하여 위치 교환/재배치
- `⌘W` — 포커스된 패인 닫기
- `⌘⇧↵` — 포커스된 패인 줌 토글
- `⌘←→↑↓` — 패인 간 포커스 이동

### 단축키

| 단축키 | 동작 |
|--------|------|
| `⌘,` | 설정 |
| `⌘/` | 단축키 목록 |
| `⌘N` | 새 프로젝트 생성 |
| `⌘1~9` | 현재 프로젝트 내 세션 전환 |
| `⌥⌘1~9` | 프로젝트 전환 |
| `⌘↑↓` | 이전/다음 세션 |
| `⌘W` | 패인 닫기 |
| `⌘⇧↵` | 줌 토글 |
| `⌘←→↑↓` | 그리드 패인 포커스 이동 |
| `⌥⌘←→↑↓` | 에이전트 패인 포커스 이동 |

### 팀 모드

Claude Code에서 팀(TeamCreate)을 사용하면:
- 하위 에이전트의 tmux pane이 자동 감지됨
- 사이드바에 에이전트 트리 표시
- 터미널 영역이 split pane으로 분할되어 에이전트 출력을 실시간 모니터링

## 빌드

```bash
# 프로덕션 빌드
npm run build

# macOS DMG 패키징
npm run package:dmg

# macOS 전체 (DMG + ZIP)
npm run package:mac
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| 터미널 | xterm.js 6 |
| PTY | node-pty 1.1 (tmux 기반) |
| 빌드 | electron-vite 5 |
| 패키징 | electron-builder 26 |

## 프로젝트 구조

```
src/
├── main/                      # Electron Main 프로세스
│   ├── index.ts               # 앱 진입점
│   ├── ipc-handlers.ts        # IPC 핸들러 등록
│   ├── session-manager.ts     # 세션 생성/삭제, PTY 관리
│   ├── session-store.ts       # ~/.mulaude/sessions.json 영속화
│   ├── session-forwarder.ts   # 세션 데이터 배치 포워딩
│   ├── env-resolver.ts        # 셸 환경변수/Claude 경로 탐색
│   ├── pane-poller.ts         # 에이전트 pane 폴링
│   ├── team-config-scanner.ts # 팀 config 스캔/캐싱
│   ├── agent-matcher.ts       # 에이전트-pane 매칭
│   ├── close-handler.ts       # 닫기 다이얼로그
│   ├── hooks-manager.ts       # Claude Code Hooks 감시
│   ├── child-pane-streamer.ts # 자식 pane 스트리밍
│   ├── tmux-utils.ts          # tmux 명령어 유틸
│   ├── logger.ts              # 파일 로거
│   ├── cowrk-manager.ts       # Cowrk 에이전트 오케스트레이터
│   └── cowrk/                 # Cowrk 에이전트 내부 (store, manager, types)
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # React 앱
│   ├── App.tsx                # 루트 컴포넌트
│   ├── i18n.ts                # 다국어
│   ├── themes.ts              # 6가지 테마
│   ├── roadmap.ts             # 로드맵 데이터
│   ├── settings.ts            # 설정 타입/유틸
│   ├── pty-parser.ts          # PTY 출력 파서
│   ├── hooks/                 # React 커스텀 훅 (13개)
│   ├── utils/                 # 순수 유틸리티
│   │   ├── pane-tree.ts       # 이진 트리 자료구조/연산
│   │   └── pane-storage.ts    # 레이아웃 localStorage 영속화
│   └── components/            # React 컴포넌트 (18개)
│       └── cowrk/             # Cowrk 에이전트 UI (Section, ChatPanel, CreateDialog)
└── shared/
    ├── types.ts               # 공유 타입
    └── constants.ts           # 공유 상수 (37개)
```

## 기여

버그 리포트, 기능 제안은 [Issues](https://github.com/mylumiere/mulaude/issues)에 남겨주세요.

## 라이선스

MIT
