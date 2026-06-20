import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const appMeta = JSON.parse(await readFile(resolve(root, "app.json"), "utf8"));
const packageMeta = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const executaMeta = JSON.parse(await readFile(resolve(root, "executas/creatoros-planner-python/executa.json"), "utf8"));
const pyproject = await readFile(resolve(root, "executas/creatoros-planner-python/pyproject.toml"), "utf8");

if (manifest.schema !== 2) throw new Error("manifest schema must be 2");
if (manifest.ui?.bundle?.entry !== "index.html") throw new Error("bundle entry missing");
if (!manifest.required_executas?.[0]?.tool_id?.startsWith("bundled:")) {
  throw new Error("required Executa must use a bundled handle");
}
if (appMeta.version !== packageMeta.version) {
  throw new Error(`app.json version ${appMeta.version} must match package.json version ${packageMeta.version}`);
}
if (manifest.required_executas[0].min_version !== executaMeta.version) {
  throw new Error("manifest required Executa min_version must match executa.json version");
}
if (!manifest.ui?.host_api?.files?.includes("upload_init") || !manifest.ui?.host_api?.files?.includes("upload_finalize")) {
  throw new Error("manifest must grant Anna Files upload methods for user media");
}
if (!manifest.permissions?.includes("llm.complete") || !manifest.ui?.host_api?.llm?.includes("complete")) {
  throw new Error("manifest must grant direct Anna llm.complete for visible operator notes");
}
if (!pyproject.includes(`version = "${executaMeta.version}"`)) {
  throw new Error("pyproject.toml version must match executa.json version");
}
for (const platform of ["darwin-arm64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) {
  const asset = executaMeta.distribution?.profiles?.binary?.binary_urls?.[platform];
  if (!asset?.url?.includes(`creatoros-planner-v${executaMeta.version}`) || !asset.sha256 || !asset.size) {
    throw new Error(`binary distribution metadata missing or stale for ${platform}`);
  }
}
if (JSON.stringify(appMeta).includes("example.com")) {
  throw new Error("app listing metadata must not contain placeholder example.com URLs");
}
if (!appMeta.description?.includes("Connect") && !appMeta.description?.includes("connect")) {
  throw new Error("app listing metadata must describe the media connection workflow");
}

const html = await readFile(resolve(root, "bundle/index.html"), "utf8");
const css = await readFile(resolve(root, "bundle/style.css"), "utf8");
const appJs = await readFile(resolve(root, "bundle/app.js"), "utf8");
await readFile(resolve(root, "bundle/tokens.css"), "utf8");

for (const needle of [
  'id="prompt-input"',
  'id="mention-menu"',
  'id="platform-strip"',
  'id="ops-strip"',
  'id="message-list"',
  'id="nav-chat"',
  'id="view-workflow"',
  'id="view-uploads"',
  'id="upload-btn"',
  'id="file-input"',
  'id="media-url-input"',
  'id="save-media-url-btn"',
  'id="scheduled-tasks"',
  'id="agent-status"',
  'id="connect-media-btn"',
  'id="connect-platform-select"',
  'id="composio-key-input"',
  'id="save-composio-key-btn"',
  'id="connection-list"',
  'id="video-key-input"',
  'id="integration-check-btn"',
  'id="video-brief-btn"',
  "Review queue",
]) {
  if (!html.includes(needle)) throw new Error(`chat UI contract missing ${needle}`);
}
for (const needle of [
  "extractMentionPlatforms",
  "insertMention",
  "anna.tools.invoke",
  "anna.agent.session",
  "llm?.complete",
  "files?.upload_init",
  "uploadToAnnaFiles",
  "user_artifact",
  "anna.storage.set",
  "anna.chat.append_artifact",
  "integrations_status",
  "connect_channel",
  "composio_api_key",
  "list_media_connections",
  "upload_asset",
  "schedule_action",
  "execute_task",
  "agent_status",
  "video_job",
  "sessionSecrets",
  "mediaUrlFileName",
  "Public media URL added.",
  "Paste a public HTTPS media URL",
]) {
  if (!appJs.includes(needle)) throw new Error(`chat app behavior missing ${needle}`);
}
if (appJs.includes("els.mediaUrl.disabled = !selected") || appJs.includes("Select an upload before adding a media URL")) {
  throw new Error("public media URL fallback must work without a selected local upload");
}
if (!css.includes("macrostructure: Workbench")) {
  throw new Error("Hallmark Workbench chatbot stamp missing");
}

const pluginDir = resolve(root, "executas/creatoros-planner-python");
const smokeUserId = `smoke-user-${Date.now()}`;
const child = spawn("uv", ["run", "--project", pluginDir, "python", "creatoros_planner_plugin.py"], {
  cwd: pluginDir,
  stdio: ["pipe", "pipe", "pipe"],
});

const responses = [];
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2.0" } });
send({ jsonrpc: "2.0", id: 1, method: "describe" });
send({
  jsonrpc: "2.0",
  id: 2,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "plan",
      goal: "Grow my AI education channel",
      audience: "busy founders",
      cadence: "daily",
      voice: "practical",
      platforms: ["YouTube", "Instagram", "TikTok"],
      days: 7,
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 3,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "integrations_status",
      video_api_key_set: true,
      video_api_endpoint: "https://example.com/video",
      probe_composio: false,
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 4,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "video_job",
      video_api_key: "test-key",
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 5,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "upload_asset",
      file_name: "launch-video.mp4",
      file_size: 1048576,
      mime_type: "video/mp4",
      platforms: ["YouTube"],
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 6,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "schedule_action",
      prompt: "upload this video on YouTube tomorrow",
      platforms: ["YouTube"],
      upload: {
        id: "upload-test",
        file_name: "launch-video.mp4",
        file_size: 1048576,
        mime_type: "video/mp4",
        status: "local_ready",
      },
      publish_at: "2026-06-20T09:00:00.000Z",
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 7,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "agent_status",
      uploads: [{ id: "upload-test" }],
      tasks: [{ id: "task-test", status: "ready_for_review" }],
      connections: [{ status: "ACTIVE", is_active: true, toolkit: "youtube" }],
      inactive_connections: [{ status: "EXPIRED", toolkit: "youtube" }],
      approved_ids: ["day-1-ai-workflow-basics"],
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 8,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "connect_channel",
      platform: "YouTube",
      user_id: smokeUserId,
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 9,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "list_media_connections",
      user_id: smokeUserId,
      platforms: ["YouTube", "Instagram", "TikTok"],
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 10,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "execute_task",
      approved: false,
      live_execute: true,
      user_id: "smoke-user",
      task: {
        id: "task-execute-test",
        status: "ready_for_review",
        platforms: ["YouTube"],
        publish_at: "needs_time",
        prompt: "publish this uploaded video",
        upload: {
          file_name: "launch-video.mp4",
          url: "https://example.com/launch-video.mp4",
          mime_type: "video/mp4",
        },
        platform_payloads: {
          YouTube: {
            title: "Launch video",
            caption: "A review-only launch caption.",
            hashtags: ["#creatoros"],
          },
        },
      },
    },
  },
});
send({
  jsonrpc: "2.0",
  id: 11,
  method: "invoke",
  params: {
    tool: "creatoros_plan",
    arguments: {
      action: "video_job",
      video_api_key: "test-key",
      video_api_endpoint: "http://localhost:9999/generate",
    },
  },
});

