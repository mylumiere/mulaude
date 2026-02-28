/**
 * roadmap.ts - 개발 로드맵 데이터
 *
 * 앱 내 로드맵 다이얼로그에서 사용하는 마일스톤 + 기능 목록.
 * 기능이 구현되면 status를 'done'으로 변경합니다.
 */

export type FeatureStatus = 'planned' | 'in-progress' | 'done'

export interface RoadmapFeature {
  /** 기능명 (번역 키 아님, 직접 표시) */
  title: string
  /** 한줄 설명 */
  desc: string
  /** 진행 상태 */
  status: FeatureStatus
}

export interface Milestone {
  version: string
  title: string
  features: RoadmapFeature[]
}

export const ROADMAP: Milestone[] = [
  {
    version: 'v1.0',
    title: 'Core',
    features: [
      { title: 'Multi-Session Terminal', desc: 'tmux 기반 다중 Claude Code 세션 동시 관리', status: 'done' },
      { title: 'Project Groups', desc: '프로젝트 → 세션 계층 구조로 사이드바 정리', status: 'done' },
      { title: 'Session Persistence', desc: '앱 재시작 시 세션 자동 복원 (~/.mulaude/sessions.json)', status: 'done' },
      { title: 'Terminal Grid Split', desc: '이진 트리 기반 수평/수직 자유 분할 (최대 6패인)', status: 'done' },
      { title: 'Grid Drag & Drop', desc: '패인 드래그로 위치 교환 및 재배치', status: 'done' },
      { title: 'Grid Persistence', desc: '그리드 레이아웃 상태 새로고침 시 유지', status: 'done' },
      { title: 'Pane Zoom', desc: '포커스된 패인 전체 확대/복원 (⌘⇧↵)', status: 'done' },
      { title: 'Agent Pane Detection', desc: 'Claude Code 에이전트 자동 감지 + 전용 패널 표시', status: 'done' },
      { title: 'Session Status', desc: 'PTY + Hook 기반 세션 상태 실시간 감지 (idle/busy/error)', status: 'done' },
      { title: 'Desktop Notifications', desc: '세션 상태 변경 시 데스크톱 알림 (이벤트별 토글)', status: 'done' },
      { title: '6 Themes', desc: 'Void, Ocean, Ember, Forest, Arctic, Rosé 테마', status: 'done' },
      { title: '4 Languages', desc: 'English, 한국어, 日本語, 中文 다국어 지원', status: 'done' },
      { title: 'Keyboard Shortcuts', desc: '세션/프로젝트/그리드/에이전트 패인 단축키 체계', status: 'done' },
      { title: 'Usage Gauge', desc: 'Claude API 사용량 실시간 게이지 표시', status: 'done' },
      { title: 'Settings Modal', desc: '테마, 글씨 크기, 알림, 언어, HUD 설정 (⌘,)', status: 'done' },
    ]
  },
  {
    version: 'v1.1',
    title: 'Quality of Life',
    features: [
      { title: 'Pin Sessions', desc: '중요 세션을 사이드바 상단에 고정', status: 'planned' },
      { title: 'Session Emoji', desc: '세션별 커스텀 이모지 아이콘으로 시각 구분', status: 'planned' },
      { title: 'Smart Session Name', desc: 'Claude 대화 분석으로 의미있는 세션명 자동 생성', status: 'planned' },
      { title: 'Auto Theme', desc: '시스템 다크/라이트 모드 연동 자동 전환', status: 'planned' },
      { title: 'Drag to Reorder', desc: '드래그로 사이드바 세션 순서 변경', status: 'planned' },
    ]
  },
  {
    version: 'v1.2',
    title: 'Search & Export',
    features: [
      { title: 'Conversation Search', desc: '모든 세션 대화를 전문 검색 (⌘⇧F)', status: 'planned' },
      { title: 'Export to Markdown', desc: '대화 기록을 Markdown/HTML로 내보내기', status: 'planned' },
      { title: 'Toast Customization', desc: '알림 위치, 지속 시간, 스타일 조정', status: 'planned' },
      { title: 'Auto Cleanup', desc: 'N일 미사용 세션 자동 아카이브 제안', status: 'planned' },
    ]
  },
  {
    version: 'v1.3',
    title: 'Analytics Dashboard',
    features: [
      { title: 'Usage Dashboard', desc: '일별/주별 세션 수, 토큰 사용량 그래프', status: 'planned' },
      { title: 'Tool Statistics', desc: 'Read, Edit, Bash 등 도구별 사용 빈도 통계', status: 'planned' },
      { title: 'Token Budget', desc: '일/주별 토큰 사용 한도 설정 + 경고', status: 'planned' },
      { title: 'Session Timeline', desc: '과거 세션을 시간축 타임라인으로 탐색', status: 'planned' },
    ]
  },
  {
    version: 'v1.4',
    title: 'Advanced Layout',
    features: [
      { title: 'Tab-based UI', desc: '사이드바 ↔ 브라우저 탭 스타일 전환', status: 'planned' },
      { title: 'Drag Between Projects', desc: '프로젝트 그룹 간 세션 드래그&드롭 이동', status: 'planned' },
      { title: 'Session Snapshots', desc: '세션 스크롤백 스냅샷 저장 & 복원', status: 'planned' },
    ]
  },
  {
    version: 'v2.0',
    title: 'Skill System',
    features: [
      { title: 'Plugin Architecture', desc: '서드파티 확장을 위한 플러그인/스킬 API', status: 'planned' },
    ]
  }
]
