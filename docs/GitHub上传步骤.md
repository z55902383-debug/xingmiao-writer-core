# GitHub 上传与发布步骤 · v0.6.2

## 你会用到的文件

- **开源源码**：`星喵写作【开源】/发布源码/xingmiao-writer-core-0.6.2/`，这是已经清理好的仓库目录。
- **源码压缩包**：同目录旁的 `xingmiao-writer-core-0.6.2-source.zip`，适合作为 Release 附件。仓库应上传解压后的文件，不能只传一个 ZIP。
- **软件和说明**：`星喵写作【打包】/v0.6.2/`。
- **开源软件**：`开源核心版/XingmiaoWriter-Core-0.6.2-x64-Setup.exe`。
- **完整软件**：`完整版/XingmiaoWriter-0.6.2-x64-Setup.exe`，以及 `latest.yml`。本次关闭差分包，不生成完整版 `.blockmap`。
- **使用者说明**：`功能说明.md`；**检查结果**：`项目检查报告-2026-10-06.md`；**完整性校验**：`SHA256SUMS.txt`。

现有开源版采用已经确定的 MIT；完整软件的账号/广场/会员等附加代码不在开源仓库。完整开发目录里有作品备份和内部资料，不要把整个目录拖到 GitHub。

## 推荐：GitHub Desktop 上传源码

1. 登录 GitHub，安装并登录 GitHub Desktop。
2. 在 Desktop 选择 **File → Add local repository**，选择上面的干净源码目录。
3. 若提示不是 Git 仓库，选择 **create a repository here**。确认 Local path 与仓库名称组合后就是该源码目录，且不要再生成嵌套同名文件夹。
4. 初始化时不另选许可证，目录已经有 LICENSE、README 和 .gitignore。
5. 查看 Changes：应看到 `src/`、`electron/`、`tests/`、文档和配置；不应有数据库、个人小说、API key、node_modules、dist、test-results 或安装程序。
6. 填写首次提交说明 `Release open core v0.6.2`，点击 Commit。
7. 点击 **Publish repository**，仓库名称建议 `xingmiao-writer-core`；要公开开源就取消 **Keep this code private**，Description 使用下方简介。
8. 完成后点 View on GitHub，确认首页 README、截图和 MIT 标识正常显示。

如果 Desktop 建库位置有疑问，使用下一节终端方法，它直接在正确目录初始化。

## 备用：命令行上传

先在 GitHub 新建空的公开仓库，名称 `xingmiao-writer-core`，不要让网页自动添加 README、LICENSE 或 gitignore。安装 Git 并完成 GitHub 登录。进入干净源码目录后执行：

```powershell
git init
git add .
git status
git commit -m "Release open core v0.6.2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/xingmiao-writer-core.git
git push -u origin main
```

`YOUR_USERNAME` 必须换成你的 GitHub 用户名。首次提交如果要求设置姓名/邮箱，填写你自己的公开署名或 GitHub 提供的 noreply 邮箱，不必使用私人邮箱。认证用 Desktop/浏览器或个人令牌，不使用账号密码，也不要把令牌写入文档和远程 URL。

不要为了上传使用大文件 LFS 或把依赖塞进仓库；安装包放 Releases。

## 创建开源版 Release

1. 仓库右侧 Releases → **Draft a new release**。
2. 新建标签 `v0.6.2`，目标选择 `main`；标题 `星喵写作开源核心版 v0.6.2`。
3. 正文粘贴本文末尾“开源版发布简介”。
4. 上传开源安装包、干净源码 ZIP、开源版 SHA256 校验文件和功能说明。可以附可运行目录 ZIP，但不能只上传目录中的一个 EXE。
5. 此次仍是 0.x 版本，建议勾选 **This is a pre-release**。确认附件上传结束后发布。
6. 从网页下载一次安装包，核对 SHA256。在第二台 Windows x64 电脑测试安装、重启保存、备份恢复和模型连接。

