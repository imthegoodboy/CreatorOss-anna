const EXECUTA_HANDLE = "creatoros-planner";
const DEV_FALLBACK_TOOL_ID = "tool-nikku696969-creatoros-planner-vhsarfsp";
const TOOL_ID =
  (typeof window !== "undefined" &&
    window.__ANNA_TOOL_IDS__ &&
    window.__ANNA_TOOL_IDS__[EXECUTA_HANDLE]) ||
  DEV_FALLBACK_TOOL_ID;
const TOOL_METHOD = "creatoros_plan";
const STORAGE_KEY = "creatoros-ai:chat-state";
const LEGACY_STORAGE_KEY = "creatoros-ai:campaign-state";
const PLATFORMS = ["YouTube", "Instagram", "TikTok"];
const TASK_WAITING_STATUSES = new Set([
  "ready_for_review",
  "needs_composio_api_key",
  "needs_connected_channel",
  "needs_public_media_url",
  "needs_user_approval",
  "ready_for_composio_execute",
  "scheduled_waiting",
]);

const $ = (selector) => document.querySelector(selector);

const els = {
  sidebar: $(".sidebar"),
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]")),
  navItems: Array.from(document.querySelectorAll("[data-view]")),
  form: $("#chat-form"),
  prompt: $("#prompt-input"),
  help: $("#prompt-help"),
  send: $("#send-btn"),
  uploadButton: $("#upload-btn"),
  uploadPageButton: $("#upload-page-button"),
  fileInput: $("#file-input"),
  uploadDropzone: $("#upload-dropzone"),
  selectedUpload: $("#selected-upload"),
  mention: $("#mention-menu"),
  platformStrip: $("#platform-strip"),
  messages: $("#message-list"),
  reset: $("#reset-demo"),
  reviewSummary: $("#review-summary"),
  reviewList: $("#review-list"),
  planFacts: $("#plan-facts"),
  workflowCalendar: $("#workflow-calendar"),
  scheduledTasks: $("#scheduled-tasks"),
  uploadsList: $("#uploads-list"),
  agentStatus: $("#agent-status"),
  integrationStatus: $("#integration-status"),
  integrationReport: $("#integration-report"),
  connectPlatform: $("#connect-platform-select"),
  connectMedia: $("#connect-media-btn"),
  connectStatus: $("#connect-status"),
  connectLink: $("#connect-link"),
  connectionList: $("#connection-list"),
  videoKey: $("#video-key-input"),
  videoEndpoint: $("#video-endpoint-input"),
  saveConfig: $("#save-config-btn"),
  checkIntegrations: $("#integration-check-btn"),
  statusRefresh: $("#status-refresh-btn"),
  thumbnail: $("#thumbnail-btn"),
  videoBrief: $("#video-brief-btn"),
  sendReview: $("#send-review-btn"),
  handoffStatus: $("#handoff-status"),
  connectionLabel: $("#connection-label"),
  connectionDot: $("#connection-dot"),
  toastRegion: $("#toast-region"),
};

let anna = null;
let appState = createDefaultState();
let sessionSecrets = { videoApiKey: "" };
let pendingViewReset = false;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUi();
  render();
  anna = await connectAnna();
  setConnected(Boolean(anna));
  if (anna) {
    await loadStoredState();
    await setWindowTitle();
    refreshIntegrationStatus({ quiet: true, probe: true }).catch(() => {});
    refreshMediaConnections({ quiet: true }).catch(() => {});
    refreshAgentStatus({ quiet: true }).catch(() => {});
  }
  render();
}

async function connectAnna() {
  try {
    const mod = await import("/static/anna-apps/_sdk/latest/index.js");
    return await mod.AnnaAppRuntime.connect();
  } catch (err) {
    console.warn("[creatoros-ai] running without Anna host:", err?.message || err);
    return null;
  }
}

function bindUi() {
  els.sidebar.addEventListener("click", onNavClick);
  els.form.addEventListener("submit", onSendMessage);
  els.prompt.addEventListener("input", onPromptInput);
  els.prompt.addEventListener("keydown", onPromptKeydown);
  els.reset.addEventListener("click", onResetWorkspace);
  els.saveConfig.addEventListener("click", onSaveVideoConfig);
  els.checkIntegrations.addEventListener("click", () => refreshIntegrationStatus({ probe: true }));
  els.connectMedia.addEventListener("click", onConnectMedia);
  els.statusRefresh.addEventListener("click", () => refreshAgentStatus());
  els.thumbnail.addEventListener("click", onThumbnailBrief);
  els.videoBrief.addEventListener("click", onVideoJob);
  els.sendReview.addEventListener("click", onSendReview);
  els.platformStrip.addEventListener("click", onPlatformClick);
  els.mention.addEventListener("click", onMentionClick);
  els.uploadButton.addEventListener("click", openFilePicker);
  els.uploadPageButton.addEventListener("click", openFilePicker);
  els.uploadDropzone.addEventListener("click", openFilePicker);
  els.uploadDropzone.addEventListener("dragover", onDragOver);
  els.uploadDropzone.addEventListener("dragleave", onDragLeave);
  els.uploadDropzone.addEventListener("drop", onDropUpload);
  els.fileInput.addEventListener("change", () => onFilesSelected(els.fileInput.files));
  document.addEventListener("click", (event) => {
    if (!els.form.contains(event.target)) hideMentionMenu();
  });
}

function onNavClick(event) {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  setActiveView(button.dataset.view);
  render();
}

async function onSendMessage(event) {
  event.preventDefault();
  const raw = els.prompt.value.trim();
  if (!validatePrompt(raw)) return;

  const mentioned = extractMentionPlatforms(raw);
  const platforms = mentioned.length ? mentioned : appState.selectedPlatforms;
  if (!platforms.length) {
    showToast("Select at least one platform with @ or the platform chips.");
    return;
  }

  const goal = stripPlatformMentions(raw);
  const intent = classifyIntent(raw);
  if (intent === "plan") {
    appState.brand = {
      ...appState.brand,
      goal,
      cadence: inferCadence(raw, appState.brand.cadence),
      platforms,
    };
    appState.selectedPlatforms = platforms;
  } else if (mentioned.length) {
    appState.brand = {
      ...appState.brand,
      platforms,
    };
    appState.selectedPlatforms = platforms;
  }

  const userMessage = {
    id: newId("user"),
    role: "user",
    kind: "text",
    text: raw,
    platforms,
    createdAt: new Date().toISOString(),
  };
  const loadingMessage = {
    id: "loading",
    role: "assistant",
    kind: "loading",
    text: intent === "plan" ? "Planning" : "Working",
    createdAt: new Date().toISOString(),
  };

  appState.messages.push(userMessage, loadingMessage);
  els.prompt.value = "";
  autoSizePrompt();
  hideMentionMenu();
  setButtonLoading(els.send, true, "Working");
  render();

  try {
    if (intent === "status") {
      await handleStatusMessage();
    } else if (intent === "schedule") {
      await handleScheduleMessage(raw, platforms);
    } else {
      await handlePlanMessage(goal, platforms);
    }
    await saveState();
    await setWindowTitle();
  } catch (err) {
    replaceLoadingWith({
      id: newId("error"),
      role: "assistant",
      kind: "error",
      text: `${intentLabel(intent)} failed. ${err?.message || "Try again with a shorter request."}`,
      createdAt: new Date().toISOString(),
    });
  } finally {
    setButtonLoading(els.send, false);
    render();
  }
}

async function handlePlanMessage(goal, platforms) {
  appState.thumbnailBrief = null;
  const plan = await planner("plan", {
    goal,
    audience: appState.brand.audience,
    cadence: appState.brand.cadence,
    voice: appState.brand.voice,
    platforms,
    days: 7,
  });
  const agentNote = await annaAgentNote("plan", {
    goal,
    platforms,
    campaign: plan.strategy?.campaign_name,
    first_items: plan.calendar?.slice(0, 3).map((item) => item.title) || [],
  });
  if (agentNote) plan.agent_note = agentNote;
  appState.plan = plan;
  appState.approvedIds = [];
  replaceLoadingWith({
    id: newId("plan"),
    role: "assistant",
    kind: "plan",
    text: "Here is the reviewable sprint.",
    plan,
    createdAt: new Date().toISOString(),
  });
  await updateAgentStatusQuietly();
}

async function handleScheduleMessage(raw, platforms) {
  const upload = selectedUpload() || latestUpload();
  if (!upload && /\b(upload|video|media|post|publish)\b/i.test(raw)) {
    replaceLoadingWith({
      id: newId("needs-upload"),
      role: "assistant",
      kind: "text",
      text: "Upload a video or image with the + button, then tell me where and when to schedule it.",
      createdAt: new Date().toISOString(),
    });
    setActiveView("uploads");
    return;
  }

  const task = await planner("schedule_action", {
    plan: appState.plan,
    upload,
    platforms,
    prompt: raw,
    publish_at: inferPublishAt(raw),
    action_type: /schedule/i.test(raw) ? "schedule" : "publish",
    require_review: true,
  });
  const agentNote = await annaAgentNote("schedule", {
    request: raw,
    platforms,
    task_status: task.status,
    missing_toolkits: task.composio?.missing_toolkits || [],
  });
  if (agentNote) task.agent_note = agentNote;
  appState.tasks = [task, ...appState.tasks.filter((item) => item.id !== task.id)];
  setActiveView("workflow");
  replaceLoadingWith({
    id: newId("task"),
    role: "assistant",
    kind: "task",
    text: "I prepared the action for review.",
    task,
    createdAt: new Date().toISOString(),
  });
  await updateAgentStatusQuietly();
}

