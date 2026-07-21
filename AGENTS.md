# 花瓣工具箱协作约定

## 产品事实来源

- `docs/product-spec.md` 是产品、交互、技术约束与验收标准的唯一事实来源。
- 若实现与说明书冲突，先修正实现；只有用户明确改变需求时才更新说明书。
- 每个开发阶段完成后更新 `docs/progress.md`，如实区分已验证、待验证和平台限制。

## 技术约束

- 固定采用 Vue 3、TypeScript、Vite、Pinia、Vue Router、Tauri 2、Vitest。
- 系统调用必须经过 `src/services/tauri`，UI 组件不得直接调用 SQL 或 Rust command。
- 持久数据通过 repository 层访问；设置使用 Tauri Store，业务数据使用 SQLite。
- Rust 保持为系统能力薄层，不重复实现能在前端安全完成的转换业务。
- Tauri capability 按窗口拆分，并维持最小权限。

## 质量要求

- 新增逻辑优先写可单测的纯函数；相关阶段必须补测试。
- 不使用 `any` 绕过类型约束，不记录剪贴板正文、JWT、文件二进制等隐私内容。
- 所有交互必须支持键盘焦点和 `prefers-reduced-motion`。
- 不伪造 Windows、macOS、E2E、安装包或性能测试结果。
- 当前可先在 macOS 开发；Windows 专属能力必须通过平台适配层隔离，并标记待 Windows 11 验证。

## 工作方式

- 新增依赖前确认用途，避免引入重复的 UI、状态或动画方案。
- 保持功能模块边界，不直接引用其他功能的内部实现。
- 提交前运行与改动相关的类型检查、单元测试和构建检查。
