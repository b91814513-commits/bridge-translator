# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## Project Overview

KISS Translator is a multi-platform browser extension that provides in-page translation, subtitle translation, selection translation, and input-box translation. A single codebase produces **Chrome/Edge/Firefox/Thunderbird extensions**, a **web homepage**, and **Tampermonkey userscripts** via Webpack multi-config builds driven by the `REACT_APP_CLIENT` environment variable.

## Commands

**Package manager**: pnpm 9.14.4 (pinned in `.pnpm-version`)

### Development

```bash
pnpm start              # Web dev server (REACT_APP_CLIENT=web)
pnpm start:userscript   # Userscript dev server (REACT_APP_CLIENT=userscript)
```

For extension development, build and load unpacked:
```bash
pnpm build:chrome       # Build Chrome extension → build/chrome/
pnpm build:firefox      # Build Firefox extension → build/firefox/
pnpm build:edge         # Build Edge extension → build/edge/
```

### Build

```bash
pnpm build              # Full build: all targets + rules + format
pnpm build:chrome       # Chrome only
pnpm build:edge         # Edge only
pnpm build:firefox      # Firefox only
pnpm build:web          # Web homepage + options
pnpm build:userscript-ios  # iOS Safari userscript
pnpm build:rules        # Regenerate built-in rules JSON + version.txt (babel-node)
pnpm build+zip          # Build all + package zips (CI=true)
```

### Test & Format

```bash
pnpm test               # Run all tests (Jest via react-app-rewired)
pnpm test -- --watch    # Watch mode
pnpm test -- src/libs/translator.test.js   # Run a single test file
pnpm format             # Prettier (double quotes, semicolons, 2-space indent, printWidth 80)
```

### Version Management

Version is sourced from `package.json` and synced everywhere via `pnpm sync-version`. Use `pnpm version:patch`, `pnpm version:minor`, or `pnpm version:major` to bump and auto-sync.

## Architecture

### Entry Points & Runtime Contexts

Each entry sets `globalThis.__KISS_CONTEXT__` to identify the host environment:

| Entry | Context | Role |
|---|---|---|
| `src/background.js` | `"background"` | MV3 Service Worker — message routing, CSP bypass via declarativeNetRequest, stream fetch proxy |
| `src/content.js` | `"content"` | Content Script — calls `common.run(false)` |
| `src/userscript.js` | — | Userscript — calls `common.run(true)` |
| `src/common.js` | — | **Core orchestrator** shared by content + userscript: loads settings, matches rules, starts TranslatorManager, subtitle system |
| `src/popup.js` | `"popup"` | Extension popup (React) |
| `src/options.js` | `"options"` | Extension options page (React) |
| `src/index.js` | — | Web homepage entry (React) |
| `src/injector-shadowroot.js` | — | Overrides `attachShadow` to notify content script of Shadow DOM creation |
| `src/injector-subtitle.js` | — | Overrides `XMLHttpRequest.open` to intercept YouTube timedtext requests |

### Build System (config-overrides.js)

Three Webpack configurations selected by `REACT_APP_CLIENT`:
- **extWebpack** (chrome/edge/firefox/thunderbird): 6 entry points, no code splitting, fixed filenames (no hash)
- **userscriptWebpack** (userscript): 3 entry points, injects GM metadata banner, Terser minification
- **webWebpack** (web): 3 entry points, standard SPA build

### Key Modules

**`src/libs/translator.js`** (97KB) — The translation engine core: DOM traversal, node translation, style injection, paragraph splitting. This is the largest and most complex file.

**`src/libs/translatorManager.js`** — Lifecycle manager coordinating Translator instances, SPA navigation detection, FAB/popup/input-translate/mouse-hover features.

**`src/apis/trans.js`** (2108 lines) — Concrete implementations for 25+ translation engines (Google, Microsoft, DeepL, OpenAI, Gemini, Claude, DeepSeek, etc.). Request construction and response parsing.