async function handleStatusMessage() {
  appState.agentStatus = await planner("agent_status", {
    plan: appState.plan,
    uploads: appState.uploads,
    tasks: appState.tasks,
    connections: appState.connections.channels,
    approved_ids: appState.approvedIds,
  });
  const agentNote = await annaAgentNote("status", {
    campaign: appState.agentStatus.campaign,
    tasks_waiting: appState.agentStatus.tasks_waiting,
    channels: appState.agentStatus.connected_channels,
    composio_configured: appState.agentStatus.composio_configured,
  });
  if (agentNote) appState.agentStatus.agent_note = agentNote;
  replaceLoadingWith({
    id: newId("status"),
    role: "assistant",
    kind: "status",
    text: "Here is the current agent status.",
    status: appState.agentStatus,
    createdAt: new Date().toISOString(),
  });
}

async function annaAgentNote(kind, payload) {
  if (!anna?.agent?.session) return null;
  const prompt = [
    "You are the Anna host agent helping CreatorOS AI.",
    "Return one concise operator note, maximum 22 words.",
    "Do not claim publishing, upload, channel connection, or video generation happened.",
    `Context kind: ${kind}`,
    `Payload: ${JSON.stringify(payload)}`,
  ].join("\n");
  return withTimeout(readAnnaAgentText(prompt), 12000).catch((err) => {
    console.warn("[creatoros-ai] anna agent note unavailable:", err?.message || err);
    return null;
  });
}

async function readAnnaAgentText(prompt) {
  let session = null;
  try {
    session = await anna.agent.session({
      submode: "auto",
      system_prompt: "You are a concise creator operations copilot inside CreatorOS AI.",
    });
    let text = "";
    const stream = session.run({ content: prompt });
    for await (const frame of stream) {
      if (frame.event === "token" && frame.text) {
        text += frame.text;
      } else if (frame.event === "sse") {
        const content = frame.choices?.[0]?.delta?.content || frame.data || "";
        if (content !== "[DONE]") text += content;
      } else if (frame.text && typeof frame.text === "string") {
        text += frame.text;
      }
      if (text.length > 220) break;
    }
    return cleanAgentText(text);
  } finally {
    if (session?.delete) {
      try {
        await session.delete();
      } catch {
        // Session cleanup is best-effort; the host also expires idle sessions.
      }
    }
  }
}

function cleanAgentText(text) {
  const cleaned = String(text || "")
    .replace(/\[DONE\]/gi, "")
    .replace(/^data:\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 220) : null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}

async function updateAgentStatusQuietly() {
  try {
    appState.agentStatus = await planner("agent_status", {
      plan: appState.plan,
      uploads: appState.uploads,
      tasks: appState.tasks,
      connections: appState.connections.channels,
      approved_ids: appState.approvedIds,
    });
  } catch (err) {
    console.warn("[creatoros-ai] agent_status unavailable:", err?.message || err);
    appState.agentStatus = computedStatus();
  }
}

function replaceLoadingWith(message) {
  appState.messages = appState.messages.filter((entry) => entry.id !== "loading");
  appState.messages.push(message);
}

function onPromptInput() {
  autoSizePrompt();
  updateMentionMenu();
  validatePrompt(els.prompt.value.trim(), { quiet: true });
}

function onPromptKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.form.requestSubmit();
    return;
  }
  if (event.key === "Escape") {
    hideMentionMenu();
  }
}

function onPlatformClick(event) {
  const button = event.target.closest("[data-platform]");
  if (!button) return;
  togglePlatform(button.dataset.platform);
}

function onMentionClick(event) {
  const button = event.target.closest("[data-mention-platform]");
  if (!button) return;
  insertMention(button.dataset.mentionPlatform);
}

async function onResetWorkspace() {
  appState = createDefaultState();
  sessionSecrets = { videoApiKey: "" };
  els.prompt.value = "";
  els.videoKey.value = "";
  els.videoEndpoint.value = "";
  els.fileInput.value = "";
  autoSizePrompt();
  hideMentionMenu();
  if (anna?.storage?.delete) {
    try {
      await anna.storage.delete({ key: STORAGE_KEY });
      await anna.storage.delete({ key: LEGACY_STORAGE_KEY });
    } catch {
      await saveState();
    }
  }
  render();
  await refreshIntegrationStatus({ quiet: true, probe: true });
  await refreshMediaConnections({ quiet: true });
  await updateAgentStatusQuietly();
  await saveState();
  render();
}

async function onSaveVideoConfig() {
  const key = els.videoKey.value.trim();
  const endpoint = els.videoEndpoint.value.trim();
  if (key) {
    sessionSecrets.videoApiKey = key;
    appState.integrations.videoKeySet = true;
    els.videoKey.value = "";
  }
  appState.integrations.videoEndpoint = endpoint;
  appState.integrations.videoKeySet = Boolean(sessionSecrets.videoApiKey);
  await saveState();
  showToast(appState.integrations.videoKeySet ? "Video key is active for this session." : "Video endpoint saved.");
  render();
}

async function refreshIntegrationStatus(options = {}) {
  setButtonLoading(els.checkIntegrations, true, "Checking");
  try {
    const status = await planner("integrations_status", {
      video_api_key_set: Boolean(sessionSecrets.videoApiKey),
      video_api_endpoint: appState.integrations.videoEndpoint,
      probe_composio: Boolean(options.probe),
    });
    appState.integrations.lastStatus = status;
    appState.integrations.composioConfigured = Boolean(status?.composio?.configured);
    appState.integrations.videoKeySet = Boolean(sessionSecrets.videoApiKey);
    appState.integrations.lastCheckedAt = new Date().toISOString();
    await saveState();
    if (!options.quiet) showToast("Integration status updated.");
  } catch (err) {
    if (!options.quiet) showToast(`Integration check failed: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.checkIntegrations, false);
    render();
  }
}

async function onConnectMedia() {
  const platform = els.connectPlatform.value || appState.selectedPlatforms[0] || "YouTube";
  setButtonLoading(els.connectMedia, true, "Connecting");
  try {
    const result = await planner("connect_channel", {
      platform,
      user_id: appState.userId,
      callback_url: "",
    });
    appState.connections.lastConnect = result;
    applyConnectionIntegrationHint(result);
    if (result.status === "link_ready") {
      appState.connections.pendingLinks = [result, ...appState.connections.pendingLinks.filter((item) => item.connected_account_id !== result.connected_account_id)];
      appState.messages.push({
        id: newId("connect"),
        role: "assistant",
        kind: "connection",
        text: `${result.platform} connection link is ready.`,
        connection: result,
        createdAt: new Date().toISOString(),
      });
      if (result.redirect_url) {
        window.open(result.redirect_url, "_blank", "noopener,noreferrer");
      }
      showToast(`Open the ${result.platform} auth link to finish connecting.`);
    } else {
      appState.messages.push({
        id: newId("connect"),
        role: "assistant",
        kind: "connection",
        text: connectionCopy(result),
        connection: result,
        createdAt: new Date().toISOString(),
      });
      showToast(connectionCopy(result));
    }
    await refreshMediaConnections({ quiet: true });
    await refreshIntegrationStatus({ quiet: true, probe: true });
    await saveState();
  } catch (err) {
    showToast(`Connect media failed: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.connectMedia, false);
    render();
  }
}

async function refreshMediaConnections(options = {}) {
  try {
    const status = await planner("list_media_connections", {
      user_id: appState.userId,
      platforms: PLATFORMS,
    });
    appState.connections.channels = Array.isArray(status.accounts) ? status.accounts : [];
    appState.connections.lastListStatus = status.status || "ready";
    if (status.status === "needs_composio_api_key") {
      appState.integrations.composioConfigured = false;
    } else {
      appState.integrations.composioConfigured = true;
    }
    if (!options.quiet) showToast("Media channel status updated.");
  } catch (err) {
    appState.connections.lastListStatus = "error";
    if (!options.quiet) showToast(`Could not refresh channels: ${err?.message || err}`);
  }
}

function applyConnectionIntegrationHint(result) {
  if (!result?.status) return;
  if (result.status === "needs_composio_api_key") {
    appState.integrations.composioConfigured = false;
    return;
  }
  appState.integrations.composioConfigured = true;
  const previous = appState.integrations.lastStatus || {};
  appState.integrations.lastStatus = {
    ...previous,
    composio: {
      ...(previous.composio || {}),
      configured: true,
      status: result.status === "link_error" ? "link_error" : "ready",
    },
  };
}

