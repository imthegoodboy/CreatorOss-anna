# CreatorOS AI

CreatorOS AI is a production-ready Anna App that acts like a creator operations chatbot. A user can describe a growth goal, select target platforms with `@` mentions, upload or attach media, connect social channels, prepare publishing tasks, and ask the agent for workflow status.

The app is intentionally review-gated: it prepares plans, captions, scripts, media packets, thumbnail briefs, and video-job briefs, but it does not claim publishing or video generation success unless the user approves the task and the external provider returns success.

## What It Does

- Turns a creator goal into a multi-day content sprint.
- Supports YouTube, Instagram, and setup-ready TikTok workflows.
- Provides a ChatGPT-style Anna UI with separate Chat, Workflow, Uploads, and Integrations views.
- Lets users select platforms through `@YouTube`, `@Instagram`, and `@TikTok`.
- Registers local uploads through Anna host upload APIs when available.
- Allows a public HTTPS media URL fallback when host upload is not available.
- Creates Composio OAuth links for connected media accounts.
- Tracks active and expired/reconnect-needed channel state.
- Uses Anna storage for workflow memory.
- Uses Anna host LLM and agent APIs for short operator notes when granted.
- Keeps final publishing and external execution behind explicit user approval.

## Architecture

```text
Anna App UI
  -> Anna App Runtime
  -> tools.invoke(required:bundled:creatoros-planner)
  -> Python Executa over stdio JSON-RPC
  -> Anna storage / files / upload APIs
  -> Composio for social account connection and guarded execution
  -> Optional user-supplied video provider endpoint
```

Key files:

- `app.json` - Anna listing metadata.
- `manifest.json` - schema 2 Anna App contract, host API grants, and bundled Executa declaration.
- `bundle/index.html` - static UI shell.
- `bundle/style.css` and `bundle/tokens.css` - Hallmark-stamped production UI system.
- `bundle/app.js` - chatbot workflow, Anna runtime calls, storage, upload handling, and UI state.
- `executas/creatoros-planner-python/creatoros_planner_plugin.py` - bundled Python Executa.
- `tests/smoke.mjs` - manifest, UI contract, and Executa protocol smoke test.
- `DEPLOY.md` - release and verification runbook.

## Current Release

```text
App slug: creatoros-ai
App version: 0.1.16
Anna app id: 75
Latest version id: 303
Published at: 2026-06-20T21:06:24.556714
Tool id: tool-nikku696969-creatoros-planner-vhsarfsp
Executa version: 0.1.4
Distribution: binary
```

The Executa binary release is available as `creatoros-planner-v0.1.4` with artifacts for:

- `darwin-arm64`
- `darwin-x86_64`
- `linux-x86_64`
- `windows-x86_64`

## Local Development

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
npm test
anna-app validate --strict
anna-app dev --port 5185 --llm-account https://anna.partners
```

Open the dev harness URL and try:

```text
Plan a 7 day AI education sprint @YouTube @Instagram
```

Then use:

- `Status` in chat to inspect agent state.
- `Uploads` to add a local file or public HTTPS media URL.
- `Integrations` to check Composio and connect a media channel.
- `Workflow` to review scheduled actions and approval gates.

## Runtime Configuration

For real Composio checks and connection links, set runtime environment variables outside git:

```powershell
$env:COMPOSIO_API_KEY = "<composio-project-api-key>"
$env:COMPOSIO_YOUTUBE_AUTH_CONFIG_ID = "<youtube-auth-config-id>"
$env:COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = "<instagram-auth-config-id>"
```

TikTok requires a custom Composio OAuth auth config:

```powershell
$env:COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "<tiktok-auth-config-id>"
```

Users can also paste a session-only Composio key in the Integrations page. Session keys and video provider keys are kept in memory for the current app session and are not committed or persisted by this app.

## Safety Model

- Publishing-oriented actions require explicit user approval.
- A task cannot execute live until a matching platform account is active.
- Media must be provider-accessible before live execution; otherwise the app requests a public HTTPS URL.
- Video generation only submits to public HTTPS endpoints.
- Local/private/reserved video endpoints are blocked by the Executa.
- The app returns setup-needed states instead of pretending an integration succeeded.

## Validation

Core checks:

```powershell
npm test
anna-app validate --strict
node --check bundle\app.js
python -m py_compile executas\creatoros-planner-python\creatoros_planner_plugin.py
anna-app executa dev --describe --json
anna-app executa dev --health --json
```

Rendered QA should cover:

- App loads inside the Anna dev harness.
- Chat prompt, `@` platform selection, and status prompt work.
- Integrations page reports Composio readiness accurately.
- Connect media returns an auth link when auth config exists.
- Uploads page accepts a public HTTPS media URL without requiring a local file first.
- Desktop and mobile layouts have no horizontal overflow.

## Deployment

See [DEPLOY.md](DEPLOY.md) for the full release procedure, binary packaging notes, Anna CLI lifecycle commands, and known CLI quirks.