**`src/apis/index.js`** — API dispatch layer: caching, batch queueing, prompt assembly, unified entry for translate/dictionary/subtitle/summary requests.

**`src/config/api.js`** (1075 lines) — All API constants: timeouts, batch params, engine definitions, language mappings, default prompt templates.

**`src/config/prompt.js`** (948 lines) — Prompt management: presets, categories, versioning, templates.

**`src/libs/rules.js`** — Rule matching engine: URL pattern matching, selector merging across three tiers (personal > subscription > built-in).

### Subsystems

**`src/hooks/`** (34 files) — React hooks for the options/popup UI: settings, storage, theme, API config, rules, sync, shortcuts, subtitle, custom styles, etc.

**`src/views/Options/`** (29 files) — Options page views: API config, rule management, settings, favorites, prompts, subtitle config, sync, tranbox, input settings, mouse hover, styles, playground.

**`src/views/Selection/`** (18 files) — Selection/popup translation UI: TranBox, dictionary handlers, audio, favorites, copy, Zdic (汉典), draggable/resizable container.

**`src/subtitle/`** (19 files) — YouTube subtitle translation: `BilingualSubtitleManager`, `YouTubeCaptionProvider`, `YouTubeSubtitleList`, AI segmentation, sentence breaking, VTT parsing, word-hover translation.

**`src/scripts/`** (7 files) — Build utility scripts (zx-based): `build-task.mjs` (generic build with `--target`), `sync-version.mjs`, `archive.mjs`, Safari/iOS builds.

### Messaging Architecture

- **Extension internal**: `browser.runtime.onMessage` with a `messageHandlers` map in `background.js`
- **Streaming**: `browser.runtime.onConnect` long-lived ports (`PORT_STREAM_FETCH`) for SSE data
- **Page ↔ Content Script**: `window.postMessage` + CustomEvent (sandbox piercing)
- **Keyboard shortcuts**: `browser.commands.onCommand` (Alt+K popup, Alt+Q toggle, Alt+S selection, Alt+C style cycle)

### Injection System

Two standalone Webpack entries exposed as `web_accessible_resources`:
- **Shadow DOM injector** (`injectors/shadowroot.js`): Rewrites `Element.prototype.attachShadow`, notifies content script via `postMessage` so translation can penetrate Shadow DOM
- **XHR subtitle injector** (`injectors/xmlhttp.js`): Rewrites `XMLHttpRequest.prototype.open`, intercepts YouTube `timedtext` requests, passes caption data back via `postMessage`

In extension mode, scripts are injected via `browser.runtime.getURL()` + `<script src>`. In userscript mode, they are serialized to IIFE strings and injected as inline `<script>`.

### Storage & Sync

- **Extension**: `chrome.storage.local` / `browser.storage.local` (via `webextension-polyfill`)
- **Userscript**: `GM.setValue` / `GM.getValue`
- **Cloud sync**: Three backends — KISS-Worker (Cloudflare), WebDAV, GitHub Gist
- **Versioned keys**: Storage keys include major version (`_v2`) for data isolation; `runDataMigration()` handles upgrades
- **HTTP cache**: CacheStorage API, default 7-day TTL

### CSP Bypass (MV3)

Uses `declarativeNetRequest` to dynamically strip third-party Content-Security-Policy headers and spoof the Origin header, enabling translation API calls from any page context.

## Code Style

- **Prettier**: double quotes, semicolons, 2-space indent, trailing commas (es5), 80 char width
- **ESLint**: extends `react-app` and `react-app/jest`
- **Globals declared for lint**: `GM`, `unsafeWindow`, `globalThis`, `messenger`, `LanguageDetector`, `Translator`
- **Test files**: `*.test.js` colocated with source files

## Release Flow

Dual-branch model: `master` (production) + `dev` (development). No direct pushes to master. PR merge + git tag `v*` triggers GitHub Actions: build all targets → create release from CHANGELOG.md → upload 5 zip packages (chrome/edge/firefox/userscript/thunderbird) + deploy web to GitHub Pages.