async function refreshAgentStatus(options = {}) {
  setButtonLoading(els.statusRefresh, true, "Refreshing");
  try {
    await updateAgentStatusQuietly();
    await saveState();
    if (!options.quiet) showToast("Agent status refreshed.");
  } catch (err) {
    if (!options.quiet) showToast(`Status failed: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.statusRefresh, false);
    render();
  }
}

function openFilePicker() {
  els.fileInput.click();
}

function onDragOver(event) {
  event.preventDefault();
  els.uploadDropzone.classList.add("is-dragging");
}

function onDragLeave() {
  els.uploadDropzone.classList.remove("is-dragging");
}

async function onDropUpload(event) {
  event.preventDefault();
  els.uploadDropzone.classList.remove("is-dragging");
  await onFilesSelected(event.dataTransfer?.files);
}

async function onFilesSelected(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files.slice(0, 3)) {
    await registerUpload(file);
  }
  els.fileInput.value = "";
}

async function registerUpload(file) {
  const localId = newId("upload");
  const localUpload = {
    id: localId,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || "application/octet-stream",
    platforms: [...appState.selectedPlatforms],
    status: "uploading",
    created_at: Date.now(),
    previewUrl: URL.createObjectURL(file),
  };
  appState.uploads = [localUpload, ...appState.uploads];
  appState.selectedUploadId = localId;
  setActiveView("chat");
  render();

  try {
    const host = await uploadToAnnaHost(file);
    const saved = await planner("upload_asset", {
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      file_ref: host.file_ref || "",
      url: host.url || "",
      platforms: appState.selectedPlatforms,
      prompt: appState.brand.goal,
    });
    const merged = {
      ...saved,
      previewUrl: localUpload.previewUrl,
      status: saved.status || host.status || "local_ready",
    };
    appState.uploads = [merged, ...appState.uploads.filter((entry) => entry.id !== localId && entry.id !== saved.id)];
    appState.selectedUploadId = merged.id;
    appState.messages.push({
      id: newId("upload"),
      role: "assistant",
      kind: "upload",
      text: "Media is ready for chat-driven scheduling.",
      upload: stripEphemeralUpload(merged),
      createdAt: new Date().toISOString(),
    });
    await updateAgentStatusQuietly();
    await saveState();
    showToast("Upload added. Tell the chat where to post it.");
  } catch (err) {
    appState.uploads = appState.uploads.map((entry) =>
      entry.id === localId ? { ...entry, status: "upload_error", error: String(err?.message || err) } : entry,
    );
    showToast(`Upload failed: ${err?.message || err}`);
  } finally {
    render();
  }
}

async function uploadToAnnaHost(file) {
  const filesUpload = await uploadToAnnaFiles(file);
  if (filesUpload) return filesUpload;
  if (!anna?.upload) return { status: "local_ready" };
  const purpose = "user_artifact";
  try {
    if (file.size <= 4_500_000 && typeof anna.upload.inline === "function") {
      const bytes_b64 = await fileToBase64(file);
      const uploaded = unwrap(
        await anna.upload.inline({
          content_b64: bytes_b64,
          mime_type: file.type || "application/octet-stream",
          purpose,
          filename: file.name,
        }),
      );
      return {
        ...uploaded,
        file_ref: uploaded?.r2_key || uploaded?.file_ref || null,
        url: uploaded?.download_url || uploaded?.url || null,
        status: "host_uploaded",
      };
    }
    if (typeof anna.upload.negotiate === "function" && typeof anna.upload.confirm === "function") {
      const negotiated = unwrap(
        await anna.upload.negotiate({
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          purpose,
        }),
      );
      const putUrl = negotiated?.put_url || negotiated?.upload_url;
      const r2Key = negotiated?.r2_key || negotiated?.file_ref;
      if (!putUrl || !r2Key) return { status: "local_ready" };
      const headers = negotiated.headers && typeof negotiated.headers === "object"
        ? negotiated.headers
        : { "Content-Type": file.type || "application/octet-stream" };
      const put = await fetch(putUrl, {
        method: "PUT",
        body: file,
        headers,
      });
      if (!put.ok) throw new Error(`host upload returned HTTP ${put.status}`);
      const confirmed = unwrap(await anna.upload.confirm({ r2_key: r2Key }));
      return {
        ...confirmed,
        file_ref: r2Key,
        url: confirmed?.download_url || confirmed?.url || null,
        status: "host_uploaded",
      };
    }
  } catch (err) {
    logUploadFallback("host upload", err);
  }
  return { status: "local_ready" };
}

async function uploadToAnnaFiles(file) {
  if (!anna?.files?.upload_init || !anna?.files?.upload_finalize) return null;
  const contentType = file.type || "application/octet-stream";
  const path = `uploads/${Date.now()}-${safePathSegment(file.name)}`;
  const metadata = {
    filename: file.name,
    source: "creatoros-ai",
    platforms: appState.selectedPlatforms,
  };
  try {
    const init = unwrap(
      await anna.files.upload_init({
        path,
        content_type: contentType,
        size: file.size,
        metadata,
        tags: ["creatoros", "source-media"],
      }),
    );
    const putUrl = init?.put_url || init?.upload_url;
    if (!putUrl) return null;
    const headers = init.headers && typeof init.headers === "object" ? init.headers : { "Content-Type": contentType };
    const put = await fetch(putUrl, {
      method: "PUT",
      body: file,
      headers,
    });
    if (!put.ok) throw new Error(`files upload returned HTTP ${put.status}`);
    const finalized = unwrap(
      await anna.files.upload_finalize({
        path,
        size_bytes: file.size,
        etag: put.headers.get("ETag") || put.headers.get("etag") || undefined,
        metadata,
      }),
    );
    let download = null;
    if (anna.files.download_url) {
      download = unwrap(await anna.files.download_url({ path, ttl_seconds: 1800 }));
    }
    return {
      ...finalized,
      file_ref: `anna-files:${path}`,
      path,
      url: download?.get_url || download?.download_url || null,
      status: "host_uploaded",
    };
  } catch (err) {
    logUploadFallback("anna files upload", err);
    return null;
  }
}

function logUploadFallback(label, err) {
  const message = String(err?.message || err || "");
  const expected = /APP_NOT_GRANTED|upload_grant|endpoint not yet available|not_granted/i.test(message);
  const log = expected ? console.info : console.warn;
  log(`[creatoros-ai] ${label} unavailable; using local-ready media fallback:`, message);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function safePathSegment(value) {
  return String(value || "media")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "media";
}

async function onThumbnailBrief() {
  if (!appState.plan) {
    showToast("Generate a plan before creating a thumbnail brief.");
    return;
  }
  setButtonLoading(els.thumbnail, true, "Creating");
  try {
    const item = appState.plan.calendar[0];
    const prompt = item.thumbnail_prompt;
    let image = null;
    if (anna?.image?.generate) {
      try {
        const reply = await anna.image.generate({
          prompt,
          n: 1,
          size: "1024x1024",
          model_hint: "creator-thumbnail",
        });
        image = reply?.images?.[0] || unwrap(reply)?.images?.[0] || null;
      } catch (err) {
        console.warn("[creatoros-ai] image.generate unavailable:", err?.message || err);
      }
    }
    appState.thumbnailBrief = { prompt, image };
    appState.messages.push({
      id: newId("thumbnail"),
      role: "assistant",
      kind: "text",
      text: image?.url ? "Anna returned a thumbnail image for review." : `Thumbnail brief: ${prompt}`,
      createdAt: new Date().toISOString(),
    });
    await saveState();
  } finally {
    setButtonLoading(els.thumbnail, false);
    render();
  }
}

async function onVideoJob() {
  if (!appState.plan) {
    showToast("Generate a plan before creating a video job.");
    return;
  }
  const item = approvedItems()[0] || appState.plan.calendar[0];
  setButtonLoading(els.videoBrief, true, "Preparing");
  try {
    const job = await planner("video_job", {
      plan: appState.plan,
      item_id: item.id,
      video_api_key: sessionSecrets.videoApiKey,
      video_api_endpoint: appState.integrations.videoEndpoint,
    });
    appState.videoJob = job;
    appState.messages.push({
      id: newId("video"),
      role: "assistant",
      kind: "text",
      text: videoJobCopy(job),
      createdAt: new Date().toISOString(),
    });
    await saveState();
  } catch (err) {
    showToast(`Video job failed: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.videoBrief, false);
    render();
  }
}

