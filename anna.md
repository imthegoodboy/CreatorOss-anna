# Anna App Developer Playbook

Last verified: 2026-06-20 with `anna-app` CLI `0.1.30`.

This is the reusable checklist for building, previewing, validating, packaging, and releasing Anna Apps from this workspace. It is written from the CreatorOS AI build, so the commands are real for this repo.

Official docs used:

- https://anna.partners/dashboard
- https://anna.partners/developers/overview/welcome
- https://anna.partners/developers/reference
- https://anna.partners/developers/reference/cli.md
- https://anna.partners/developers/reference/lifecycle.md
- https://anna.partners/developers/reference/executa-distribution.md
- https://staging.anna.partners/developers/apps/app-intro
- https://staging.anna.partners/developers/apps/app-manifest
- https://staging.anna.partners/developers/apps/app-ui-overview
- https://staging.anna.partners/developers/apps/app-ui-host-api
- https://forum.anna.partners/t/dont-just-run-locally-a-hands-on-guide-to-packaging-anna-executa-as-a-releasable-binary/140

## 1. Current CreatorOS AI State

```text
Workspace: C:\Users\parth\Desktop\CreatorOS-anna
App path: examples\anna-app-creatoros-ai
Host: https://anna.partners
App slug: creatoros-ai
App id: 75
Latest app version: 0.1.15
Latest app version id: 288
Published at: 2026-06-20T18:41:04.632673
Executa handle: bundled:creatoros-planner
Real tool id: tool-nikku696969-creatoros-planner-vhsarfsp
Executa version: 0.1.4
Binary release: creatoros-planner-v0.1.4
Distribution: Binary
```

The current production app is published. Use `apps versions` as the authoritative check:

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
anna-app apps versions creatoros-ai --account https://anna.partners --json
```

On Windows, some Anna CLI commands may print valid JSON and then terminate with:

```text
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

Treat the JSON as useful evidence, but still prefer commands that exit cleanly for automation.

## 2. Mental Model

An Anna App has:

- Listing metadata in `app.json`.
- Runtime contract in `manifest.json`.
- Static UI in `bundle/`.
- Optional Executa tools in `executas/`.
- Local and smoke tests in `tests/`.
- Deployment/runbook notes in `DEPLOY.md` and this file.

CreatorOS AI flow:

```text
User opens CreatorOS AI
  -> bundle/index.html loads inside Anna
  -> UI connects to Anna App Runtime
  -> user chats, uploads media, or opens integrations
  -> UI invokes bundled:creatoros-planner
  -> Python Executa returns plans, schedule packets, channel status, or guarded execution results
  -> UI stores safe workflow state in Anna storage
  -> publishing-oriented actions remain approval-gated
```

## 3. Project Shape

```text
examples/anna-app-creatoros-ai/
  app.json
  manifest.json
  package.json
  README.md
  DEPLOY.md
  tokens.css
  .gitignore
  bundle/
    index.html
    app.js
    style.css
    icon.svg
    anna-tool-ids.js
  executas/
    creatoros-planner-python/
      executa.json
      pyproject.toml
      uv.lock
      creatoros_planner_plugin.py
      package_binary.sh
  tests/
    smoke.mjs
```

Keep generated and local-only files out of git:

```gitignore
.anna/
.anna-local/
.venv/
__pycache__/
*.pyc
node_modules/
test-results/
dist/
dist-anna/
build/
```

## 4. Daily Local Commands

Use production host unless intentionally testing staging:

```powershell
$ANNA_HOST = "https://anna.partners"
```

Do not use `$HOST` in PowerShell. It is a reserved variable.

Check login and developer account:

```powershell
anna-app whoami --json
anna-app doctor
```

Run the app locally:

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
anna-app dev --port 5185 --llm-account https://anna.partners
```

Open:

```text
http://localhost:5185/
```

If port `5185` is busy, use another port:

```powershell
anna-app dev --port 5186 --llm-account https://anna.partners
```

## 5. Validation Gates

Run these before pushing, cutting, or asking for review:

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
npm test
anna-app validate --strict
node --check bundle\app.js
python -m py_compile executas\creatoros-planner-python\creatoros_planner_plugin.py
anna-app executa dev --describe
anna-app executa dev --health
```

Expected current results:

- `npm test` prints `CreatorOS AI smoke test passed.`
- `anna-app validate --strict` prints `validate passed`.
- `executa dev --describe` returns the `creatoros-planner` tool manifest.
- `executa dev --health` returns `status: ok`.

## 6. Manifest Rules

CreatorOS AI uses `schema: 2`, because it has a UI bundle.

Use bundled handles in `manifest.json`:

```json
{
  "required_executas": [
    {
      "tool_id": "bundled:creatoros-planner",
      "min_version": "0.1.4",
      "version": "latest"
    }
  ],
  "ui": {
    "host_api": {
      "tools": ["required:bundled:creatoros-planner"]
    }
  }
}
```

Do not hard-code the real Anna tool ID in `manifest.json`. Let Anna map the bundled handle during push/cut.

The UI should resolve the real tool ID through `bundle/anna-tool-ids.js`:

```js
const toolId =
  window.__ANNA_TOOL_IDS__?.["creatoros-planner"] ||
  "tool-test-creatoros-planner-12345678";
```

## 7. Composio And User Channel Connections

CreatorOS AI supports YouTube, Instagram, and TikTok channel workflows through Composio.

There are two supported key paths:

- Runtime environment key for hosted/local agent operation.
- User-pasted session key in the Integrations view for local preview and user-owned connection checks.

Runtime environment:

```powershell
$env:COMPOSIO_API_KEY = "<composio-project-api-key>"
```

Optional auth config IDs:

```powershell
$env:COMPOSIO_YOUTUBE_AUTH_CONFIG_ID = "<youtube-auth-config-id>"
$env:COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = "<instagram-auth-config-id>"
$env:COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "<tiktok-auth-config-id>"
```

Security rules:

- Do not commit API keys.
- Do not store user session keys in Anna storage.
- Do not echo keys into the UI.
- Do not claim a channel is connected until Composio returns a connected account.
- Do not claim publish/schedule success unless an approved external action returns success.

Known current auth config IDs from the user should stay in private environment/config, not source code.

## 8. Upload, Video, And Publishing Rules

CreatorOS AI supports:

- Plus-button media upload/registration in the chat UI.
- User prompts such as `upload this video to YouTube`.
- Scheduling packets for YouTube/Instagram/TikTok.
- Optional video-generation configuration through user-provided provider settings.
- Guarded execution through the Executa.

Production safety rules:

- Uploaded media can be registered before external publishing is configured.
- Publishing-oriented actions require user approval.
- Scheduling/publishing requires a connected platform account.
- Video generation only runs when the user provides the required provider endpoint/key.
- If a provider key or endpoint is missing, the app must show a blocked/setup-needed state, not fake success.

## 9. Executa Binary Distribution

For real users, prefer Binary distribution so they do not need Python, `uv`, or the source tree.

CreatorOS AI uses:

```text
Tool ID: tool-nikku696969-creatoros-planner-vhsarfsp
Release tag: creatoros-planner-v0.1.4
```

Expected release assets:

```text
tool-nikku696969-creatoros-planner-vhsarfsp-darwin-arm64.tar.gz
tool-nikku696969-creatoros-planner-vhsarfsp-darwin-x86_64.tar.gz
tool-nikku696969-creatoros-planner-vhsarfsp-linux-x86_64.tar.gz
tool-nikku696969-creatoros-planner-vhsarfsp-windows-x86_64.tar.gz
```

Recommended archive layout:

```text
<tool_id>-<platform>.tar.gz
  bin/<tool_id>
  manifest.json
```

Archive `manifest.json` should include:

```json
{
  "runtime": {
    "binary": {
      "entrypoint": {
        "default": "bin/<tool_id>"
      },
      "permissions": {
        "bin/<tool_id>": "0o755"
      }
    }
  }
}
```

Local binary packaging:

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai\executas\creatoros-planner-python
bash package_binary.sh
```

GitHub Actions should build each platform on its native runner. PyInstaller does not reliably cross-compile.

Runner mapping:

```text
macos-14       -> darwin-arm64
macos-15-intel -> darwin-x86_64
ubuntu-latest  -> linux-x86_64
windows-latest -> windows-x86_64
```

## 10. Push, Cut, Review, Release

Push current source to Anna draft:

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
anna-app apps push --account https://anna.partners --json
```