GitHub 会自动生成 Source code (zip/tar.gz)，它来自标签对应的源码提交，不会自动生成可执行程序。

## 完整软件和自动更新

现有默认更新源是：

`https://github.com/z55902383-debug/xingmiao-writer-releases/releases/latest/download/`

完整软件应发布到这个单独的软件仓库。创建 `v0.6.2` Release，上传完整安装包和同次构建的 `latest.yml`，不能混用开源版或测试版的清单。若后续启用差分构建并生成 `.blockmap`，再一并上传；本次完整软件不需要这个文件。

**正式更新源需要普通 Release，并设为 Latest；GitHub 的 latest 路径通常不指向 pre-release。** 可以先保存为 Draft 检查附件，确认可用再公开。开源仓库的 pre-release 不影响这个独立仓库。

此次生成的 `latest.yml` 使用同一目录下安装包的相对文件名，适合当前 generic 更新地址。若更换安装包直链，回到完整开发项目执行：

```powershell
npm run prepare:update -- --release-dir "../星喵写作【打包】/v0.6.2/完整版" --download-url "https://github.com/YOUR_USERNAME/YOUR_RELEASE_REPO/releases/download/v0.6.2/XingmiaoWriter-0.6.2-x64-Setup.exe"
```

将生成的 `publish/latest.yml` 上传为 Release 的 `latest.yml`。更换仓库还需要用户在软件“版本与更新”修改更新源，或为后续构建更新 release.json。仅发布文件不会自动修改已安装客户端的地址。

不要给 ZIP 写成 .exe，也不要修改清单里的 hash 来掩盖重新打包的差异。发布后先用旧版在隔离/已备份数据下验证检查、下载和安装重启。

## 仓库 About 简介和 Topics

中文简介：本地优先的 AI 小说写作工作台：书架、章节与分卷、大纲、人物与世界、关系图谱、时间线、资料画布、候选审核和备份恢复。Windows 桌面应用，自带模型配置，支持中英双语。

英文简介：A local-first desktop workspace for AI-assisted fiction writing, with outlines, chapters, characters, timelines, material canvases, review and backups.

建议 Topics：`ai-writing`、`novel-writing`、`electron`、`react`、`typescript`、`sqlite`、`local-first`、`windows`、`creative-writing`。

## 开源版发布简介（可直接粘贴）

### 星喵写作开源核心版 v0.6.2

本地优先的小说工作台，无需星喵账号即可管理作品和编辑正文。可接入自己的兼容模型接口或本机 Codex，先审阅 AI 候选，再采用和确认资料变化。

- 书架、分卷、章节编辑、自动保存和历史恢复。
- 大纲、人物、世界、图谱、时间线与资料画布。
- AI 写作、续写、润色、连续性检查、来源记忆和审核同步。
- 本地 Skill、JSON 备份/副本恢复、TXT/Markdown 输出、中英双语与深浅主题。
- 类型检查、58 项业务测试和 9 组桌面回归通过。

**下载**：Windows x64 用户下载 `XingmiaoWriter-Core-0.6.2-x64-Setup.exe`；开发者获取仓库源码后用 Node.js 24 执行 `npm ci`、`npm start`。

核心源码采用 MIT。创意工具箱、生图、飞书账号、会员、共享广场和内置更新属于完整软件附加模块，不包含在本仓库。API 服务由用户自行提供，可能产生费用。

本版本没有代码签名证书，尚未在所有模型供应商和 Windows 环境验证。反馈请提供复现步骤，删除 API 密钥和私人小说内容。

## 参考

本文参考常见项目的 README 结构和 GitHub 官方上传/Release 流程，未复制参考项目的业务代码：

- [AI-Novel-Writer](https://github.com/EthanYoQ/AI-Novel-Writer)
- [novel-engine](https://github.com/john-paul-ruf/novel-engine)
- [上传本地代码](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [发布 Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

本次只准备本地交付物，未创建远程仓库、上传或公开发布。