async function onSendReview() {
  if (!appState.plan && !appState.tasks.length) {
    showToast("Generate a plan or schedule an action before sending a review packet.");
    return;
  }
  const approved = approvedItems();
  const packet = {
    goal: appState.brand.goal,
    platforms: appState.brand.platforms,
    approved,
    uploads: appState.uploads.map(stripEphemeralUpload),
    tasks: appState.tasks,
    thumbnailBrief: appState.thumbnailBrief,
    videoJob: sanitizeVideoJob(appState.videoJob),
    generatedAt: new Date().toISOString(),
  };

  setButtonLoading(els.sendReview, true, "Sending");
  try {
    if (anna?.chat?.append_artifact) {
      await anna.chat.append_artifact({
        kind: "app_event",
        summary: `CreatorOS review packet: ${approved.length} approved asset${approved.length === 1 ? "" : "s"}, ${appState.tasks.length} task${appState.tasks.length === 1 ? "" : "s"}`,
        payload: packet,
      });
      appState.messages.push({
        id: newId("review"),
        role: "assistant",
        kind: "text",
        text: "Review packet attached to the Anna chat.",
        createdAt: new Date().toISOString(),
      });
    } else {
      appState.messages.push({
        id: newId("review"),
        role: "assistant",
        kind: "text",
        text: "Standalone review packet is ready in the queue.",
        createdAt: new Date().toISOString(),
      });
    }
    await saveState();
  } catch (err) {
    showToast(`Could not attach packet: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.sendReview, false);
    render();
  }
}

async function planner(action, args) {
  if (anna?.tools?.invoke) {
    const reply = await anna.tools.invoke({
      tool_id: TOOL_ID,
      method: TOOL_METHOD,
      args: { action, ...args },
      timeoutMs: 45000,
    });
    return unwrap(reply);
  }
  return localPlanner(action, args);
}

function unwrap(reply) {
  if (reply && typeof reply === "object") {
    if ("result" in reply) return unwrap(reply.result);
    if (reply.success === false) throw new Error(reply.error || "Tool invocation failed");
    if ("data" in reply) return reply.data;
  }
  return reply;
}

async function loadStoredState() {
  try {
    const current = await anna.storage.get({ key: STORAGE_KEY });
    const legacy = current?.value ? null : await anna.storage.get({ key: LEGACY_STORAGE_KEY });
    const value = current?.value || legacy?.value;
    if (!value) return;
    const stored = typeof value === "string" ? JSON.parse(value) : value;
    appState = normalizeState(stored);
  } catch (err) {
    console.warn("[creatoros-ai] storage.get failed:", err?.message || err);
  }
}

async function saveState() {
  if (!anna?.storage?.set) return;
  try {
    await anna.storage.set({ key: STORAGE_KEY, value: serializeState(appState) });
  } catch (err) {
    console.warn("[creatoros-ai] storage.set failed:", err?.message || err);
  }
}

async function setWindowTitle() {
  if (!anna?.window?.set_title) return;
  const title = appState.plan ? `CreatorOS - ${appState.plan.strategy.campaign_name}` : "CreatorOS AI";
  anna.window.set_title({ title }).catch(() => {});
}

function createDefaultState() {
  return {
    activeView: "chat",
    userId: "creatoros-local-user",
    brand: {
      goal: "Grow my AI education channel with daily short videos.",
      audience: "busy founders learning AI",
      cadence: "daily",
      voice: "practical, direct, optimistic",
      platforms: [...PLATFORMS],
    },
    selectedPlatforms: [...PLATFORMS],
    plan: null,
    approvedIds: [],
    uploads: [],
    selectedUploadId: null,
    tasks: [],
    connections: {
      channels: [],
      pendingLinks: [],
      lastConnect: null,
      lastListStatus: "not_checked",
    },
    agentStatus: null,
    thumbnailBrief: null,
    videoJob: null,
    integrations: {
      composioConfigured: false,
      videoKeySet: false,
      videoEndpoint: "",
      lastStatus: null,
      lastCheckedAt: null,
    },
    messages: [welcomeMessage()],
  };
}

function welcomeMessage() {
  return {
    id: "welcome",
    role: "assistant",
    kind: "intro",
    text: "Plan a creator sprint, upload media, or ask for agent status.",
    createdAt: new Date().toISOString(),
  };
}

function normalizeState(stored) {
  const next = createDefaultState();
  const brand = { ...next.brand, ...(stored?.brand || {}) };
  const selected = sanitizePlatforms(stored?.selectedPlatforms || brand.platforms || next.selectedPlatforms);
  const messages = Array.isArray(stored?.messages) && stored.messages.length ? stored.messages : [welcomeMessage()];
  const integrations = {
    ...next.integrations,
    ...(stored?.integrations || {}),
    videoKeySet: Boolean(sessionSecrets.videoApiKey),
  };
  if (stored?.plan && !messages.some((message) => message.kind === "plan")) {
    messages.push({
      id: newId("plan"),
      role: "assistant",
      kind: "plan",
      text: "Here is the saved sprint.",
      plan: stored.plan,
      createdAt: new Date().toISOString(),
    });
  }
  return {
    ...next,
    ...stored,
    activeView: ["chat", "workflow", "uploads", "integrations"].includes(stored?.activeView) ? stored.activeView : "chat",
    brand: { ...brand, platforms: selected },
    selectedPlatforms: selected,
    approvedIds: Array.isArray(stored?.approvedIds) ? stored.approvedIds : [],
    uploads: Array.isArray(stored?.uploads) ? stored.uploads : [],
    tasks: Array.isArray(stored?.tasks) ? stored.tasks : [],
    connections: {
      ...next.connections,
      ...(stored?.connections || {}),
      channels: Array.isArray(stored?.connections?.channels) ? stored.connections.channels : [],
      pendingLinks: Array.isArray(stored?.connections?.pendingLinks) ? stored.connections.pendingLinks : [],
    },
    integrations,
    messages,
  };
}

function serializeState(state) {
  return {
    ...state,
    uploads: state.uploads.map(stripEphemeralUpload),
    connections: {
      ...state.connections,
      pendingLinks: state.connections.pendingLinks.map(stripSensitiveConnection),
      lastConnect: stripSensitiveConnection(state.connections.lastConnect),
    },
    messages: state.messages.map((message) =>
      message.upload
        ? { ...message, upload: stripEphemeralUpload(message.upload) }
        : message.connection
          ? { ...message, connection: stripSensitiveConnection(message.connection) }
          : message,
    ),
  };
}

function render() {
  renderNavigation();
  renderPlatformStrip();
  renderSelectedUpload();
  renderMessages();
  renderReview();
  renderPlanFacts();
  renderWorkflow();
  renderUploads();
  renderTasks();
  renderConnections();
  renderAgentStatus();
  renderIntegrations();
  renderHandoff();
  resetActiveViewScroll();
}

function setActiveView(view) {
  if (!["chat", "workflow", "uploads", "integrations"].includes(view)) return;
  if (appState.activeView !== view) pendingViewReset = true;
  appState.activeView = view;
}

function resetActiveViewScroll() {
  if (!pendingViewReset) return;
  const view = appState.activeView;
  pendingViewReset = false;
  requestAnimationFrame(() => {
    document.scrollingElement?.scrollTo({ top: 0, left: 0 });
    const activePanel = document.querySelector(`[data-view-panel="${view}"]`);
    activePanel?.scrollTo?.({ top: 0, left: 0 });
    if (view !== "chat") {
      els.messages.scrollTop = 0;
    }
  });
}

function renderNavigation() {
  for (const button of els.navItems) {
    const active = button.dataset.view === appState.activeView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  }
  for (const panel of els.viewPanels) {
    const active = panel.dataset.viewPanel === appState.activeView;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
}

function renderMessages() {
  els.messages.replaceChildren();
  for (const message of appState.messages) {
    els.messages.append(renderMessage(message));
  }
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message message--${message.role}`;

  const avatar = document.createElement("div");
  avatar.className = `avatar ${message.role === "user" ? "avatar--user" : ""}`;
  avatar.textContent = message.role === "user" ? "You" : "AI";

  const body = document.createElement("div");
  body.className = "message__body";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (message.kind === "intro") renderIntro(bubble, message);
  else if (message.kind === "plan") renderPlanMessage(bubble, message.plan || appState.plan);
  else if (message.kind === "loading") renderLoading(bubble);
  else if (message.kind === "error") renderTextMessage(bubble, message.text, "error");
  else if (message.kind === "task") renderTaskCard(bubble, message.task);
  else if (message.kind === "upload") renderUploadCard(bubble, message.upload);
  else if (message.kind === "connection") renderConnectionCard(bubble, message.connection);
  else if (message.kind === "status") renderStatusCard(bubble, message.status);
  else renderTextMessage(bubble, message.text);

  body.append(bubble);
  if (message.platforms?.length) body.append(platformPills(message.platforms, "pill--selected"));

  article.append(avatar, body);
  return article;
}

function renderIntro(root, message) {
  const h1 = document.createElement("h1");
  h1.textContent = "Message CreatorOS.";
  const p = document.createElement("p");
  p.textContent = message.text;
  const actions = document.createElement("div");
  actions.className = "intro-actions";

  for (const example of ["AI sprint @TikTok", "Status", "Upload video @YouTube tomorrow"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.textContent = example;
    button.addEventListener("click", () => {
      els.prompt.value = example;
      const platforms = extractMentionPlatforms(example);
      if (platforms.length) appState.selectedPlatforms = platforms;
      autoSizePrompt();
      renderPlatformStrip();
      els.prompt.focus();
    });
    actions.append(button);
  }

  root.append(h1, p, actions);
}

function renderTextMessage(root, text, tone = "normal") {
  const p = document.createElement("p");
  p.textContent = text;
  if (tone === "error") p.className = "muted";
  root.append(p);
}

function renderLoading(root) {
  const row = document.createElement("div");
  row.className = "loading-dots";
  row.setAttribute("aria-label", "Working");
  row.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  root.append(row);
}

function renderPlanMessage(root, plan) {
  if (!plan) {
    renderTextMessage(root, "No plan is available yet.");
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "plan-response";

  const h2 = document.createElement("h2");
  h2.textContent = plan.strategy.campaign_name;

  const summary = document.createElement("div");
  summary.className = "plan-summary";
  summary.append(
    factList(
      [
        ["Goal", plan.strategy.goal],
        ["Platforms", plan.strategy.platforms.join(", ")],
        ["Assets", String(plan.calendar.length)],
        ["Next", "Review, upload, or schedule from chat"],
      ],
      "strategy-list",
    ),
  );

  const calendar = document.createElement("ol");
  calendar.className = "calendar-list";
  for (const item of plan.calendar.slice(0, 3)) {
    calendar.append(renderPlanPreviewItem(item));
  }
  if (plan.calendar.length > 3) {
    calendar.append(emptyListItem(`${plan.calendar.length - 3} more items are in Workflow.`));
  }

  wrapper.append(h2, summary);
  if (plan.agent_note) wrapper.append(agentNote(plan.agent_note));
  wrapper.append(calendar);
  root.append(wrapper);
}

function renderPlanPreviewItem(item) {
  const li = document.createElement("li");
  li.className = "calendar-item";
  const date = document.createElement("div");
  date.className = "calendar-date";
  date.textContent = item.day_label;
  const copy = document.createElement("div");
  copy.className = "calendar-copy";
  const head = document.createElement("div");
  head.className = "calendar-item__head";
  const h3 = document.createElement("h3");
  h3.textContent = item.title;
  head.append(h3, approveButton(item.id));
  const angle = document.createElement("p");
  angle.textContent = item.angle;
  copy.append(head, platformPills(item.platforms), angle);
  li.append(date, copy);
  return li;
}

function renderCalendarItem(item) {
  const li = document.createElement("li");
  li.className = "calendar-item";

  const date = document.createElement("div");
  date.className = "calendar-date";
  date.textContent = item.day_label;

  const copy = document.createElement("div");
  copy.className = "calendar-copy";

  const head = document.createElement("div");
  head.className = "calendar-item__head";
  const h3 = document.createElement("h3");
  h3.textContent = item.title;
  const actions = document.createElement("div");
  actions.className = "rail-action-row";
  actions.append(approveButton(item.id), scheduleButton(item));
  head.append(h3, actions);

  const angle = document.createElement("p");
  angle.textContent = item.angle;
  const caption = document.createElement("p");
  caption.textContent = item.caption;

  copy.append(head, angle, platformPills(item.platforms), caption);
  li.append(date, copy);
  return li;
}

function renderTaskCard(root, task) {
  if (!task) {
    renderTextMessage(root, "No task is available.");
    return;
  }
  const h2 = document.createElement("h2");
  h2.textContent = "Action prepared";
  const facts = factList(
    [
      ["Status", formatStatus(task.status)],
      ["Platforms", (task.platforms || []).join(", ")],
      ["When", task.publish_at || "Needs time"],
      ["Media", task.upload?.file_name || "Plan item"],
      ["Missing", task.composio?.missing_toolkits?.length ? task.composio.missing_toolkits.join(", ") : "None"],
      ["Review", task.review_required ? "Required" : "Not required"],
    ],
    "status-list",
  );
  const p = document.createElement("p");
  p.textContent = task.execution?.note || task.composio?.note || "Prepared for review.";
  root.append(h2, facts);
  if (task.agent_note) root.append(agentNote(task.agent_note));
  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(approveButton(task.id), executeTaskButton(task));
  root.append(p, actions);
}

function renderUploadCard(root, upload) {
  if (!upload) {
    renderTextMessage(root, "No upload is available.");
    return;
  }
  const h2 = document.createElement("h2");
  h2.textContent = upload.file_name;
  const facts = factList(
    [
      ["Status", formatStatus(upload.status)],
      ["Type", upload.mime_type || "Unknown"],
      ["Size", formatBytes(upload.file_size || 0)],
      ["Platforms", (upload.platforms || []).join(", ")],
    ],
    "status-list",
  );
  const p = document.createElement("p");
  p.textContent = "Use a message like: upload this video on YouTube tomorrow.";
  root.append(h2, facts, p);
}

function renderConnectionCard(root, connection) {
  if (!connection) {
    renderTextMessage(root, "No connection result is available.");
    return;
  }
  const h2 = document.createElement("h2");
  h2.textContent = `${connection.platform || "Media"} connection`;
  const facts = factList(
    [
      ["Status", formatStatus(connection.status)],
      ["Toolkit", connection.toolkit || "Not set"],
      ["Account", connection.connected_account_id || "Not created"],
      ["Setup", connection.env_name || connection.auth_config?.id || "Configured"],
    ],
    "status-list",
  );
  const p = document.createElement("p");
  p.textContent = connectionCopy(connection);
  root.append(h2, facts, p);
  if (connection.redirect_url) {
    const link = document.createElement("a");
    link.href = connection.redirect_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open authorization link";
    root.append(link);
  }
}

function renderStatusCard(root, status) {
  const h2 = document.createElement("h2");
  h2.textContent = "Agent status";
  root.append(h2, statusFacts(status || computedStatus()));
  if (status?.agent_note) root.append(agentNote(status.agent_note));
}

function agentNote(text) {
  const note = document.createElement("p");
  note.className = "agent-note";
  note.textContent = text;
  return note;
}

function renderPlatformStrip() {
  els.platformStrip.replaceChildren();
  for (const platform of PLATFORMS) {
    const selected = appState.selectedPlatforms.includes(platform);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `platform-chip ${selected ? "is-selected" : ""}`;
    button.dataset.platform = platform;
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = `@${platform}`;
    els.platformStrip.append(button);
  }
}

function renderSelectedUpload() {
  const upload = selectedUpload();
  if (!upload) {
    els.selectedUpload.hidden = true;
    els.selectedUpload.replaceChildren();
    return;
  }
  els.selectedUpload.hidden = false;
  const label = document.createElement("span");
  label.textContent = `Selected: ${upload.file_name}`;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    appState.selectedUploadId = null;
    renderSelectedUpload();
  });
  els.selectedUpload.replaceChildren(label, clear);
}

function renderReview() {
  const approved = approvedItems();
  const total = appState.plan?.calendar?.length || 0;
  els.reviewSummary.textContent = total
    ? `${approved.length} of ${total} assets approved.`
    : "Generate a plan to start review.";
  els.reviewList.replaceChildren();
  for (const item of approved) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const platforms = document.createElement("span");
    platforms.className = "muted";
    platforms.textContent = item.platforms.join(", ");
    li.append(title, platforms);
    els.reviewList.append(li);
  }
}

function renderPlanFacts() {
  const entries = appState.plan
    ? [
        ["Goal", appState.brand.goal],
        ["Platforms", appState.brand.platforms.join(", ")],
        ["Cadence", cadenceLabel(appState.brand.cadence)],
        ["Assets", String(appState.plan.calendar.length * appState.brand.platforms.length)],
        ["Uploads", String(appState.uploads.length)],
        ["Tasks", String(appState.tasks.length)],
      ]
    : [
        ["Goal", "Not planned"],
        ["Platforms", appState.selectedPlatforms.join(", ")],
        ["Cadence", cadenceLabel(appState.brand.cadence)],
        ["Uploads", String(appState.uploads.length)],
        ["Tasks", String(appState.tasks.length)],
      ];
  const facts = factList(entries, "plan-facts");
  els.planFacts.replaceChildren(...Array.from(facts.children));
}

function renderWorkflow() {
  els.workflowCalendar.replaceChildren();
  if (!appState.plan?.calendar?.length) {
    els.workflowCalendar.append(emptyListItem("No plan yet. Ask the chat for a sprint."));
    return;
  }
  for (const item of appState.plan.calendar) {
    els.workflowCalendar.append(renderCalendarItem(item));
  }
}

function renderTasks() {
  els.scheduledTasks.replaceChildren();
  if (!appState.tasks.length) {
    els.scheduledTasks.append(emptyListItem("No scheduled actions yet."));
    return;
  }
  for (const task of appState.tasks) {
    const li = document.createElement("li");
    li.className = "task-item";
    const copy = document.createElement("div");
    copy.className = "task-copy";
    const head = document.createElement("div");
    head.className = "task-item__head";
    const h3 = document.createElement("h3");
    h3.textContent = task.upload?.file_name || task.plan_item?.title || "Publishing action";
    head.append(h3, statusPill(task.status));
    const p = document.createElement("p");
    p.textContent = task.prompt || task.composio?.note || "Prepared for review.";
    const meta = factList(
      [
        ["When", task.publish_at && task.publish_at !== "needs_time" ? task.publish_at : "Needs time"],
        ["Media", task.upload?.file_name || task.plan_item?.title || "Plan item"],
        ["Missing", task.composio?.missing_toolkits?.length ? task.composio.missing_toolkits.join(", ") : "None"],
      ],
      "status-list task-meta",
    );
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(approveButton(task.id), executeTaskButton(task));
    copy.append(head, platformPills(task.platforms || []), p, meta, actions);
    li.append(copy);
    els.scheduledTasks.append(li);
  }
}

function renderUploads() {
  els.uploadsList.replaceChildren();
  if (!appState.uploads.length) {
    els.uploadsList.append(emptyListItem("No uploaded media yet."));
    return;
  }
  for (const upload of appState.uploads) {
    const li = document.createElement("li");
    li.className = "upload-item";
    const copy = document.createElement("div");
    copy.className = "upload-copy";
    const head = document.createElement("div");
    head.className = "upload-item__head";
    const h3 = document.createElement("h3");
    h3.textContent = upload.file_name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mini-button ${appState.selectedUploadId === upload.id ? "is-approved" : ""}`;
    button.textContent = appState.selectedUploadId === upload.id ? "Selected" : "Select";
    button.addEventListener("click", () => {
      appState.selectedUploadId = upload.id;
      setActiveView("chat");
      render();
      els.prompt.focus();
    });
    head.append(h3, button);
    const p = document.createElement("p");
    p.textContent = `${formatStatus(upload.status)} · ${formatBytes(upload.file_size || 0)} · ${upload.mime_type || "media"}`;
    copy.append(head, platformPills(upload.platforms || []), p);
    li.append(copy);
    els.uploadsList.append(li);
  }
}

function renderConnections() {
  const last = appState.connections.lastConnect;
  els.connectStatus.textContent = last ? connectionCopy(last) : connectionSummaryCopy();
  els.connectLink.hidden = true;
  els.connectLink.replaceChildren();
  if (last?.redirect_url) {
    els.connectLink.hidden = false;
    const link = document.createElement("a");
    link.href = last.redirect_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `Open ${last.platform} authorization`;
    els.connectLink.append(link);
  }

  els.connectionList.replaceChildren();
  const rows = [];
  for (const channel of appState.connections.channels) {
    rows.push({
      title: `${formatStatus(channel.toolkit || "media")} channel`,
      status: channel.status || "unknown",
      detail: channel.alias || channel.id || "Connected account",
    });
  }
  for (const link of appState.connections.pendingLinks) {
    rows.push({
      title: `${link.platform || "Media"} auth link`,
      status: link.status || "link_ready",
      detail: link.expires_at ? `Expires ${link.expires_at}` : "Finish authorization in browser",
    });
  }
  if (!rows.length) {
    els.connectionList.append(emptyListItem("No connected media channels yet."));
    return;
  }
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "connection-item";
    const head = document.createElement("div");
    head.className = "calendar-item__head";
    const h3 = document.createElement("h3");
    h3.textContent = row.title;
    head.append(h3, statusPill(row.status));
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = row.detail;
    li.append(head, p);
    els.connectionList.append(li);
  }
}

function renderAgentStatus() {
  const facts = statusFacts(appState.agentStatus || computedStatus());
  els.agentStatus.replaceChildren(...Array.from(facts.children));
}

function renderIntegrations() {
  const status = appState.integrations.lastStatus;
  const composio = status?.composio?.configured || appState.integrations.composioConfigured;
  const composioProbe = status?.composio?.probe?.status;
  const videoKey = Boolean(sessionSecrets.videoApiKey);
  const endpoint = appState.integrations.videoEndpoint || "";
  if (els.videoEndpoint !== document.activeElement) els.videoEndpoint.value = endpoint;
  els.videoKey.placeholder = videoKey ? "Video key set for this session" : "Paste key for this session";
  const parts = [
    anna ? "Anna connected" : "Standalone preview",
    composio ? `Composio ${composioProbe || "ready"}` : "Composio env missing",
    `${appState.connections.channels.length} channel${appState.connections.channels.length === 1 ? "" : "s"}`,
    videoKey ? "Video key active" : "Video key not set",
    endpoint ? "Endpoint set" : "No endpoint",
  ];
  els.integrationStatus.textContent = parts.join(" · ");
  const entries = [
    ["Anna", anna ? "Connected" : "Standalone preview"],
    ["Composio", composio ? formatStatus(composioProbe || status?.composio?.status || "ready") : "Missing env"],
    ["Channels", String(appState.connections.channels.length)],
    ["Composio API", status?.composio?.base_url || "Not checked"],
    ["Video key", videoKey ? "Active for session" : "Not set"],
    ["Endpoint", endpoint || "Not set"],
  ];
  const authConfigs = Array.isArray(status?.composio?.auth_configs) ? status.composio.auth_configs : [];
  if (authConfigs.length) {
    const missingAuth = authConfigs.filter((item) => !item.configured).map((item) => item.toolkit);
    entries.push(["Auth configs", missingAuth.length ? `Missing ${missingAuth.join(", ")}` : "Ready"]);
  }
  if (status?.composio?.probe?.total_items != null) {
    entries.push(["Tools", String(status.composio.probe.total_items)]);
  }
  const report = factList(entries, "status-list");
  els.integrationReport.replaceChildren(...Array.from(report.children));
}

function renderHandoff() {
  if (appState.tasks.length) {
    const ready = appState.tasks.filter((task) => task.status === "ready_for_review").length;
    els.handoffStatus.textContent = ready
      ? `${ready} action${ready === 1 ? "" : "s"} ready for review.`
      : "Scheduled actions need integration setup.";
    return;
  }
  if (!appState.plan) {
    els.handoffStatus.textContent = "Waiting for a generated plan.";
    return;
  }
  if (appState.videoJob?.status === "submitted") {
    els.handoffStatus.textContent = "Video job submitted to provider.";
  } else if (appState.videoJob?.status === "ready_for_provider") {
    els.handoffStatus.textContent = "Video packet ready; add an endpoint to submit.";
  } else if (appState.videoJob?.status === "needs_video_api_key") {
    els.handoffStatus.textContent = "Video packet needs a provider key.";
  } else if (appState.thumbnailBrief?.image?.url) {
    els.handoffStatus.textContent = "Thumbnail image returned by Anna.";
  } else if (appState.thumbnailBrief?.prompt) {
    els.handoffStatus.textContent = "Thumbnail prompt ready for review.";
  } else if (appState.approvedIds.length) {
    els.handoffStatus.textContent = "Approved assets are ready for review.";
  } else {
    els.handoffStatus.textContent = "Approve assets before handoff.";
  }
}

function factList(entries, className) {
  const dl = document.createElement("dl");
  dl.className = className;
  for (const [label, value] of entries) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value || "Not set";
    row.append(dt, dd);
    dl.append(row);
  }
  return dl;
}

function statusFacts(status) {
  return factList(
    [
      ["Campaign", status.campaign || "No active campaign"],
      ["Plan items", String(status.plan_items || 0)],
      ["Approved", String(status.approved_items || 0)],
      ["Uploads", String(status.uploads || 0)],
      ["Channels", String(status.connected_channels ?? appState.connections.channels.length)],
      ["Tasks", `${status.tasks_waiting || 0} waiting / ${status.tasks_total || 0} total`],
      ["Composio", status.composio_configured ? "Configured" : "Not configured"],
      ["Channels", String(appState.connections.channels.length)],
    ],
    "status-list",
  );
}

function platformPills(platforms, extraClass = "") {
  const row = document.createElement("div");
  row.className = "platform-row";
  for (const platform of platforms || []) {
    const pill = document.createElement("span");
    pill.className = `pill ${extraClass}`.trim();
    pill.textContent = `@${platform}`;
    row.append(pill);
  }
  return row;
}

function statusPill(status) {
  const pill = document.createElement("span");
  const ok = status === "ready_for_review" || status === "host_uploaded" || status === "local_ready" || status === "ACTIVE" || status === "active";
  const warn = status === "needs_composio_api_key" || status === "needs_connected_channel" || status === "needs_auth_config" || status === "needs_time" || status === "link_ready";
  pill.className = `pill ${ok ? "pill--success" : warn ? "pill--warning" : ""}`.trim();
  pill.textContent = formatStatus(status);
  return pill;
}

function connectionSummaryCopy() {
  if (appState.connections.channels.length) {
    return `${appState.connections.channels.length} connected media channel${appState.connections.channels.length === 1 ? "" : "s"}.`;
  }
  if (appState.connections.lastListStatus === "needs_composio_api_key") return "Composio key is required before connecting channels.";
  return "Connect YouTube, Instagram, or TikTok before live publishing.";
}

function connectionCopy(connection) {
  if (!connection) return "No connection result yet.";
  if (connection.status === "link_ready") return `${connection.platform} auth link is ready. Open it to finish connecting the channel.`;
  if (connection.status === "needs_auth_config") {
    const note = connection.note || `Create a Composio auth config, then set ${connection.env_name}.`;
    return `${connection.platform} needs a Composio auth config. ${note}`;
  }
  if (connection.status === "needs_composio_api_key") return "Composio API key is missing in the runtime environment.";
  if (connection.status === "link_error") return `${connection.platform} auth link failed: ${connection.error || "unknown error"}`;
  return `${connection.platform || "Media"} status: ${formatStatus(connection.status)}`;
}

function executionCopy(result) {
  const status = result?.status || result?.execution_state || "unknown";
  if (status === "executed") return "The approved action was executed through Composio.";
  if (status === "execution_error") return "Composio execution returned an error. Check the task details.";
  if (status === "needs_user_approval") return "Approve the task before execution.";
  if (status === "needs_connected_channel") return result?.note || "Connect the selected channel before execution.";
  if (status === "needs_public_media_url") return result?.note || "A public media URL is required before publishing.";
  if (status === "scheduled_waiting") return result?.note || "The task is queued until its scheduled publish time.";
  if (status === "ready_for_composio_execute") return "The task passed safety checks and is ready for Composio execution.";
  if (status === "needs_composio_api_key") return "Composio API key is missing in the runtime environment.";
  return result?.note || `Execution status: ${formatStatus(status)}`;
}

function approveButton(id) {
  const approved = appState.approvedIds.includes(id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mini-button ${approved ? "is-approved" : ""}`;
  button.textContent = approved ? "Approved" : "Approve";
  button.addEventListener("click", async () => {
    toggleApproved(id);
    await refreshAgentStatus({ quiet: true });
    await saveState();
    render();
  });
  return button;
}

function scheduleButton(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = "Schedule";
  button.addEventListener("click", () => onSchedulePlanItem(item));
  return button;
}

function executeTaskButton(task) {
  const approved = appState.approvedIds.includes(task.id);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mini-button";
  button.textContent = task.status === "executed" ? "Executed" : "Execute";
  button.disabled = task.status === "executed";
  button.title = approved ? "Execute approved action through Composio" : "Approve this task before execution";
  button.addEventListener("click", () => onExecuteTask(task));
  return button;
}

async function onSchedulePlanItem(item) {
  setButtonLoading(els.statusRefresh, true, "Scheduling");
  try {
    const task = await planner("schedule_action", {
      plan: appState.plan,
      item_id: item.id,
      platforms: item.platforms,
      prompt: `Schedule ${item.title}`,
      publish_at: "needs_time",
      action_type: "schedule",
      require_review: true,
    });
    appState.tasks = [task, ...appState.tasks.filter((entry) => entry.id !== task.id)];
    setActiveView("workflow");
    appState.messages.push({
      id: newId("task"),
      role: "assistant",
      kind: "task",
      text: "I prepared the action for review.",
      task,
      createdAt: new Date().toISOString(),
    });
    await updateAgentStatusQuietly();
    await saveState();
    showToast("Action prepared for review.");
  } catch (err) {
    showToast(`Could not schedule item: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.statusRefresh, false);
    render();
  }
}

async function onExecuteTask(task) {
  if (!appState.approvedIds.includes(task.id)) {
    showToast("Approve this task before executing it.");
    return;
  }
  setButtonLoading(els.statusRefresh, true, "Executing");
  try {
    const result = await planner("execute_task", {
      task,
      task_id: task.id,
      user_id: appState.userId,
      approved: true,
      live_execute: true,
    });
    const updatedTask = result.task || { ...task, status: result.status, execution: result };
    appState.tasks = [updatedTask, ...appState.tasks.filter((entry) => entry.id !== updatedTask.id)];
    appState.messages.push({
      id: newId("task"),
      role: "assistant",
      kind: "task",
      text: executionCopy(result),
      task: updatedTask,
      createdAt: new Date().toISOString(),
    });
    await updateAgentStatusQuietly();
    await saveState();
    showToast(executionCopy(result));
  } catch (err) {
    showToast(`Execution failed: ${err?.message || err}`);
  } finally {
    setButtonLoading(els.statusRefresh, false);
    render();
  }
}

function emptyListItem(text) {
  const li = document.createElement("li");
  li.className = "muted";
  li.textContent = text;
  return li;
}

function approvedItems() {
  const items = appState.plan?.calendar || [];
  const approved = new Set(appState.approvedIds);
  return items.filter((item) => approved.has(item.id));
}

function toggleApproved(id) {
  const set = new Set(appState.approvedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  appState.approvedIds = Array.from(set);
}

function selectedUpload() {
  return appState.uploads.find((upload) => upload.id === appState.selectedUploadId) || null;
}

function latestUpload() {
  return appState.uploads[0] || null;
}

function stripEphemeralUpload(upload) {
  if (!upload) return null;
  const { previewUrl, error, ...rest } = upload;
  return rest;
}

function stripSensitiveConnection(connection) {
  if (!connection) return null;
  const { redirect_url, link_token, ...rest } = connection;
  return rest;
}

function togglePlatform(platform) {
  const selected = new Set(appState.selectedPlatforms);
  if (selected.has(platform)) {
    if (selected.size === 1) {
      showToast("Keep at least one platform selected.");
      return;
    }
    selected.delete(platform);
  } else {
    selected.add(platform);
  }
  appState.selectedPlatforms = PLATFORMS.filter((entry) => selected.has(entry));
  appState.brand.platforms = appState.selectedPlatforms;
  renderPlatformStrip();
}

function updateMentionMenu() {
  const context = mentionContext();
  if (!context) {
    hideMentionMenu();
    return;
  }
  const query = context.query.toLowerCase();
  const options = PLATFORMS.filter((platform) => platform.toLowerCase().startsWith(query));
  els.mention.replaceChildren();
  if (!options.length) {
    hideMentionMenu();
    return;
  }
  for (const platform of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mention-option ${appState.selectedPlatforms.includes(platform) ? "is-selected" : ""}`;
    button.dataset.mentionPlatform = platform;
    button.setAttribute("role", "option");
    button.textContent = `@${platform}`;
    els.mention.append(button);
  }
  els.mention.hidden = false;
}

function mentionContext() {
  const caret = els.prompt.selectionStart ?? els.prompt.value.length;
  const before = els.prompt.value.slice(0, caret);
  const match = before.match(/(^|\s)@([A-Za-z]*)$/);
  if (!match) return null;
  return {
    query: match[2],
    tokenStart: before.length - match[2].length - 1,
    tokenEnd: caret,
  };
}

function insertMention(platform) {
  const context = mentionContext();
  const start = context?.tokenStart ?? els.prompt.selectionStart ?? els.prompt.value.length;
  const end = context?.tokenEnd ?? els.prompt.selectionEnd ?? els.prompt.value.length;
  const next = `${els.prompt.value.slice(0, start)}@${platform} ${els.prompt.value.slice(end)}`;
  els.prompt.value = next.replace(/\s{2,}/g, " ");
  const caret = Math.min(start + platform.length + 2, els.prompt.value.length);
  els.prompt.setSelectionRange(caret, caret);
  appState.selectedPlatforms = uniquePlatforms([...appState.selectedPlatforms, platform]);
  appState.brand.platforms = appState.selectedPlatforms;
  autoSizePrompt();
  hideMentionMenu();
  renderPlatformStrip();
  els.prompt.focus();
}

function hideMentionMenu() {
  els.mention.hidden = true;
}

function validatePrompt(value, options = {}) {
  const ok = value.length >= 3;
  els.form.classList.toggle("is-error", !ok && !options.quiet);
  els.prompt.setAttribute("aria-invalid", ok || options.quiet ? "false" : "true");
  els.help.classList.toggle("sr-only", ok || options.quiet);
  els.help.textContent = ok || options.quiet ? "Ready." : "Add a short instruction for CreatorOS.";
  return ok;
}

function autoSizePrompt() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 192)}px`;
}

function classifyIntent(text) {
  const value = text.toLowerCase();
  if (/\b(status|progress|queue|what is happening|where are we|agent)\b/.test(value)) return "status";
  if (/\b(upload|publish|post|schedule|calendar|send this|this video|this media)\b/.test(value)) return "schedule";
  return "plan";
}

function intentLabel(intent) {
  return { plan: "Plan", schedule: "Scheduling", status: "Status" }[intent] || "Request";
}

function extractMentionPlatforms(text) {
  const found = [];
  for (const match of text.matchAll(/@([A-Za-z]+)/g)) {
    const platform = canonicalPlatform(match[1]);
    if (platform) found.push(platform);
  }
  return uniquePlatforms(found);
}

function stripPlatformMentions(text) {
  const stripped = text.replace(/@(?:youtube|instagram|tiktok)\b/gi, "").replace(/\s+/g, " ").trim();
  return stripped || text.trim();
}

function canonicalPlatform(value) {
  const key = String(value).toLowerCase();
  return PLATFORMS.find((platform) => platform.toLowerCase() === key) || null;
}

function sanitizePlatforms(value) {
  const platforms = uniquePlatforms(Array.isArray(value) ? value : []);
  return platforms.length ? platforms : [...PLATFORMS];
}

function uniquePlatforms(value) {
  const set = new Set();
  for (const item of value) {
    const platform = canonicalPlatform(item);
    if (platform) set.add(platform);
  }
  return PLATFORMS.filter((platform) => set.has(platform));
}

function inferCadence(text, fallback) {
  const value = text.toLowerCase();
  if (value.includes("weekday")) return "weekdays";
  if (value.includes("weekly") || value.includes("week ")) return "weekly";
  if (value.includes("3 per week") || value.includes("three per week")) return "three_per_week";
  if (value.includes("daily") || value.includes("every day")) return "daily";
  return fallback || "daily";
}

function inferPublishAt(text) {
  const value = text.toLowerCase();
  const now = new Date();
  const atNine = (date) => {
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  };
  if (value.includes("tomorrow")) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    return atNine(date);
  }
  if (value.includes("today")) return atNine(new Date(now));
  const dateMatch = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) return atNine(new Date(`${dateMatch[1]}T09:00:00`));
  return "needs_time";
}

function computedStatus() {
  return {
    campaign: appState.plan?.strategy?.campaign_name || "No active campaign",
    plan_items: appState.plan?.calendar?.length || 0,
    approved_items: appState.approvedIds.length,
    uploads: appState.uploads.length,
    tasks_total: appState.tasks.length,
    tasks_waiting: appState.tasks.filter((task) => TASK_WAITING_STATUSES.has(task.status)).length,
    composio_configured: appState.integrations.composioConfigured,
  };
}

function setConnected(connected) {
  els.connectionDot.classList.toggle("is-connected", connected);
  els.connectionLabel.textContent = connected ? "Connected to Anna" : "Standalone preview";
}

function setButtonLoading(button, loading, label = "") {
  if (loading) {
    const count = Number(button.dataset.loadingCount || "0");
    if (count === 0) button.dataset.originalLabel = button.textContent;
    button.dataset.loadingCount = String(count + 1);
    button.disabled = true;
    button.dataset.state = "loading";
    const labelNode = button.querySelector(".send-button__label");
    if (labelNode) labelNode.textContent = label;
    else button.textContent = label;
  } else {
    const nextCount = Math.max(0, Number(button.dataset.loadingCount || "1") - 1);
    if (nextCount > 0) {
      button.dataset.loadingCount = String(nextCount);
      return;
    }
    delete button.dataset.loadingCount;
    button.disabled = false;
    delete button.dataset.state;
    if (button.dataset.originalLabel) {
      const labelNode = button.querySelector(".send-button__label");
      if (labelNode) labelNode.textContent = button.dataset.originalLabel;
      else button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  els.toastRegion.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function videoJobCopy(job) {
  if (!job) return "Video job is not available yet.";
  if (job.status === "submitted") return "Video job submitted to the configured provider.";
  if (job.status === "provider_error") return `Video provider returned an error: ${job.error || "unknown error"}`;
  if (job.status === "ready_for_provider") return "Video generation packet is ready. Add an endpoint to submit it automatically.";
  if (job.status === "needs_video_api_key") return "Video generation packet is ready, but a video provider key is required before submission.";
  return `Video job status: ${job.status || "prepared"}`;
}

function sanitizeVideoJob(job) {
  if (!job) return null;
  const { status, provider_configured, brief, provider_response, status_code, error, note } = job;
  return { status, provider_configured, brief, provider_response, status_code, error, note };
}

function cadenceLabel(value) {
  return {
    daily: "Daily",
    weekdays: "Weekdays",
    three_per_week: "3 per week",
    weekly: "Weekly",
  }[value] || value;
}

function formatStatus(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function localPlanner(action, args) {
  if (action === "integrations_status") {
    return {
      anna: {
        runtime: "Standalone preview",
        planning: "local fallback planner",
        memory: "in-memory only",
        image: "unavailable outside Anna",
        llm: "available through Anna host runtime when connected",
      },
      composio: {
        configured: false,
        status: "missing_COMPOSIO_API_KEY",
        probe: null,
        note: "Set COMPOSIO_API_KEY in the Anna runtime environment.",
        connected_accounts: { status: "not_checked", accounts: [] },
        auth_configs: [],
      },
      video: {
        configured: Boolean(args.video_api_key_set),
        endpoint_configured: Boolean(args.video_api_endpoint),
        status: args.video_api_key_set ? "ready" : "needs_user_video_api_key",
      },
    };
  }
  if (action === "connect_channel") return localConnectChannel(args);
  if (action === "list_media_connections") {
    return {
      status: "needs_composio_api_key",
      accounts: [],
      note: "Set COMPOSIO_API_KEY before checking connected media channels.",
    };
  }
  if (action === "upload_asset") return localUploadAsset(args);
  if (action === "schedule_action") return localScheduleAction(args);
  if (action === "execute_task") return localExecuteTask(args);
  if (action === "agent_status") return localAgentStatus(args);
  if (action === "video_job") return localVideoJob(args);
  if (action !== "plan") throw new Error(`Unsupported local action: ${action}`);
  const platforms = args.platforms?.length ? args.platforms : [...PLATFORMS];
  const ideas = topicIdeas(args.goal);
  const calendar = Array.from({ length: Math.max(1, args.days || 7) }, (_, index) => {
    const topic = ideas[index % ideas.length];
    const id = `day-${index + 1}-${slug(topic)}`;
    const title = titleFor(topic, args.audience);
    const platformsForDay = platformsForCadence(platforms, args.cadence, index);
    return {
      id,
      day_label: `Day ${index + 1}`,
      title,
      angle: `Teach ${topic.toLowerCase()} through one concrete example for ${args.audience || "the target audience"}.`,
      platforms: platformsForDay,
      script: scriptFor(topic, args.voice),
      caption: captionFor(topic, args.goal),
      hashtags: hashtagsFor(topic, platformsForDay),
      thumbnail_prompt: `Clean educational thumbnail about ${topic}. Use one readable phrase, calm contrast, and a creator desk context.`,
    };
  });
  return {
    strategy: {
      campaign_name: campaignName(args.goal),
      goal: args.goal,
      audience: args.audience,
      cadence: cadenceLabel(args.cadence),
      voice: args.voice,
      platforms,
      pillars: ideas.slice(0, 4),
      review_rule: "Every publishing action waits for explicit user approval.",
    },
    calendar,
    analytics: {
      planned_assets: calendar.length * platforms.length,
      approved_assets: 0,
      note: "Performance metrics are intentionally empty until connected platform data exists.",
    },
  };
}

function localUploadAsset(args) {
  return {
    id: newId("upload"),
    file_name: args.file_name,
    file_size: args.file_size || 0,
    mime_type: args.mime_type || "application/octet-stream",
    file_ref: args.file_ref || null,
    url: args.url || null,
    platforms: sanitizePlatforms(args.platforms || appState.selectedPlatforms),
    prompt: args.prompt || "",
    status: args.file_ref ? "host_uploaded" : "local_ready",
    review_required: true,
    created_at: Date.now(),
  };
}

function localScheduleAction(args) {
  const planItem =
    (args.plan?.calendar || []).find((entry) => entry.id === args.item_id) ||
    args.plan?.calendar?.[0] ||
    null;
  const chosenPlatforms = sanitizePlatforms(args.platforms || args.upload?.platforms || appState.selectedPlatforms);
  const platformPayloads = Object.fromEntries(
    chosenPlatforms.map((platform) => [
      platform,
      {
        title: args.upload?.file_name || planItem?.title || "CreatorOS post",
        caption: planItem?.caption || args.prompt || "",
        script: planItem?.script || "",
        hashtags: planItem?.hashtags || [],
        file_ref: args.upload?.file_ref || null,
        mime_type: args.upload?.mime_type || null,
      },
    ]),
  );
  return {
    id: newId("task"),
    action_type: args.action_type || "publish",
    status: "needs_connected_channel",
    platforms: chosenPlatforms,
    publish_at: args.publish_at || "needs_time",
    prompt: args.prompt || "",
    upload: args.upload || null,
    plan_item: planItem,
    platform_payloads: platformPayloads,
    execution_steps: ["human_review", "validate_platform_connections", "execute_with_composio", "record_result_in_anna_storage"],
    review_required: true,
    composio: {
      configured: appState.integrations.composioConfigured,
      execution_state: "not_executed",
      missing_toolkits: chosenPlatforms.map((platform) => platform.toLowerCase()),
      note: "Connect the target media channel before Composio execution.",
    },
    created_at: Date.now(),
  };
}

function localExecuteTask(args) {
  const task = args.task || appState.tasks.find((entry) => entry.id === args.task_id);
  if (!task) {
    return {
      status: "missing_task",
      execution_state: "not_executed",
      note: "Select a scheduled action before executing.",
    };
  }
  const updated = {
    ...task,
    status: args.approved ? "needs_connected_channel" : "needs_user_approval",
    execution: {
      state: "blocked",
      live_execute: Boolean(args.live_execute),
      note: args.approved
        ? "Connect the selected media channel before Composio execution."
        : "Approve this task before any external publishing call.",
    },
  };
  return {
    status: updated.status,
    execution_state: "blocked",
    task: updated,
    note: updated.execution.note,
  };
}

function localConnectChannel(args) {
  const platform = canonicalPlatform(args.platform || "YouTube") || "YouTube";
  const toolkit = platform.toLowerCase();
  return {
    status: "needs_auth_config",
    platform,
    toolkit,
    env_name: `COMPOSIO_${platform.toUpperCase()}_AUTH_CONFIG_ID`,
    note:
      toolkit === "tiktok"
        ? "TikTok requires a custom Composio OAuth auth config for this project. Create it with your TikTok client credentials, then set the auth config id in the runtime environment."
        : "Create a Composio auth config for this toolkit, then set the auth config id in the runtime environment.",
  };
}

function localAgentStatus(args) {
  const plan = args.plan || appState.plan;
  const uploads = args.uploads || appState.uploads;
  const tasks = args.tasks || appState.tasks;
  const connections = args.connections || appState.connections.channels;
  return {
    campaign: plan?.strategy?.campaign_name || "No active campaign",
    plan_items: plan?.calendar?.length || 0,
    approved_items: args.approved_ids?.length || appState.approvedIds.length,
    uploads: uploads.length,
    connected_channels: connections.length,
    tasks_total: tasks.length,
    tasks_waiting: tasks.filter((task) => TASK_WAITING_STATUSES.has(task.status)).length,
    composio_configured: false,
    next_actions: ["Generate a campaign plan", "Upload source media", "Connect social accounts in Composio"],
  };
}

function localVideoJob(args) {
  const plan = args.plan || appState.plan;
  const item = (plan?.calendar || []).find((entry) => entry.id === args.item_id) || plan?.calendar?.[0];
  if (!item) throw new Error("No plan item is available for video generation.");
  const brief = {
    title: item.title,
    prompt: item.angle,
    script: item.script,
    caption: item.caption,
    thumbnail_prompt: item.thumbnail_prompt,
    hashtags: item.hashtags || [],
    platforms: item.platforms || plan.strategy?.platforms || [],
    campaign: plan.strategy?.campaign_name,
    aspect_ratios: { YouTube: "16:9", Instagram: "9:16", TikTok: "9:16" },
    review_required: true,
  };
  if (!args.video_api_key) {
    return {
      status: "needs_video_api_key",
      provider_configured: false,
      brief,
      note: "Add a user video provider API key before submitting generation.",
    };
  }
  if (!args.video_api_endpoint) {
    return {
      status: "ready_for_provider",
      provider_configured: true,
      brief,
      note: "No provider endpoint is configured, so this is a prepared generation packet.",
    };
  }
  return {
    status: "submitted",
    provider_configured: true,
    brief,
    provider_response: { preview: true, endpoint: args.video_api_endpoint },
    status_code: 202,
  };
}

function topicIdeas(goal) {
  const base = (goal || "creator growth").toLowerCase();
  if (base.includes("ai")) {
    return ["AI workflow basics", "Prompt examples", "Tool comparison", "Automation mistake", "Founder use case", "Before and after", "Weekly AI teardown"];
  }
  if (base.includes("startup")) {
    return ["Founder lesson", "Product demo", "Customer objection", "Launch story", "Behind the scenes", "Feature tutorial", "Weekly build log"];
  }
  return ["Audience pain point", "Quick tutorial", "Creator story", "Myth correction", "Tool walkthrough", "Trend response", "Weekly recap"];
}

function campaignName(goal) {
  const text = (goal || "Creator Sprint").replace(/[^\w\s-]/g, "").trim();
  const words = text.split(/\s+/).filter(Boolean).slice(0, 4);
  return words.length ? `${words.join(" ")} Sprint` : "Creator Sprint";
}

function titleFor(topic, audience) {
  const target = audience ? audience.split(/\s+/).slice(0, 3).join(" ") : "creators";
  return `${topic} for ${target}`;
}

function scriptFor(topic, voice) {
  return [
    `Hook: Most creators overcomplicate ${topic.toLowerCase()}.`,
    `Point: Show one repeatable step in a ${voice || "practical"} voice.`,
    "Example: Walk through the before state, the action, and the result.",
    "Close: Ask the viewer to save it and try the step today.",
  ].join("\n");
}

function captionFor(topic, goal) {
  return `${topic}: a practical step toward ${goal || "your creator goal"}. Save this before planning your next post.`;
}

function hashtagsFor(topic, platforms) {
  const core = topic
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => `#${part.replace(/[^\w]/g, "")}`);
  return Array.from(new Set([...core, "#CreatorOS", platforms.includes("TikTok") ? "#LearnOnTikTok" : "#CreatorWorkflow"]));
}

function platformsForCadence(platforms, cadence, index) {
  if (cadence === "three_per_week" && index % 2 === 1) return platforms.slice(0, 1);
  if (cadence === "weekly" && index > 0) return platforms.slice(0, 1);
  return platforms;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
