# Xingmiao Writer · Open Core

A local-first fiction workspace for manual writing and your own AI provider.

**v0.6.10 · Windows x64 · MIT**

[Windows installer](https://github.com/z55902383-debug/xingmiao-writer-core/releases/download/v0.6.10/XingmiaoWriter-Core-0.6.10-x64-Setup.exe) · [Full edition](https://github.com/z55902383-debug/xingmiao-writer-releases/releases/tag/v0.6.10) · [中文](README.md)

Full-edition membership is free and manages community template permissions. Model services may charge separately. Open Core needs no Xingmiao account.

![Current library](docs/assets/library.png)

![Writing workspace](docs/assets/workspace.png)

![Story data assistant](docs/assets/knowledge-assistant.png)

Screenshots use isolated demonstration content; the application also supports English.

## Features

- Short-story and volume workflows, reviewed adoption into named targets, and chapter drafting.
- Manual writing pad, independent drafts, focus timer, manuscript formatting and history.
- Story data conversations: individual review, recheck, undo and deleted-record recovery.
- Editable styles, requirements and skills with per-request reference selection.
- Characters, world settings, relationships, timelines, canvases, memos, autosave and trash.
- Author-confirmed completion, TXT/Markdown export, JSON backups and copy restore.

## Development

Use Node.js 24: `npm ci`, then `npm start`. Development: `npm run dev`.

Checks: `npm test`, `npm run build`, `npm run test:onboarding:ui` and `npm run test:ui`. Windows builds: `npm run package:win`.

## Data and license

Books stay local. AI sends selected context to the configured provider. Backups include final story data, chapter history, skills and trash, but exclude credentials, account sessions, story-data conversations and proposal undo history. Restore creates copies.

Full-edition accounts, community, creative tools, images and updates are excluded from this MIT repository. Editions use separate book directories. Mock tests do not certify real-provider quality or availability. Windows installers are unsigned.

[Features](docs/features.md) · [Verification](docs/检查记录-v0.6.10.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT](LICENSE)
