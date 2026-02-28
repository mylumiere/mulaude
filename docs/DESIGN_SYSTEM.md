# Mulaude 디자인 시스템

멀티 세션 Claude Code 터미널 데스크톱 앱의 UI 디자인 시스템 문서입니다.

---

## 1. 타이포그래피 (Typography)

### 폰트 패밀리

| 토큰             | 값                                               | 용도               |
|------------------|--------------------------------------------------|--------------------|
| `--font-ui`      | `'Outfit', -apple-system, sans-serif`            | 일반 UI 텍스트      |
| `--font-display` | `'Syne', 'Outfit', sans-serif`                   | 히어로/타이틀 텍스트  |
| `--font-mono`    | `'DM Mono', 'SF Mono', monospace`                | 코드, 터미널, 상태   |

### 글씨 크기 스케일 (rem 기준)

`:root`의 기본 font-size는 `calc(14px * var(--ui-scale))`입니다.
`--ui-scale` 값에 따라 전체 UI 텍스트 크기가 비례 조절됩니다.

| 토큰      | rem     | 기본 px (scale=1) | 용도                              |
|-----------|---------|-------------------|-----------------------------------|
| `fs-2xs`  | 0.7rem  | ~10px             | 카운트 뱃지, 상태 텍스트            |
| `fs-xs`   | 0.75rem | ~10.5px           | 섹션 라벨, uppercase 헤더           |
| `fs-sm`   | 0.85rem | ~12px             | 사이드바 이름, 소형 본문            |
| `fs-base` | 0.9rem  | ~13px             | 알림 라벨, 액션 버튼 아이콘          |
| `fs-md`   | 1rem    | 14px              | 기본 본문, 버튼 텍스트              |
| `fs-lg`   | 1.15rem | ~16px             | 모달 헤더, 사이드바 + 아이콘         |
| `fs-xl`   | 1.3rem  | ~18px             | 닫기 버튼                          |
| `fs-2xl`  | 2.3rem  | ~32px             | 히어로 타이틀 (empty state)         |
| `fs-icon` | 4rem    | ~56px             | 대형 아이콘 (empty state)           |

### UI 스케일 옵션

설정 모달에서 선택 가능한 글씨 크기 프리셋:

| ID   | 라벨 | `--ui-scale` | `:root` font-size |
|------|------|--------------|--------------------|
| `xs` | XS   | 0.8          | 11.2px             |
| `sm` | S    | 0.9          | 12.6px             |
| `md` | M    | 1.0          | 14px (기본)         |
| `lg` | L    | 1.1          | 15.4px             |
| `xl` | XL   | 1.25         | 17.5px             |

> **중요**: 모든 UI 텍스트는 `rem` 단위를 사용해야 합니다.
> `px` 단위를 사용하면 스케일 조절이 적용되지 않습니다.
> 터미널(xterm.js)의 폰트 크기는 별도로 `14px` 고정입니다.

---

## 2. 색상 시스템 (Color System)

### CSS 변수 토큰

모든 색상은 CSS 변수로 정의되며, 테마 전환 시 동적으로 교체됩니다.

#### 배경 (Surfaces)

| 토큰               | Void 테마 기본값              | 용도                         |
|--------------------|-------------------------------|------------------------------|
| `--bg-void`        | `#06060e`                     | 최하단 배경 (body)            |
| `--bg-deep`        | `#0a0a18`                     | 터미널 영역 배경              |
| `--bg-surface`     | `#0e0e20`                     | 사이드바 배경                 |
| `--bg-elevated`    | `#141430`                     | 모달, 팝오버 배경             |
| `--bg-glass`       | `rgba(16, 16, 42, 0.65)`     | 글래스모피즘 요소 배경         |
| `--bg-glass-hover` | `rgba(22, 22, 56, 0.75)`     | 글래스모피즘 hover 상태        |

#### 액센트 (Accents)

| 토큰                      | Void 기본값                      | 용도                    |
|---------------------------|----------------------------------|-------------------------|
| `--accent-primary`        | `#7c5cfc`                        | 주 강조색 (선택, 활성)    |
| `--accent-primary-glow`   | `rgba(124, 92, 252, 0.35)`      | 글로우 이펙트             |
| `--accent-primary-soft`   | `rgba(124, 92, 252, 0.12)`      | 선택 항목 배경            |
| `--accent-secondary`      | `#06d6a0`                        | 보조 강조색 (세션 표시)    |
| `--accent-secondary-glow` | `rgba(6, 214, 160, 0.3)`        | 보조 글로우               |
| `--accent-warm`           | `#f7a046`                        | 경고/도구 사용 상태        |
| `--accent-danger`         | `#ff5c72`                        | 에러/위험 상태             |

#### 텍스트 (Text)

