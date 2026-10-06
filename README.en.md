# Xingmiao Writer · Open Core Edition

**Membership is free; there is no paid membership plan.** In the complete edition, member and regular-user roles distinguish permissions for managing the community prompt library. Third-party AI and image API providers may charge separately. The open core edition does not include accounts, membership or the community module.

A local-first workspace for long-form fiction. Includes the library, archive, editor, chapter and volume management, AI writing, outlines, characters, worldbuilding, timeline, relationships, material canvases, review, local writing skills, backup and recovery.

[中文](README.md)

The creative toolbox, image tools, shared community, Feishu accounts, membership and bundled update service belong to the complete desktop edition and are absent from this repository. No Xingmiao account is required. Official Codex sign-in remains an optional model connection.

## Development

Use Node.js 24 and npm. Windows 10/11 is the primary desktop platform.

```sh
npm ci
npm start
```

Use `npm run dev` for development, `npm run build` for a production build, `npm test` for business tests, and `npm run test:ui` for isolated desktop tests. Configure your own model endpoint/key or connect a locally installed official Codex client. Provider charges are separate.

On Windows, use `npm run package:win` for an installer or `npm run package:dir` for an unpacked app. Outputs go to `release/`.

## Data and repository

The default database lives in `%APPDATA%/星喵写作开源版/`, separate from the full edition. Use story backup/export and restore to migrate. AI tasks send the selected story context to your configured provider. This edition does not connect to Xingmiao membership/community services.

`src/` contains the React UI, `electron/` the main process and SQLite/AI logic, `tests/` the automated checks, `scripts/` the development entry points, and `docs/` the architecture and edition boundary.

Licensed under [MIT](LICENSE). Third-party dependencies retain their own licenses.

[Download Windows x64](https://github.com/z55902383-debug/xingmiao-writer-core/releases/download/v0.6.4/XingmiaoWriter-Core-0.6.4-x64-Setup.exe) · [Complete edition](https://github.com/z55902383-debug/xingmiao-writer-releases/releases/tag/v0.6.4)

## v0.6.4 verification

On 2026-10-06, type checking, production build, 67 business tests and desktop workflow, compatibility and bilingual checks passed locally. Model tests use a local mock service. Windows x64 installers are provided through Releases after the maintainer uploads them. The binaries are not code signed.

See [features](docs/features.md), [limitations and roadmap](docs/roadmap.md), and [publishing steps in Chinese](docs/GitHub上传步骤.md).

## Step-by-step planning

Idea → book outline → volumes → volume outlines/details → chapter outlines/details → prose → completion. Generate, review and apply each step. Titles and plans synchronize to their destinations, with a suggested next step. Long plans use compact previews and full reading dialogs.

The v0.6.4 update passed type checks, production builds, 67 core business tests and isolated desktop workflow, compatibility and bilingual checks. Provider tests use local fixtures.
