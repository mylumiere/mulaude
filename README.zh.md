[English](README.en.md) | [한국어](README.md) | [日本語](README.ja.md) | **中文**

# Mulaude

**多会话 Claude Code 终端** — 同时管理多个 Claude Code 会话的 macOS 桌面应用

## 主要功能

- **多会话**: 在多个项目中同时运行独立的 Claude Code 会话
- **终端网格分割**: 基于二叉树的水平/垂直自由分割（最多6个面板），拖拽交换/重新排列面板位置
- **会话持久化**: 基于 tmux — 关闭应用后会话仍然保持，重启时自动恢复
- **代理/团队视图**: 当 Claude 的团队模式激活时，通过分割面板实时监控子代理
- **Hook 集成**: 通过 Claude Code Hooks 系统实现精确的状态追踪（idle、thinking、tool、permission 等）
- **交互式教程**: 首次启动时的7步引导（语言/主题设置→项目创建→分割→快捷键）
- **6种主题**: Void、Ocean、Ember、Forest、Arctic、Rosé
- **4种语言**: English、한국어、日本語、中文
- **用量监控**: 在侧边栏实时查看 Claude 计划用量

## 安装

### 方法1: DMG 下载（普通用户）

1. 从 [Releases](https://github.com/mylumiere/mulaude/releases) 下载最新的 `.dmg` 文件
2. 挂载 DMG → 将 Mulaude 拖入 Applications
3. 首次启动时可能出现"已损坏，无法打开"或"未验证的开发者"警告：

   **在终端中运行以下命令：**
   ```bash
   xattr -cr /Applications/Mulaude.app
   ```
   或前往 `系统设置` > `隐私与安全` > `仍然打开`

   > 由于应用未进行代码签名，macOS Gatekeeper 会阻止运行。上述命令可移除隔离属性以正常启动。

### 方法2: 源码构建（开发者）

```bash
git clone https://github.com/mylumiere/mulaude.git
cd mulaude
npm install
npm run dev
```

### 前置要求

| 要求 | 安装方式 | 必需 |
|------|---------|------|
| **macOS** | — | ✅ |
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) | ✅（源码构建时） |
| **tmux** | `brew install tmux` | ✅ |
| **Claude Code CLI** | `npm i -g @anthropic-ai/claude-code` | ✅ |

> Claude Code CLI 必须已完成认证（确认 `claude` 命令可正常运行）。

## 使用方法

### 首次启动

1. 启动应用 → 选择语言/主题 → 开始教程
2. 按照教程体验项目创建、会话添加、分割等操作
3. 教程可跳过，随时从侧边栏底部重新开始

### 基本工作流

1. 点击 `+` 按钮或 `⌘N` → 选择项目目录
2. 自动创建会话，在所选目录中运行 `claude` CLI
3. 可在同一项目中添加更多会话，或添加其他项目
4. 通过侧边栏切换会话、查看状态

### 网格分割

- 从侧边栏**拖拽**会话到终端区域 → 自动分割
- 拖拽面板标题栏交换/重新排列位置
- `⌘W` — 关闭当前聚焦的面板
- `⌘⇧↵` — 切换聚焦面板的缩放
- `⌘←→↑↓` — 在面板间移动焦点

### 快捷键

| 快捷键 | 操作 |
|--------|------|
| `⌘,` | 设置 |
| `⌘/` | 快捷键列表 |
| `⌘N` | 新建项目 |
| `⌘1~9` | 切换当前项目内的会话 |
| `⌥⌘1~9` | 切换项目 |
| `⌘↑↓` | 上一个/下一个会话 |
| `⌘W` | 关闭面板 |
| `⌘⇧↵` | 缩放切换 |
| `⌘←→↑↓` | 网格面板焦点移动 |
| `⌥⌘←→↑↓` | 代理面板焦点移动 |

### 团队模式

在 Claude Code 中使用团队模式（TeamCreate）时：
- 自动检测子代理的 tmux 面板
- 在侧边栏显示代理树
- 终端区域分割为多个面板，实时监控代理输出

## 构建

```bash
# 生产构建
npm run build

# macOS DMG 打包
npm run package:dmg

# macOS 全量（DMG + ZIP）
npm run package:mac
```

构建产物位于 `release/` 目录。

## 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | Electron 33 |
| UI | React 19 + TypeScript 5.9 |
| 终端 | xterm.js 6 |
| PTY | node-pty 1.1（基于 tmux） |
| 构建 | electron-vite 5 |
| 打包 | electron-builder 26 |

## 项目结构

```
src/
├── main/                      # Electron Main 进程
│   ├── index.ts               # 应用入口
│   ├── ipc-handlers.ts        # IPC 处理器注册
│   ├── session-manager.ts     # 会话创建/销毁、PTY 管理
│   ├── session-store.ts       # ~/.mulaude/sessions.json 持久化
│   ├── session-forwarder.ts   # 会话数据批量转发
│   ├── env-resolver.ts        # Shell 环境变量/Claude 路径探测
│   ├── pane-poller.ts         # 代理面板轮询
│   ├── team-config-scanner.ts # 团队 config 扫描/缓存
│   ├── agent-matcher.ts       # 代理-面板匹配
│   ├── close-handler.ts       # 关闭对话框
│   ├── hooks-manager.ts       # Claude Code Hooks 监听
│   ├── child-pane-streamer.ts # 子面板流式传输
│   └── tmux-utils.ts          # tmux 命令工具
├── preload/
│   └── index.ts               # contextBridge API
├── renderer/                  # React 应用
│   ├── App.tsx                # 根组件
│   ├── i18n.ts                # 国际化
│   ├── themes.ts              # 6种主题
│   ├── roadmap.ts             # 路线图数据
│   ├── settings.ts            # 设置类型/工具
│   ├── pty-parser.ts          # PTY 输出解析器
│   ├── hooks/                 # React 自定义 hooks（11个）
│   ├── utils/                 # 纯工具函数
│   │   ├── pane-tree.ts       # 二叉树数据结构/运算
│   │   └── pane-storage.ts    # 布局 localStorage 持久化
│   └── components/            # React 组件（15个）
└── shared/
    ├── types.ts               # 共享类型
    └── constants.ts           # 共享常量（41个）
```

## 贡献

欢迎在 [Issues](https://github.com/mylumiere/mulaude/issues) 提交 Bug 报告和功能建议。

## 许可证

MIT