| 토큰              | Void 기본값 | 용도                         |
|-------------------|-------------|------------------------------|
| `--text-primary`  | `#eaeaf4`   | 주 텍스트 (이름, 제목)         |
| `--text-secondary`| `#8585a8`   | 보조 텍스트 (설명, 라벨)       |
| `--text-muted`    | `#4e4e6e`   | 비활성/힌트 텍스트             |
| `--text-ghost`    | `#2d2d4a`   | 최소 가시성 텍스트 (뱃지 등)    |

#### 보더 (Borders)

| 토큰              | Void 기본값                      | 용도               |
|-------------------|----------------------------------|--------------------|
| `--border-subtle` | `rgba(124, 92, 252, 0.08)`      | 미묘한 구분선        |
| `--border-default`| `rgba(124, 92, 252, 0.15)`      | 기본 보더            |
| `--border-active` | `rgba(124, 92, 252, 0.4)`       | 활성/선택 보더        |

---

## 3. 테마 (Themes)

6가지 내장 테마를 제공합니다. 각 테마는 UI CSS 변수 + xterm.js 터미널 색상을 포함합니다.

| ID       | 이름    | 주 액센트  | 분위기                    |
|----------|---------|-----------|---------------------------|
| `void`   | Void    | `#7c5cfc` | 딥 스페이스 + 일렉트릭 바이올렛 |
| `ocean`  | Ocean   | `#22d3ee` | 딥 네이비 + 사이언           |
| `ember`  | Ember   | `#f59e0b` | 다크 차콜 + 앰버             |
| `forest` | Forest  | `#10b981` | 딥 포레스트 + 에메랄드        |
| `arctic` | Arctic  | `#38bdf8` | 슬레이트 블루그레이 + 아이스 블루 |
| `rose`   | Rosé    | `#f472b6` | 다크 모브 + 로즈 핑크         |

### 테마 적용 범위

- **글로벌 테마**: 앱 전체 UI (사이드바, 모달, 빈 상태 등) + 기본 터미널 색상
- **세션별 테마 오버라이드**: 개별 터미널의 xterm.js 색상만 변경 (UI는 글로벌 테마 유지)

### 테마 구조 (`ThemeDef`)

```typescript
interface ThemeDef {
  id: string                    // 고유 식별자
  name: string                  // 표시 이름
  accent: string                // 테마 카드 미리보기용 액센트 색상
  cssVars: Record<string, string>  // UI CSS 변수 맵
  xtermTheme: { ... }           // xterm.js 터미널 ANSI 색상 16색 + 메타 색상
}
```

---

## 4. 간격 & 레이아웃 (Spacing & Layout)

### 라운딩 (Border Radius)

| 토큰           | 값    | 용도                      |
|----------------|-------|---------------------------|
| `--radius-sm`  | `6px` | 버튼, 토글, 작은 요소       |
| `--radius-md`  | `10px`| 카드, 입력 필드             |
| `--radius-lg`  | `14px`| 모달, 대형 패널             |

### 그림자 (Shadows)

| 토큰            | 값                                         | 용도            |
|-----------------|--------------------------------------------| --------------- |
| `--shadow-sm`   | `0 2px 8px rgba(0,0,0,0.3)`               | 미묘한 깊이       |
| `--shadow-md`   | `0 4px 24px rgba(0,0,0,0.4)`              | 모달, 팝업        |
| `--shadow-glow` | `0 0 30px var(--accent-primary-glow)`      | 네온 글로우 효과   |

---

## 5. 트랜지션 (Transitions)

| 토큰                  | 값                                  | 용도                     |
|-----------------------|-------------------------------------|--------------------------|
| `--ease-out-expo`     | `cubic-bezier(0.16, 1, 0.3, 1)`    | 공통 이징 커브             |
| `--transition-fast`   | `0.15s var(--ease-out-expo)`        | hover, 포커스              |
| `--transition-normal` | `0.25s var(--ease-out-expo)`        | 패널 전환, 버튼 상태 변경    |
| `--transition-slow`   | `0.4s var(--ease-out-expo)`         | 모달 오픈, 큰 레이아웃 변화  |

---

## 6. 세션 상태 표시 (Session Status Indicators)

사이드바의 세션 행에 표시되는 상태 인디케이터:

| 상태       | 인디케이터             | 텍스트 색상            | 애니메이션            |
|------------|----------------------|----------------------|----------------------|
| `idle`     | 도트: `--text-muted`  | `--text-ghost`       | 없음 (반투명)          |
| `thinking` | 도트: `--accent-primary` | `--accent-primary` | 펄스 (1.2s)         |
| `tool`     | 도트: `--accent-warm` | `--accent-warm`      | 페이드 (0.8s)          |
| `agent`    | 도트: `--accent-secondary` | `--accent-secondary` | 펄스 + 스케일 (1.5s) |
| `error`    | 도트: `--accent-danger` | `--accent-danger`  | 없음                   |
| `shell`    | 아이콘: `>_` (모노)    | `--text-muted`       | 없음 (Claude 종료됨)    |
| `exited`   | 도트: `--text-ghost`  | `--text-ghost`       | 없음 (PTY 종료, 더 투명) |