Cut immutable version:

```powershell
anna-app apps cut 0.1.15 --account https://anna.partners --json
```

Submit for review when lifecycle allows it:

```powershell
anna-app apps submit-review creatoros-ai --account https://anna.partners --json
```

Check status:

```powershell
anna-app apps status creatoros-ai --account https://anna.partners --json
anna-app apps versions creatoros-ai --account https://anna.partners --json
```

Release only after Anna approval, or when updating an already published app and the platform allows release:

```powershell
anna-app apps release 0.1.15 --account https://anna.partners --json
```

Current app is already published as `0.1.15`.

## 11. Review-Ready Checklist

Before final review, prove each item:

- App loads in Anna dev harness.
- Chat composer works.
- `@` or platform selection flow works for channel/media intent.
- Plus upload/register flow works without pretending external upload happened.
- Public HTTPS media URL fallback works even before a local upload is selected.
- Integrations view lets the user provide a Composio session key.
- Missing Composio state is clear and does not block the whole UI.
- Connected-channel state depends on Composio/tool response.
- Scheduling and publishing actions are approval-gated.
- Optional video generation is blocked until endpoint/key are configured.
- Anna storage persists safe workflow state only.
- API keys are not persisted or rendered.
- UI does not display raw Composio auth config IDs.
- Desktop and mobile layouts do not overflow.
- `npm test` passes.
- `anna-app validate --strict` passes.
- JS syntax check passes.
- Python compile check passes.
- Executa describe and health checks pass.
- Git worktree is clean or every change is committed intentionally.
- Latest Anna version is published or review state is documented.

## 12. Common Issues

### `Anna runtime is not connected`

The page was opened outside Anna or the dev harness.

Fix:

```powershell
anna-app dev --port 5185 --llm-account https://anna.partners
```

### `Composio API key is missing`

The Executa has neither `COMPOSIO_API_KEY` in its runtime environment nor a session key from the UI.

Fix for local preview:

1. Open Integrations in CreatorOS AI.
2. Paste the Composio API key into the session key field.
3. Check connection again.

Fix for runtime/agent:

```powershell
$env:COMPOSIO_API_KEY = "<composio-project-api-key>"
```

Then restart the dev harness or local agent process so the environment is inherited.

### `No Executa Agent is currently online`

The Anna web app is open, but no local Anna/Matrix Agent is online for the same account.

Fix:

1. Start the local agent.
2. Confirm it uses the same Anna account.
3. Open Anna `More -> Agents`.
4. Confirm the agent is online.
5. Install essentials or reinstall the app tool.
6. Confirm `creatoros-planner` shows Binary/Running.

### `apps release` rejects an already published app

Anna CLI `0.1.30` can return a contradictory lifecycle message because the API returns lowercase `published` while the CLI release guard expects uppercase `PUBLISHED`. Check:

```powershell
anna-app apps versions creatoros-ai --account https://anna.partners --json
```

If the latest version has `published_at`, the release exists.

For the `0.1.15` CreatorOS release, `apps release` hit this bug before publishing. The same authenticated CLI client API successfully published app version id `288`; `apps versions` is the authoritative confirmation.

## 13. Fast Start For The Next Anna App

```powershell
$ANNA_HOST = "https://anna.partners"
$APP = "my-new-app"
$VERSION = "0.1.0"

cd C:\Users\parth\Desktop\CreatorOS-anna\examples
anna-app init $APP --slug $APP
cd $APP

anna-app whoami --json
npm install
npm test
anna-app validate --strict
anna-app dev --port 5185 --llm-account $ANNA_HOST

anna-app apps push --account $ANNA_HOST --json
anna-app apps cut $VERSION --account $ANNA_HOST --json
anna-app apps submit-review $APP --account $ANNA_HOST --json
anna-app apps status $APP --account $ANNA_HOST --json

# After approval:
anna-app apps release $VERSION --account $ANNA_HOST --json
```

## 14. Final Rule

Keep these steps separate:

```text
1. Build and test locally.
2. Push source to GitHub.
3. Push and cut Anna app version.
4. Submit/release only when lifecycle permits it.
```

Do not claim publish, schedule, upload, video generation, or channel connection success unless the actual runtime/tool response proves it.