await new Promise((resolveDone, rejectDone) => {
  const timeout = setTimeout(() => rejectDone(new Error("plugin smoke timed out")), 45000);
  const poll = setInterval(() => {
    if (responses.length >= 12) {
      clearTimeout(timeout);
      clearInterval(poll);
      resolveDone();
    }
  }, 50);
});

child.stdin.end();
child.kill();

const describe = responses.find((response) => response.id === 1)?.result;
const initialize = responses.find((response) => response.id === 0)?.result;
const invoke = responses.find((response) => response.id === 2)?.result;
const integrations = responses.find((response) => response.id === 3)?.result;
const video = responses.find((response) => response.id === 4)?.result;
const upload = responses.find((response) => response.id === 5)?.result;
const schedule = responses.find((response) => response.id === 6)?.result;
const status = responses.find((response) => response.id === 7)?.result;
const connect = responses.find((response) => response.id === 8)?.result;
const connections = responses.find((response) => response.id === 9)?.result;
const execute = responses.find((response) => response.id === 10)?.result;
const blockedVideo = responses.find((response) => response.id === 11)?.result;

if (describe?.tools?.[0]?.name !== "creatoros_plan") {
  throw new Error("describe did not expose creatoros_plan");
}
if (initialize?.protocolVersion !== "2.0" || initialize?.serverInfo?.version !== executaMeta.version) {
  throw new Error("initialize did not negotiate Executa protocol 2.0");
}
if (describe?.version !== executaMeta.version) {
  throw new Error("describe version must match executa.json version");
}
if (!invoke?.success || invoke?.data?.calendar?.length !== 7) {
  throw new Error("plan invoke did not return a 7-day calendar");
}
if (!integrations?.success || integrations?.data?.video?.status !== "ready") {
  throw new Error("integration status did not report configured video provider");
}
if (!video?.success || video?.data?.status !== "ready_for_provider") {
  throw new Error("video job did not return a provider-ready packet");
}
if (!upload?.success || upload?.data?.status !== "local_ready") {
  throw new Error("upload asset did not return a local-ready asset");
}
if (!schedule?.success || !["ready_for_review", "needs_connected_channel", "needs_composio_api_key"].includes(schedule?.data?.status)) {
  throw new Error("schedule action did not return a valid task status");
}
if (!status?.success || status?.data?.uploads !== 1 || status?.data?.tasks_waiting !== 1) {
  throw new Error("agent status did not summarize uploads and tasks");
}
if (status?.data?.connected_channels !== 1 || status?.data?.channels_need_reconnect !== 1) {
  throw new Error("agent status must separate active channels from reconnect-required accounts");
}
if (!connect?.success || !["link_ready", "needs_auth_config", "needs_composio_api_key", "link_error"].includes(connect?.data?.status)) {
  throw new Error("connect channel did not return a valid connection state");
}
if (process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_YOUTUBE_AUTH_CONFIG_ID) {
  if (connect?.data?.status !== "link_ready" || !connect?.data?.redirect_url) {
    throw new Error("connect channel should return a YouTube auth link when Composio auth config env is set");
  }
}
if (!connections?.success || !Array.isArray(connections?.data?.accounts)) {
  throw new Error("list media connections did not return an account list");
}
if (!execute?.success || execute?.data?.status !== "needs_user_approval") {
  throw new Error("execute task must block without explicit user approval");
}
if (!blockedVideo?.success || blockedVideo?.data?.status !== "provider_endpoint_blocked") {
  throw new Error("video job must block non-public or non-HTTPS provider endpoints");
}

console.log("CreatorOS AI smoke test passed.");
