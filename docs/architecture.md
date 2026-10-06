# 架构与版本边界

界面为 React + TypeScript，Vite 生成静态资源；Electron 主进程通过 SQLite 保存作品、章节、人物、世界、计划、记忆、时间线和候选。

`electron/preload.cjs` 只暴露调用、生成任务事件与关闭事件。`main.cjs` 验证 IPC 来自本应用主窗口，`store.cjs` 管理持久化，`context.cjs` 构建写作上下文，`ai.cjs` 和 `codex.cjs` 连接用户选择的模型。

开源版没有 CreativeToolbox、Plaza、Account、ImageApiSettings、auth.cjs、共享服务部署目录、会员二维码或自动更新实现；相关界面入口和 IPC 操作也已移除。资料画布属于核心写作功能，名称 CreativeCanvas 与创意工具箱不是同一模块。

模型设置、本地写作 Skill、备份、回收站和数据目录设置是写作工作台的必要配套，继续保留。Codex 官方授权仅用于用户自己选择的模型，不涉及星喵会员。

独立应用 ID 为 `cn.xingmiao.writer.core`，默认数据目录为 `%APPDATA%/星喵写作开源版/`。未修改完整软件的真实书库。向另一版本迁移时使用备份导出/恢复。

项目组织参考：
- https://github.com/electron-react-boilerplate/electron-react-boilerplate
- https://github.com/JCodesMore/ai-website-cloner-template
