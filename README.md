# 冒泡

一个常驻桌面边缘、低打扰、打开即用的办公与开发辅助工具箱。当前版本为 `0.1.0` 开发阶段，Windows 11 x64 是第一版验收平台，macOS 用作前期跨平台开发与验证环境。

## 当前进度

`0.1.0` 的功能开发已收口，当前 macOS 开发版包含：

- Vue 3 + TypeScript + Vite + Pinia + Vue Router。
- Tauri 2 `orb-window` / `panel-window` 双窗口。
- 系统托盘、窗口显隐、面板分类定向通信。
- 设计令牌、浅深色和 reduced-motion 基线。
- Vitest 与 Playwright 测试骨架。
- “冒泡”紫色气泡透明图标及 Tauri 全平台打包图标。
- 5 px 拖动阈值、四边吸附、220 ms 吸附动画与空闲半隐藏。
- 根据当前显示器工作区选择方向的五花瓣扇形布局。
- 明确的动画状态机、错峰展开/收回和 reduced-motion 降级。
- 透明窗口仅在主球与花瓣热区接收鼠标事件的点击穿透原型。
- 悬浮球吸附位置本地保存并按多显示器工作区恢复。
- 五类独立功能面板、通用标题栏、主题、Toast、Confirm 与 Tooltip。
- 健康提醒、文本与图片剪贴板、六项开发转换、文件与路径、快捷入口五类模块。
- 全局快捷键、悬浮球双击动作、开机启动、三种运行模式和本地数据清理。
- 53 个前端单元测试、7 个 Rust 测试与 19 个浏览器交互场景。

使用方法见 [用户说明](docs/user-guide.md)，详细状态见 [开发进度](docs/progress.md)，完整需求见 [产品说明](docs/product-spec.md)。

## 环境要求

- Node.js 20+ 或 22+（当前开发环境使用 Node.js 22）
- pnpm 10
- Rust stable
- macOS：Xcode Command Line Tools
- Windows：Microsoft C++ Build Tools 与 WebView2

## 开发

```bash
pnpm install
pnpm tauri dev
```

若通过 Homebrew 安装了 keg-only 的 rustup，可在当前终端执行：

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
rustup default stable
pnpm tauri dev
```

只预览前端窗口：

```bash
pnpm dev
```

- 悬浮球预览：`http://localhost:1420/?window=orb`
- 面板预览：`http://localhost:1420/?window=panel`

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
```

macOS 应用打包：

```bash
pnpm tauri build --bundles app
```

产物位于 `src-tauri/target/release/bundle/macos/冒泡.app`。Windows 安装包必须在 Windows 11 x64 上执行 `pnpm tauri build`，详见 [发布检查清单](docs/release-checklist.md)。

## 隐私与安全

核心功能按离线运行设计，不包含遥测和内容上传。Tauri capability 按窗口拆分，系统调用通过前端适配层与受控 Rust command 暴露。剪贴板、JWT、文件路径等用户内容不得写入普通日志。

## 平台说明

- macOS：用于开发期运行和跨平台逻辑验证。
- Windows 11 x64：正式验收目标；透明窗口命中、多显示器缩放、全局快捷键、开机启动、外部应用启动和安装包必须在 Windows 设备复验。
- Linux：不在第一版验收范围。
