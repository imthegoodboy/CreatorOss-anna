# CreatorOS AI

CreatorOS AI is a schema 2 Anna App that turns one creator growth goal into a reviewable content sprint for YouTube, Instagram, and setup-ready TikTok.

## What is included

- `manifest.json` - Anna App manifest with a static UI bundle and bundled Executa.
- `bundle/` - sandboxed static SPA loaded by the Anna App UI Runtime.
- `executas/creatoros-planner-python/` - Python stdio Executa used by the UI.
- `tests/smoke.mjs` - local manifest and Executa smoke test.

## Local development

```bash
cd examples/anna-app-creatoros-ai
npm test
anna-app validate --strict
anna-app dev
```

The app works in standalone preview mode without Anna host RPCs. In Anna, it uses:

- `tools.invoke` for `creatoros-planner`.
- `storage.get/set/delete/list` for campaign memory.
- `files.upload_init/upload_finalize` when Anna Files is available for durable user media storage.
- `upload.inline/negotiate/confirm` as a secondary host-upload path when the host grants `upload_grant`.
- `llm.complete` plus `agent.session` fallback for short Anna-hosted operator notes.
- `chat.append_artifact` for review packet handoff.
- `image.generate` for optional thumbnail image generation.
- `agent.session` for short Anna-hosted operator notes when the host grants it. The bundled Executa remains the source of truth for plans, uploads, connection checks, scheduling packets, and guarded task execution.

## Integrations

- Composio is configured with the runtime environment variable `COMPOSIO_API_KEY`.
- `Connect media` uses Composio connected-account auth links. The current local runtime has managed Composio auth configs for YouTube and Instagram, so those platforms can return hosted authorization links.
- TikTok requires a custom Composio OAuth auth config with your own TikTok client credentials, then `COMPOSIO_TIKTOK_AUTH_CONFIG_ID` must be set.
- Scheduling stays in `Needs Connected Channel` until Composio reports an active connected account for the selected platform.
- Task execution is explicit: the user must approve a task and then click Execute. The Executa blocks with structured statuses such as `needs_user_approval`, `needs_connected_channel`, `scheduled_waiting`, or `needs_public_media_url` before any live Composio call is attempted.
- Video generation uses a user-provided provider key entered in the app. The key is held only for the current app session and passed to the bundled Executa when preparing or submitting a video job.
- If Anna cannot make an uploaded video provider-accessible, the Uploads page lets the user attach a public HTTPS media URL before live publishing checks.
- If a video endpoint is not configured, the app returns a sanitized provider packet that can be reviewed before submission. If an endpoint is configured, the Executa only submits to public HTTPS provider endpoints.
- If Anna Files or host upload is not granted in the current runtime, user-selected media is still registered as `Local Ready` so the workflow can be planned and scheduled without falsely claiming cloud upload success.

## Privacy

Local development state is stored by the Anna harness or by the planner Executa under `~/.anna/creatoros-ai/state.json`. The app does not publish, upload, or generate external videos unless runtime credentials and connected provider accounts are configured, the media is provider-accessible, and the user explicitly approves the task.
