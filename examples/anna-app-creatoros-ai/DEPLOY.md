# Deploy CreatorOS AI

This app is a schema 2 Anna App with a static UI bundle and one bundled Python Executa.

## Prerequisites

- Anna CLI on `PATH`.
- `uv` on `PATH` for the Python Executa.
- An Anna account session for staging or production: `anna-app login --host https://staging.anna.partners`.
- A verified Anna developer account. The server rejects app publish/list/push calls with `403: Verified developer required` until this is enabled.
- A configured Anna handle if the CLI asks for one: `anna-app account set-handle <handle>`.
- For hosted production, a Composio project API key stored as a runtime secret named `COMPOSIO_API_KEY`.

Do not commit API keys. Users can also paste a Composio API key and a video provider key inside the app; those keys are held only for the current app session and are not persisted.

## Local Validation

```powershell
cd C:\Users\parth\Desktop\CreatorOS-anna\examples\anna-app-creatoros-ai
npm test
anna-app validate --strict
```

Run the Anna dev harness:

```powershell
anna-app dev --port 5180 --no-llm
```

For real Anna LLM/agent behavior, run the dev harness with the account/app flags required by your Anna environment instead of `--no-llm`.

Production preview command:

```powershell
anna-app validate --strict
anna-app dev --port 5182 --llm-account https://anna.partners
```

If this fails with `developer handle required` or `403: Verified developer required`, the local bundle is valid but the account cannot register the dev app until Anna developer verification/handle setup is completed.

## Login

Use the device login flow:

```powershell
anna-app login --host https://staging.anna.partners --no-browser
anna-app whoami --json
```

The account output should show `current` as `https://staging.anna.partners` and include a PAT with app developer scope. If `apps list`, `apps push`, or `apps publish` returns `Verified developer required`, complete developer verification in Anna before retrying.

## Runtime Secrets

Set hosted Composio access only in the shell, deployment environment, or Anna secret configuration:

```powershell
$env:COMPOSIO_API_KEY = "<your-composio-project-api-key>"
```

Optional override:

```powershell
$env:COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3.1"
```

### Composio Media Channel OAuth

`COMPOSIO_API_KEY` lets the app probe Composio and list connected accounts. Users can also paste a session-only Composio API key in the Integrations view for local/dev testing. To create a real `Connect media` OAuth link, the Composio project must also have auth configs for those toolkits.

Current local runtime state:

- YouTube managed auth config: created and stored in the user env as `COMPOSIO_YOUTUBE_AUTH_CONFIG_ID`.
- Instagram managed auth config: created and stored in the user env as `COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID`.
- Executa verification: `connect_channel` returns `link_ready` with hosted authorization URLs for YouTube and Instagram using the current user env values.
- TikTok managed auth: not available from Composio for this project/toolkit. Create a custom TikTok OAuth auth config with your TikTok client credentials, then set `COMPOSIO_TIKTOK_AUTH_CONFIG_ID`.

Set these runtime variables after creating or selecting the auth configs in Composio:

```powershell
$env:COMPOSIO_YOUTUBE_AUTH_CONFIG_ID = "<youtube-auth-config-id>"
$env:COMPOSIO_INSTAGRAM_AUTH_CONFIG_ID = "<instagram-auth-config-id>"
$env:COMPOSIO_TIKTOK_AUTH_CONFIG_ID = "<tiktok-auth-config-id>"
```

The app also tries to discover enabled auth configs from Composio. If none exist, `Connect media` returns a setup-required state such as `needs_auth_config` and tells the user which env var is missing. Scheduling/publishing stays blocked with `Needs Connected Channel` until Composio reports an active connected account for the selected platform.

### User Media Uploads

The UI first tries Anna `files.upload_init` / `files.upload_finalize` for durable app storage, then falls back to `upload.inline` / `upload.negotiate`, and finally keeps the media as `Local Ready` metadata if the host does not grant file upload. In the current local Anna dev runtime, `files.*` reports `endpoint not yet available` and `upload.*` reports `upload_grant not enabled`; this is handled as an expected fallback and the uploaded media can still be selected and scheduled in the app workflow.

Video generation is configured inside the app:

- Paste the provider API key into `Video API key`.
- Optionally set a provider endpoint in `Video endpoint`.
- Click `Use video key`.
- Click `Video job` after a plan exists.

If no endpoint is set, CreatorOS AI prepares a sanitized video generation packet for review. If an endpoint is set, the Executa sends a JSON `POST` request with the video brief and a bearer token header.

## Publish With Anna CLI

From the app directory:

```powershell
anna-app whoami --json
anna-app validate --strict
anna-app apps push
anna-app apps publish
anna-app apps release 0.1.12
```

Current production draft identity:

- App slug: `creatoros-ai`
- App id: `75`
- Current local target version: `0.1.12`
- Latest server cut version: `0.1.11`
- Latest cut version id: `184`
- Bundled Executa handle: `creatoros-planner`
- Platform Tool ID: `tool-nikku696969-creatoros-planner-vhsarfsp`

Keep the app manifest on `bundled:creatoros-planner`. The Executa metadata and Python script entry use the real platform Tool ID, `tool-nikku696969-creatoros-planner-vhsarfsp`, so source mode, binary packaging, Agent shims, and Anna publishing all point at the same tool identity.

Fast draft push command:

```powershell
anna-app apps push
```

For a one-command publish flow after validation:

```powershell
anna-app apps publish --bump patch
```

The CLI must be logged in before push/cut/release can work. Check account state with:

```powershell
anna-app whoami --json
```

Useful preflight commands:

```powershell
anna-app apps list --json
anna-app apps push --dry-run --json
anna-app apps publish --dry-run --json
```