### Shell 모드 감지

Claude Code를 `/exit` 또는 `Ctrl+C`로 종료하면 PTY는 살아있고 일반 셸로 돌아갑니다.
셸 프롬프트 패턴으로 감지합니다:

- `user@hostname:path$` - 일반 셸 프롬프트
- `~/path %` - zsh 기본 프롬프트
- `(venv) $` - 가상환경 프롬프트
- 단순 `$`, `%`, `#` - 최소 프롬프트

Claude 프롬프트(`>`, `❯`)와 구분하여 `shell` 상태로 마킹합니다.
사이드바에서는 도트 대신 `>_` 터미널 아이콘을 표시합니다.

### 상태 감지 아키텍처 (타이밍 + 청크 분석 혼합)

라인 버퍼 전체를 파싱하는 방식의 한계를 극복하기 위해,
**최신 데이터 청크만 분석 + 타이밍 기반 idle 전환** 혼합 방식을 사용합니다.

```
새 데이터 청크 수신
  ↓
classifyChunk(chunk) 분석
  ├─ 스피너 감지 → thinking/tool (즉시 반영)
  ├─ 셸 프롬프트 → shell (즉시 반영)
  ├─ Claude 프롬프트 → idle (즉시 반영)
  └─ 판단 불가(null) → idle 타이머 시작
                         ↓ (1.5초 데이터 없음)
                         idle 상태로 전환
```

- **즉시 반영**: 확실한 패턴(스피너, 프롬프트)이 감지되면 바로 상태 변경
- **타이밍 폴백**: 응답 텍스트 등 판단 불가한 출력 → 1.5초 무응답 시 idle
- **IPC 최적화**: 메인 프로세스에서 16ms 배치 전송, 렌더러에서 150ms 디바운스

---

## 7. 컴포넌트 패턴 (Component Patterns)

### 설정 모달 (SettingsModal)

- **적용/취소 패턴**: 모든 변경은 로컬 draft 상태에서 관리
  - "적용" 버튼: 변경사항을 부모에 전달 후 닫기
  - "취소" 버튼: draft 폐기 후 닫기
  - 변경 없으면 "적용" 버튼 비활성화 (`disabled`)
- **너비**: 440px (max-width: 90vw)
- **최대 높이**: 80vh (스크롤 가능)
- **오버레이**: 반투명 블랙 + `backdrop-filter: blur(4px)`

### 사이드바 (Sidebar)

- **구조**: 드래그 영역 → 헤더 → 프로젝트 그룹 리스트
- **프로젝트 그룹**: 접기/펼치기 가능, 세션 행 리스트 포함
- **리사이즈**: 마우스 드래그로 너비 조절 (180px ~ 500px)
- **macOS 타이틀바**: `-webkit-app-region: drag`로 드래그 가능 영역 처리

### 글래스모피즘 (Glassmorphism)

UI 전반에 사용되는 반투명 유리 효과:
- 배경: `var(--bg-glass)` (약 65% 불투명도)
- hover: `var(--bg-glass-hover)` (약 75% 불투명도)
- 보더: `var(--border-subtle)` (8% 불투명도)
- 글로우: `var(--shadow-glow)` (액센트 색상 기반)

---

## 8. 국제화 (i18n)

지원 언어 4개:

| 코드 | 언어    | 네이티브 라벨 |
|------|---------|-------------|
| `en` | English | English     |
| `ko` | Korean  | 한국어       |
| `ja` | Japanese| 日本語       |
| `zh` | Chinese | 中文         |

- localStorage 키: `mulaude-locale`
- 폴백: 브라우저 언어 → `en`
- 번역 함수: `t(locale, key)` → 문자열 반환

---

## 9. 파일 구조

```
src/renderer/
├── App.tsx              # 루트 컴포넌트 (상태 관리, 레이아웃)
├── App.css              # 글로벌 스타일, 디자인 토큰 (:root)
├── i18n.ts              # 다국어 번역 모듈
├── themes.ts            # 6가지 테마 정의 + 적용 함수
├── settings.ts          # 글씨 크기, 알림 설정 관리
└── components/
    ├── Sidebar.tsx/.css  # 프로젝트/세션 사이드바
    ├── SettingsModal.tsx/.css  # 설정 모달 (적용/취소 패턴)
    └── TerminalView.tsx/.css  # xterm.js 터미널 래퍼
```