If these preflight commands fail with `403: Verified developer required`, the app is ready locally but cannot be uploaded by that account yet.

## Binary Executa Packaging

For real distribution, package the Python Executa as platform binaries so Anna Agent can install it without requiring users to have Python or `uv`.

The packaging files are:

- `executas/creatoros-planner-python/package_binary.sh`
- `.github/workflows/build-creatoros-planner-binary.yml`

Before running the workflow, commit all related changes:

```powershell
git status
git add examples/anna-app-creatoros-ai .github/workflows/build-creatoros-planner-binary.yml
git commit -m "Prepare CreatorOS Anna app release"
git push
```

Run the workflow from GitHub Actions:

```text
Actions -> Build CreatorOS planner binaries -> Run workflow
```

The workflow builds production Tool ID artifacts for `tool-nikku696969-creatoros-planner-vhsarfsp`. It builds:

- `darwin-arm64` on `macos-14`
- `darwin-x86_64` on `macos-15-intel`
- `linux-x86_64` on `ubuntu-latest`

Release assets are named:

```text
tool-nikku696969-creatoros-planner-vhsarfsp-darwin-arm64.tar.gz
tool-nikku696969-creatoros-planner-vhsarfsp-darwin-x86_64.tar.gz
tool-nikku696969-creatoros-planner-vhsarfsp-linux-x86_64.tar.gz
```

Current release tag:

```text
https://github.com/imthegoodboy/CreatorOss-anna/releases/tag/creatoros-planner-v0.1.2
```

Each archive contains:

```text
bin/tool-nikku696969-creatoros-planner-vhsarfsp
manifest.json
```

After the GitHub Release exists, configure the Tool in Anna:

1. Open Anna Developer Console.
2. Open `CreatorOS AI`.
3. Go to advanced Executa/tool settings for `CreatorOS Planner`.
4. Set distribution type to Binary.
5. Add the three platform URLs from the GitHub Release.
6. Reinstall/refresh the local Agent tool and confirm it shows `Binary` and `Running`.

Smoke-check an extracted binary with:

```bash
printf '%s\n' '{"jsonrpc":"2.0","method":"describe","id":1}' \
  | ./bin/tool-nikku696969-creatoros-planner-vhsarfsp
```

## Post-Deploy Checks

- Open the app in Anna.
- Generate a plan with a prompt such as `Grow my AI education channel with daily shorts @YouTube @TikTok`.
- Click `Check tools` and confirm Anna is connected.
- Confirm Composio reports ready after either `COMPOSIO_API_KEY` is configured in the runtime or a session Composio key is pasted in Integrations.
- Click `Connect media`. If the selected toolkit has no auth config, confirm the app shows the required `COMPOSIO_<PLATFORM>_AUTH_CONFIG_ID` setup message instead of claiming the channel is connected.
- Create a Composio auth config for each media toolkit you want to test, set the matching env var, restart the Anna dev harness/Agent runtime, and verify `Connect media` opens a Composio auth link.
- Enter a test video provider key and verify `Video job` returns either a prepared packet or a provider response.
- Approve at least one asset and click `Send review` to attach the review packet back to the Anna chat.

## Security Notes

- Rotate any API key that was pasted into chat, terminal logs, screenshots, or issue trackers.
- Keep `COMPOSIO_API_KEY` outside git.
- Do not store long-lived video provider keys in app source.
- Publishing/social posting should stay behind explicit user approval and connected account checks.

## Current Local Status

Last verified locally:

- `npm test` passes for app version `0.1.12`.
- `anna-app validate --strict` passes.
- `node --check bundle/app.js` passes.
- `python -m py_compile executas\creatoros-planner-python\creatoros_planner_plugin.py` passes.
- Anna dev harness responds on `http://localhost:5185/`.
- Rendered QA verified the chatbot-first UI, status-strip navigation, session Composio key controls, sanitized persisted state, chat `status` response, `@` platform selection, `Connect media`, upload registration, chat-driven scheduling, approved-task execution guards, scheduled-action-first Workflow layout, explicit Composio auth-config status, and mobile snapshot presence.
- `anna-app apps sync-meta --account https://anna.partners --json` returned the expected production listing copy. On Windows the CLI can still terminate with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` after doing the server-side work.
- `anna-app apps push --account https://anna.partners --json` succeeded at revision `10`.
- Production app id: `75`.
- Production slug: `creatoros-ai`.
- Version `0.1.0` was cut as version id `150`.
- Version `0.1.1` was cut as version id `157`.
- Version `0.1.2` was cut as version id `162`.
- Version `0.1.3` was cut as version id `163`.
- Version `0.1.4` was cut as version id `165`.
- Version `0.1.5` was cut as version id `167`.
- Version `0.1.6` was cut as version id `168`.
- Version `0.1.7` was cut as version id `172`.
- Version `0.1.8` was cut as version id `176`.
- Version `0.1.9` was cut as version id `181` before binary distribution was enabled.
- Version `0.1.10` was cut as version id `182` before binary distribution metadata was finalized.
- Version `0.1.11` was cut as version id `184` with binary distribution active.
- Local app version `0.1.12` and Executa version `0.1.2` contain the chatbot/UI and session Composio-key fixes. Push/cut this version after review direction is clear.
- Current Executa: `tool-nikku696969-creatoros-planner-vhsarfsp`, local version `0.1.2`, last published binary version `0.1.1`.
- Current server status: `pending_review`.
- `anna-app apps submit-review creatoros-ai --account https://anna.partners --json` is blocked because the app is already `pending_review`.
- `anna-app apps release 0.1.11 --account https://anna.partners --json` is blocked until Anna approves the app: `app status is pending_review; release not permitted — app must be APPROVED or PUBLISHED to release`.
