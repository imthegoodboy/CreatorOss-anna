#!/usr/bin/env python3
"""CreatorOS Planner - Anna Executa stdio tool.

The plugin exposes one dispatcher method, ``creatoros_plan``. The UI passes an
``action`` argument and receives deterministic planning payloads that work in
local dev without external social APIs.
"""

from __future__ import annotations

import json
import ipaddress
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

STATE_DIR = Path(os.path.expanduser("~/.anna/creatoros-ai"))
STATE_FILE = STATE_DIR / "state.json"
COMPOSIO_BASE_URL = os.getenv("COMPOSIO_BASE_URL", "https://backend.composio.dev/api/v3.1").rstrip("/")
VIDEO_REQUEST_TIMEOUT_S = 45
PROTOCOL_VERSION_V2 = "2.0"
EXECUTION_WAITING_STATUSES = {
    "ready_for_review",
    "needs_composio_api_key",
    "needs_connected_channel",
    "needs_public_media_url",
    "needs_user_approval",
    "ready_for_composio_execute",
    "scheduled_waiting",
}
PLATFORM_EXECUTION_TOOLS = {
    "youtube": ["YOUTUBE_UPLOAD_VIDEO", "YOUTUBE_MULTIPART_UPLOAD_VIDEO"],
    "instagram": ["INSTAGRAM_POST_IG_USER_MEDIA", "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", "INSTAGRAM_CREATE_POST"],
    "tiktok": ["TIKTOK_PUBLISH_VIDEO", "TIKTOK_UPLOAD_VIDEO"],
}

MANIFEST: dict[str, Any] = {
    "display_name": "CreatorOS Planner",
    "version": "0.1.4",
    "description": "Creates and manages creator strategy, uploads, scheduling packets, agent status, and review payloads for CreatorOS AI.",
    "author": "CreatorOS AI",
    "license": "MIT",
    "tags": ["creator", "planning", "social-media", "anna-app"],
    "tools": [
        {
            "name": "creatoros_plan",
            "description": "Plan and manage creator content workflows. Supports planning, uploads, scheduling, status, integrations, and video jobs.",
            "parameters": [
                {"name": "action", "type": "string", "description": "plan | content_pack | analytics | integrations_status | connect_channel | list_media_connections | upload_asset | schedule_action | execute_task | agent_status | video_job | save_state | get_state", "required": True},
                {"name": "goal", "type": "string", "description": "Creator goal for action=plan.", "required": False},
                {"name": "audience", "type": "string", "description": "Target audience.", "required": False},
                {"name": "cadence", "type": "string", "description": "daily | weekdays | three_per_week | weekly.", "required": False},
                {"name": "voice", "type": "string", "description": "Brand voice.", "required": False},
                {"name": "platforms", "type": "array", "items": {"type": "string"}, "description": "Platforms to plan for.", "required": False},
                {"name": "days", "type": "integer", "description": "Number of days to plan.", "required": False},
                {"name": "plan", "type": "object", "description": "Existing plan for content/video actions.", "required": False},
                {"name": "item_id", "type": "string", "description": "Calendar item id for content/video actions.", "required": False},
                {"name": "video_api_key", "type": "string", "description": "User-supplied video provider API key. Never returned in responses.", "required": False},
                {"name": "video_api_endpoint", "type": "string", "description": "Optional custom video generation endpoint.", "required": False},
                {"name": "video_api_key_set", "type": "boolean", "description": "Whether the UI currently holds a video API key.", "required": False},
                {"name": "composio_api_key", "type": "string", "description": "Optional session-only Composio API key. Used when hosted runtime settings do not provide COMPOSIO_API_KEY and never returned in responses.", "required": False},
                {"name": "probe_composio", "type": "boolean", "description": "When true, call Composio tools API to verify the configured key.", "required": False},
                {"name": "upload", "type": "object", "description": "Uploaded media metadata for upload/schedule actions.", "required": False},
                {"name": "uploads", "type": "array", "items": {"type": "object"}, "description": "Known uploaded assets.", "required": False},
                {"name": "task", "type": "object", "description": "Scheduled task for action=execute_task.", "required": False},
                {"name": "tasks", "type": "array", "items": {"type": "object"}, "description": "Known scheduled/publishing tasks.", "required": False},
                {"name": "platform", "type": "string", "description": "Single media platform for connection actions.", "required": False},
                {"name": "connections", "type": "array", "items": {"type": "object"}, "description": "Known connected channel records.", "required": False},
                {"name": "inactive_connections", "type": "array", "items": {"type": "object"}, "description": "Known inactive or expired channel records for status reporting.", "required": False},
                {"name": "user_id", "type": "string", "description": "Stable Composio end-user id for connection actions.", "required": False},
                {"name": "callback_url", "type": "string", "description": "Optional callback URL for Composio auth links.", "required": False},
                {"name": "prompt", "type": "string", "description": "User instruction for upload, schedule, or status actions.", "required": False},
                {"name": "publish_at", "type": "string", "description": "Requested publish time, if known.", "required": False},
                {"name": "file_name", "type": "string", "description": "Uploaded file name for action=upload_asset.", "required": False},
                {"name": "file_size", "type": "integer", "description": "Uploaded file byte size for action=upload_asset.", "required": False},
                {"name": "mime_type", "type": "string", "description": "Uploaded file MIME type for action=upload_asset.", "required": False},
                {"name": "file_ref", "type": "string", "description": "Anna host upload file_ref when available.", "required": False},
                {"name": "approved", "type": "boolean", "description": "Explicit user approval for action=execute_task.", "required": False},
                {"name": "live_execute", "type": "boolean", "description": "When true, call Composio execution endpoints after all guards pass.", "required": False},
                {"name": "state", "type": "object", "description": "State object for save_state.", "required": False}
            ],
        }
    ],
    "runtime": {"type": "uv", "min_version": "0.1.0"},
}


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict[str, Any]) -> dict[str, Any]:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STATE_FILE)
    return {"ok": True, "state_file": str(STATE_FILE)}


def _slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return value or "item"


def _cadence_label(value: str) -> str:
    return {
        "daily": "Daily",
        "weekdays": "Weekdays",
        "three_per_week": "3 per week",
        "weekly": "Weekly",
    }.get(value, value or "Daily")


def _topic_ideas(goal: str) -> list[str]:
    base = goal.lower()
    if "ai" in base:
        return [
            "AI workflow basics",
            "Prompt examples",
            "Tool comparison",
            "Automation mistake",
            "Founder use case",
            "Before and after",
            "Weekly AI teardown",
        ]
    if "startup" in base:
        return [
            "Founder lesson",
            "Product demo",
            "Customer objection",
            "Launch story",
            "Behind the scenes",
            "Feature tutorial",
            "Weekly build log",
        ]
    return [
        "Audience pain point",
        "Quick tutorial",
        "Creator story",
        "Myth correction",
        "Tool walkthrough",
        "Trend response",
        "Weekly recap",
    ]


def _campaign_name(goal: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", goal).strip()
    words = [word for word in cleaned.split() if word][:4]
    return f"{' '.join(words)} Sprint" if words else "Creator Sprint"


def _platforms_for_day(platforms: list[str], cadence: str, index: int) -> list[str]:
    if cadence == "three_per_week" and index % 2 == 1:
        return platforms[:1]
    if cadence == "weekly" and index > 0:
        return platforms[:1]
    return platforms


def _hashtags(topic: str, platforms: list[str]) -> list[str]:
    core = [f"#{re.sub(r'[^A-Za-z0-9_]', '', part)}" for part in topic.split()[:2]]
    tags = core + ["#CreatorOS", "#LearnOnTikTok" if "TikTok" in platforms else "#CreatorWorkflow"]
    seen: set[str] = set()
    out: list[str] = []
    for tag in tags:
        if tag != "#" and tag not in seen:
            out.append(tag)
            seen.add(tag)
    return out


def _script_for(topic: str, voice: str) -> str:
    voice = voice or "practical and direct"
    return "\n".join(
        [
            f"Hook: Most creators overcomplicate {topic.lower()}.",
            f"Point: Show one repeatable step in a {voice} voice.",
            "Example: Walk through the before state, the action, and the result.",
            "Close: Ask the viewer to save it and try the step today.",
        ]
    )


def _caption_for(topic: str, goal: str) -> str:
    target = goal or "your creator goal"
    return f"{topic}: a practical step toward {target}. Save this before planning your next post."


def _title_for(topic: str, audience: str) -> str:
    target = " ".join((audience or "creators").split()[:3])
    return f"{topic} for {target}"


def action_plan(
    goal: str = "",
    audience: str = "",
    cadence: str = "daily",
    voice: str = "",
    platforms: list[str] | None = None,
    days: int = 7,
    **_: Any,
) -> dict[str, Any]:
    goal = (goal or "Grow my creator channel").strip()
    audience = (audience or "current audience").strip()
    voice = (voice or "practical and direct").strip()
    cadence = cadence or "daily"
    platforms = platforms or ["YouTube", "Instagram", "TikTok"]
    days = max(1, min(int(days or 7), 14))
    ideas = _topic_ideas(goal)
    calendar: list[dict[str, Any]] = []
    for index in range(days):
        topic = ideas[index % len(ideas)]
        active_platforms = _platforms_for_day(platforms, cadence, index)
        item_id = f"day-{index + 1}-{_slug(topic)}"
        calendar.append(
            {
                "id": item_id,
                "day_label": f"Day {index + 1}",
                "title": _title_for(topic, audience),
                "angle": f"Teach {topic.lower()} through one concrete example for {audience}.",
                "platforms": active_platforms,
                "script": _script_for(topic, voice),
                "caption": _caption_for(topic, goal),
                "hashtags": _hashtags(topic, active_platforms),
                "thumbnail_prompt": (
                    f"Clean educational thumbnail about {topic}. Use one readable phrase, "
                    "calm contrast, and a creator desk context."
                ),
            }
        )

    plan = {
        "strategy": {
            "campaign_name": _campaign_name(goal),
            "goal": goal,
            "audience": audience,
            "cadence": _cadence_label(cadence),
            "voice": voice,
            "platforms": platforms,
            "pillars": ideas[:4],
            "review_rule": "Every publishing action waits for explicit user approval.",
        },
        "calendar": calendar,
        "analytics": {
            "planned_assets": len(calendar) * len(platforms),
            "approved_assets": 0,
            "note": "Performance metrics are intentionally empty until connected platform data exists.",
        },
        "generated_at": int(time.time()),
    }
    _save_state({"last_plan": plan})
    return plan


def action_content_pack(plan: dict[str, Any] | None = None, item_id: str = "", **_: Any) -> dict[str, Any]:
    source = plan or _load_state().get("last_plan") or {}
    for item in source.get("calendar", []):
        if item.get("id") == item_id:
            return item
    raise ValueError(f"content item not found: {item_id}")


def action_analytics(plan: dict[str, Any] | None = None, approved_ids: list[str] | None = None, **_: Any) -> dict[str, Any]:
    source = plan or _load_state().get("last_plan") or {}
    approved_ids = approved_ids or []
    total = len(source.get("calendar", []))
    return {
        "planned_items": total,
        "approved_items": len(approved_ids),
        "readiness_percent": round((len(approved_ids) / total) * 100) if total else 0,
        "note": "Connect platform analytics before evaluating performance.",
    }


def _first_item(plan: dict[str, Any] | None, item_id: str = "") -> dict[str, Any]:
    source = plan or _load_state().get("last_plan") or {}
    items = source.get("calendar", [])
    if item_id:
        for item in items:
            if item.get("id") == item_id:
                return item
        raise ValueError(f"content item not found: {item_id}")
    if not items:
        raise ValueError("no plan item is available")
    return items[0]


def _video_request_payload(plan: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    strategy = plan.get("strategy") or {}
    return {
        "title": item.get("title"),
        "prompt": item.get("angle"),
        "script": item.get("script"),
        "caption": item.get("caption"),
        "thumbnail_prompt": item.get("thumbnail_prompt"),
        "hashtags": item.get("hashtags") or [],
        "platforms": item.get("platforms") or strategy.get("platforms") or [],
        "campaign": strategy.get("campaign_name"),
        "aspect_ratios": {
            "YouTube": "16:9",
            "Instagram": "9:16",
            "TikTok": "9:16",
        },
        "review_required": True,
    }


def _post_json(url: str, api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "CreatorOS-AI/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=VIDEO_REQUEST_TIMEOUT_S) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw[:2000]}
            return {"ok": True, "status_code": resp.status, "response": parsed}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "status_code": exc.code, "error": raw[:2000]}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": str(exc.reason)}


def _validate_public_https_endpoint(url: str) -> tuple[bool, str]:
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme != "https":
        return False, "Video provider endpoint must use HTTPS."
    if not parsed.hostname:
        return False, "Video provider endpoint is missing a hostname."
    hostname = parsed.hostname.strip().lower()
    if hostname in {"localhost", "127.0.0.1", "::1"} or hostname.endswith(".localhost"):
        return False, "Localhost endpoints are not allowed for provider submission."
    try:
        infos = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False, "Video provider hostname could not be resolved."
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            return False, "Video provider hostname resolved to an invalid address."
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False, "Video provider endpoint must resolve to a public internet address."
    return True, ""


def _get_json(url: str, headers: dict[str, str] | None = None, timeout: int = 15) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "CreatorOS-AI/0.1",
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw[:2000]}
            return {"ok": True, "status_code": resp.status, "response": parsed}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "status_code": exc.code, "error": raw[:2000]}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": str(exc.reason)}


def _post_json_headers(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, timeout: int = 20) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "CreatorOS-AI/0.1",
            **(headers or {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {"raw": raw[:2000]}
            return {"ok": True, "status_code": resp.status, "response": parsed}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "status_code": exc.code, "error": raw[:2000]}
    except urllib.error.URLError as exc:
        return {"ok": False, "error": str(exc.reason)}


def _platform_slug(platform: str) -> str:
    normalized = _normalize_platforms([platform])[0]
    return normalized.lower()


def _composio_api_key(override: str = "") -> str:
    return (override or "").strip() or os.getenv("COMPOSIO_API_KEY") or ""


def _auth_config_env_name(toolkit_slug: str) -> str:
    return f"COMPOSIO_{toolkit_slug.upper()}_AUTH_CONFIG_ID"


def _auth_config_setup_note(toolkit_slug: str) -> str:
    if toolkit_slug == "tiktok":
        return (
            "TikTok requires a custom Composio OAuth auth config for this project. "
            "Create it with your TikTok client credentials, then add the auth config id to the Anna runtime settings."
        )
    return "Create a Composio auth config for this toolkit, then add the auth config id to the Anna runtime settings."


def _find_auth_config(api_key: str, toolkit_slug: str) -> dict[str, Any] | None:
    env_id = os.getenv(_auth_config_env_name(toolkit_slug)) or os.getenv(f"COMPOSIO_AUTH_CONFIG_ID_{toolkit_slug.upper()}")
    if env_id:
        return {"id": env_id, "source": "env", "toolkit": toolkit_slug, "status": "ENABLED"}
    url = f"{COMPOSIO_BASE_URL}/auth_configs?{urllib.parse.urlencode({'toolkit_slug': toolkit_slug, 'limit': 20})}"
    result = _get_json(url, {"x-api-key": api_key})
    if not result.get("ok"):
        return None
    items = (result.get("response") or {}).get("items") or []
    if not isinstance(items, list):
        return None
    enabled = [item for item in items if isinstance(item, dict) and item.get("status") == "ENABLED"]
    chosen = (enabled or items or [None])[0]
    if not isinstance(chosen, dict):
        return None
    return {
        "id": chosen.get("id"),
        "source": "composio",
        "toolkit": toolkit_slug,
        "status": chosen.get("status"),
        "name": chosen.get("name"),
        "is_composio_managed": chosen.get("is_composio_managed"),
    }


def _list_connected_accounts(api_key: str, toolkit_slugs: list[str] | None = None, user_id: str = "") -> dict[str, Any]:
    params: dict[str, Any] = {"limit": 100, "account_type": "ALL"}
    if toolkit_slugs:
        params["toolkit_slugs"] = ",".join(toolkit_slugs)
    if user_id:
        params["user_ids"] = user_id
    url = f"{COMPOSIO_BASE_URL}/connected_accounts?{urllib.parse.urlencode(params)}"
    result = _get_json(url, {"x-api-key": api_key})
    if not result.get("ok"):
        return {
            "status": "error",
            "status_code": result.get("status_code"),
            "error": result.get("error", "Could not list connected accounts")[:500],
            "accounts": [],
        }
    payload = result.get("response") or {}
    accounts = []
    for item in payload.get("items") or []:
        if not isinstance(item, dict):
            continue
        toolkit = (item.get("toolkit") or {}).get("slug")
        status = str(item.get("status") or "").upper()
        disabled = bool(item.get("is_disabled"))
        accounts.append(
            {
                "id": item.get("id"),
                "alias": item.get("alias"),
                "user_id": item.get("user_id"),
                "status": item.get("status"),
                "toolkit": toolkit,
                "is_disabled": disabled,
                "is_active": bool(toolkit and not disabled and status in {"ACTIVE", "ENABLED", "CONNECTED"}),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
            }
        )
    active_count = sum(1 for account in accounts if account.get("is_active"))
    return {
        "status": "ready",
        "total_items": payload.get("total_items", len(accounts)),
        "active_items": active_count,
        "inactive_items": len(accounts) - active_count,
        "accounts": accounts,
    }


def _active_account_by_toolkit(accounts: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    active: dict[str, dict[str, Any]] = {}
    for account in accounts:
        toolkit = str(account.get("toolkit") or "").lower()
        status = str(account.get("status") or "").upper()
        disabled = bool(account.get("is_disabled"))
        if toolkit and not disabled and status in {"ACTIVE", "ENABLED"} and toolkit not in active:
            active[toolkit] = account
    return active


def _is_active_connection(connection: dict[str, Any]) -> bool:
    status = str(connection.get("status") or "").upper()
    disabled = bool(connection.get("is_disabled"))
    return not disabled and (bool(connection.get("is_active")) or status in {"ACTIVE", "ENABLED", "CONNECTED"})


def _task_media_url(task: dict[str, Any]) -> str:
    upload = task.get("upload") if isinstance(task.get("upload"), dict) else {}
    candidates = [
        upload.get("url"),
        upload.get("download_url"),
        upload.get("media_url"),
        upload.get("public_url"),
    ]
    for payload in (task.get("platform_payloads") or {}).values():
        if isinstance(payload, dict):
            candidates.extend([payload.get("url"), payload.get("download_url"), payload.get("media_url"), payload.get("public_url")])
    for value in candidates:
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return ""


def _task_execution_text(task: dict[str, Any], platform: str, media_url: str) -> str:
    payload = (task.get("platform_payloads") or {}).get(platform) or {}
    plan_item = task.get("plan_item") if isinstance(task.get("plan_item"), dict) else {}
    title = payload.get("title") or (task.get("upload") or {}).get("file_name") or plan_item.get("title") or "CreatorOS post"
    caption = payload.get("caption") or plan_item.get("caption") or task.get("prompt") or ""
    hashtags = payload.get("hashtags") or plan_item.get("hashtags") or []
    script = payload.get("script") or plan_item.get("script") or ""
    when = task.get("publish_at") or "publish now"
    return "\n".join(
        [
            f"Publish this approved CreatorOS media to {platform}.",
            f"Title: {title}",
            f"Caption: {caption}",
            f"Hashtags: {' '.join(hashtags) if isinstance(hashtags, list) else hashtags}",
            f"Script/notes: {script}",
            f"Media URL: {media_url}",
            f"Requested publish time: {when}",
            "Use a safe public/draft visibility if the platform requires an unaudited or review-only mode.",
            "Do not delete, rate, comment on, or modify unrelated existing content.",
        ]
    )


def _future_publish_wait(publish_at: str) -> bool:
    if not publish_at or publish_at == "needs_time":
        return False
    normalized = publish_at.replace("Z", "+00:00")
    try:
        from datetime import datetime, timezone

        target = datetime.fromisoformat(normalized)
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        return (target - datetime.now(timezone.utc)).total_seconds() > 60
    except ValueError:
        return False


def _probe_composio(api_key: str) -> dict[str, Any]:
    url = f"{COMPOSIO_BASE_URL}/tools?{urllib.parse.urlencode({'toolkit_slug': 'youtube'})}"
    result = _get_json(url, {"x-api-key": api_key})
    if result.get("ok"):
        payload = result.get("response") or {}
        items = payload.get("items") if isinstance(payload, dict) else []
        sample_tools: list[str] = []
        if isinstance(items, list):
            for item in items[:5]:
                if isinstance(item, dict):
                    sample_tools.append(str(item.get("slug") or item.get("name") or item.get("display_name") or "tool"))
        return {
            "status": "ready",
            "status_code": result.get("status_code"),
            "toolkit": "youtube",
            "total_items": payload.get("total_items") if isinstance(payload, dict) else None,
            "sample_tools": sample_tools,
        }
    status_code = result.get("status_code")
    return {
        "status": "auth_failed" if status_code in {401, 403} else "error",
        "status_code": status_code,
        "error": result.get("error", "Composio probe failed")[:500],
    }


def action_integrations_status(
    video_api_key_set: bool = False,
    video_api_endpoint: str = "",
    probe_composio: bool = False,
    user_id: str = "",
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    composio_key = _composio_api_key(composio_api_key)
    composio_configured = bool(composio_key)
    composio_probe = _probe_composio(composio_key) if composio_key and probe_composio else None
    composio_status = composio_probe.get("status") if composio_probe else ("ready" if composio_configured else "needs_composio_api_key")
    media_connections = (
        _list_connected_accounts(composio_key, ["youtube", "instagram", "tiktok"], user_id=user_id)
        if composio_key and probe_composio
        else {"status": "not_checked", "accounts": []}
    )
    auth_configs = []
    if composio_key and probe_composio:
        for slug in ["youtube", "instagram", "tiktok"]:
            found = _find_auth_config(composio_key, slug)
            auth_configs.append(
                {
                    "toolkit": slug,
                    "configured": bool(found and found.get("id")),
                    "id": found.get("id") if found else None,
                    "source": found.get("source") if found else None,
                    "status": found.get("status") if found else None,
                }
            )
    return {
        "anna": {
            "runtime": "Anna App UI Runtime",
            "planning": "tools.invoke -> bundled creatoros-planner",
            "memory": "storage.get/set",
            "image": "image.generate when granted by host",
            "llm": "Anna host chat/agent runtime; direct llm.complete is not required for this app",
        },
        "composio": {
            "configured": composio_configured,
            "base_url": COMPOSIO_BASE_URL,
            "auth_header": "x-api-key",
            "status": composio_status,
            "probe": composio_probe,
            "note": "Publishing actions require connected social accounts before execution.",
            "toolkits": ["youtube", "instagram", "tiktok"],
            "auth_configs": auth_configs,
            "connected_accounts": media_connections,
        },
        "video": {
            "configured": bool(video_api_key_set),
            "endpoint_configured": bool(video_api_endpoint),
            "status": "ready" if video_api_key_set else "needs_user_video_api_key",
        },
    }


def action_list_media_connections(
    user_id: str = "",
    platforms: list[str] | None = None,
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    api_key = _composio_api_key(composio_api_key)
    if not api_key:
        return {
            "status": "needs_composio_api_key",
            "accounts": [],
            "note": "Add a session Composio API key before checking connected media channels.",
        }
    slugs = [_platform_slug(platform) for platform in _normalize_platforms(platforms or ["YouTube", "Instagram", "TikTok"])]
    return _list_connected_accounts(api_key, slugs, user_id=user_id)


def action_connect_channel(
    platform: str = "YouTube",
    user_id: str = "creatoros-user",
    callback_url: str = "",
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    api_key = _composio_api_key(composio_api_key)
    toolkit_slug = _platform_slug(platform)
    display_platform = _normalize_platforms([platform])[0]
    if not api_key:
        return {
            "status": "needs_composio_api_key",
            "platform": display_platform,
            "toolkit": toolkit_slug,
            "note": "Add a session Composio API key before creating media channel auth links.",
        }

    auth_config = _find_auth_config(api_key, toolkit_slug)
    if not auth_config or not auth_config.get("id"):
        return {
            "status": "needs_auth_config",
            "platform": display_platform,
            "toolkit": toolkit_slug,
            "env_name": _auth_config_env_name(toolkit_slug),
            "note": _auth_config_setup_note(toolkit_slug),
            "dashboard_hint": "Composio Dashboard -> Authentication management -> Create Auth Config",
        }

    payload: dict[str, Any] = {
        "auth_config_id": auth_config["id"],
        "user_id": user_id or "creatoros-user",
        "alias": f"creatoros-{toolkit_slug}-{user_id or 'user'}",
    }
    if callback_url:
        payload["callback_url"] = callback_url
    result = _post_json_headers(
        f"{COMPOSIO_BASE_URL}/connected_accounts/link",
        payload,
        {"x-api-key": api_key},
    )
    if not result.get("ok"):
        return {
            "status": "link_error",
            "platform": display_platform,
            "toolkit": toolkit_slug,
            "auth_config": auth_config,
            "status_code": result.get("status_code"),
            "error": result.get("error", "Could not create auth link")[:500],
        }
    response = result.get("response") or {}
    connection = {
        "status": "link_ready",
        "platform": display_platform,
        "toolkit": toolkit_slug,
        "auth_config": auth_config,
        "user_id": user_id,
        "connected_account_id": response.get("connected_account_id"),
        "link_token": response.get("link_token"),
        "redirect_url": response.get("redirect_url"),
        "expires_at": response.get("expires_at"),
        "created_at": int(time.time()),
        "note": "Open the redirect URL to finish connecting the channel.",
    }
    state = _load_state()
    links = state.get("connection_links", [])
    links.append({key: value for key, value in connection.items() if key != "redirect_url"})
    state["connection_links"] = links[-30:]
    _save_state(state)
    return connection


def _normalize_platforms(platforms: list[str] | None) -> list[str]:
    allowed = {"youtube": "YouTube", "instagram": "Instagram", "tiktok": "TikTok"}
    out: list[str] = []
    for item in platforms or []:
        platform = allowed.get(str(item).strip().lower())
        if platform and platform not in out:
            out.append(platform)
    return out or ["YouTube"]


def _short_id(prefix: str, value: str = "") -> str:
    basis = _slug(value or str(time.time_ns()))[:20]
    return f"{prefix}-{int(time.time())}-{basis}"


def action_upload_asset(
    file_name: str = "",
    file_size: int = 0,
    mime_type: str = "",
    file_ref: str = "",
    url: str = "",
    platforms: list[str] | None = None,
    prompt: str = "",
    **_: Any,
) -> dict[str, Any]:
    if not file_name:
        raise ValueError("file_name is required")
    asset = {
        "id": _short_id("upload", file_name),
        "file_name": file_name,
        "file_size": int(file_size or 0),
        "mime_type": mime_type or "application/octet-stream",
        "file_ref": file_ref or None,
        "url": url or None,
        "platforms": _normalize_platforms(platforms),
        "prompt": prompt.strip(),
        "status": "host_uploaded" if file_ref else "local_ready",
        "review_required": True,
        "created_at": int(time.time()),
    }
    state = _load_state()
    uploads = [entry for entry in state.get("uploads", []) if entry.get("id") != asset["id"]]
    uploads.append(asset)
    state["uploads"] = uploads[-50:]
    _save_state(state)
    return asset


def action_schedule_action(
    plan: dict[str, Any] | None = None,
    upload: dict[str, Any] | None = None,
    item_id: str = "",
    platforms: list[str] | None = None,
    prompt: str = "",
    publish_at: str = "",
    action_type: str = "publish",
    require_review: bool = True,
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    composio_key = _composio_api_key(composio_api_key)
    composio_configured = bool(composio_key)
    source = plan or _load_state().get("last_plan") or {}
    chosen_platforms = _normalize_platforms(platforms or upload.get("platforms") if isinstance(upload, dict) else platforms)
    connected_summary = (
        _list_connected_accounts(composio_key, [platform.lower() for platform in chosen_platforms])
        if composio_key
        else {"status": "needs_composio_api_key", "accounts": []}
    )
    active_toolkits = {
        str(account.get("toolkit")).lower()
        for account in connected_summary.get("accounts", [])
        if str(account.get("status")).upper() in {"ACTIVE", "ENABLED"}
    }
    missing_toolkits = [platform.lower() for platform in chosen_platforms if platform.lower() not in active_toolkits]
    task_status = "needs_composio_api_key"
    if composio_configured:
        task_status = "ready_for_review" if not missing_toolkits else "needs_connected_channel"
    plan_item = None
    for item in source.get("calendar", []):
        if item_id and item.get("id") == item_id:
            plan_item = item
            break
    if plan_item is None and source.get("calendar"):
        plan_item = source["calendar"][0]
    platform_payloads = {}
    for platform in chosen_platforms:
        platform_payloads[platform] = {
            "title": (upload or {}).get("file_name") or (plan_item or {}).get("title") or "CreatorOS post",
            "caption": (plan_item or {}).get("caption") or prompt.strip(),
            "script": (plan_item or {}).get("script"),
            "hashtags": (plan_item or {}).get("hashtags") or [],
            "file_ref": (upload or {}).get("file_ref"),
            "mime_type": (upload or {}).get("mime_type"),
        }
    task = {
        "id": _short_id("task", prompt or (upload or {}).get("file_name", "")),
        "action_type": action_type or "publish",
        "status": task_status,
        "platforms": chosen_platforms,
        "publish_at": publish_at or "needs_time",
        "prompt": prompt.strip(),
        "upload": upload or None,
        "plan_item": plan_item,
        "platform_payloads": platform_payloads,
        "execution_steps": [
            "human_review",
            "validate_platform_connections",
            "execute_with_composio",
            "record_result_in_anna_storage",
        ],
        "review_required": bool(require_review),
        "composio": {
            "configured": composio_configured,
            "base_url": COMPOSIO_BASE_URL,
            "execution_state": "not_executed",
            "candidate_toolkits": [platform.lower() for platform in chosen_platforms],
            "connected_toolkits": sorted(active_toolkits),
            "missing_toolkits": missing_toolkits,
            "note": (
                "Task is prepared for human review."
                if task_status == "ready_for_review"
                else (
                    f"Connect these channels before execution: {', '.join(missing_toolkits)}."
                    if task_status == "needs_connected_channel"
                    else "Add a Composio API key before Composio execution."
                )
            ),
        },
        "created_at": int(time.time()),
    }
    state = _load_state()
    tasks = [entry for entry in state.get("tasks", []) if entry.get("id") != task["id"]]
    tasks.append(task)
    state["tasks"] = tasks[-100:]
    _save_state(state)
    return task


def action_execute_task(
    task: dict[str, Any] | None = None,
    task_id: str = "",
    user_id: str = "creatoros-user",
    approved: bool = False,
    live_execute: bool = False,
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    state = _load_state()
    if not task and task_id:
        task = next((entry for entry in state.get("tasks", []) if entry.get("id") == task_id), None)
    if not isinstance(task, dict):
        return {
            "status": "missing_task",
            "execution_state": "not_executed",
            "note": "Select a scheduled action before executing.",
        }

    task = dict(task)
    execution_record: dict[str, Any] = {
        "requested_at": int(time.time()),
        "live_execute": bool(live_execute),
        "results": [],
    }

    if not approved:
        task["status"] = "needs_user_approval"
        task["execution"] = {
            **execution_record,
            "state": "blocked",
            "note": "Approve this task before any external publishing call.",
        }
        return {"status": task["status"], "execution_state": "blocked", "task": task, "note": task["execution"]["note"]}

    composio_key = _composio_api_key(composio_api_key)
    if not composio_key:
        task["status"] = "needs_composio_api_key"
        task["execution"] = {
            **execution_record,
            "state": "blocked",
            "note": "Add a Composio API key before executing social actions.",
        }
        return {"status": task["status"], "execution_state": "blocked", "task": task, "note": task["execution"]["note"]}

    chosen_platforms = _normalize_platforms(task.get("platforms") or [])
    toolkit_slugs = [platform.lower() for platform in chosen_platforms]
    connected_summary = _list_connected_accounts(composio_key, toolkit_slugs, user_id=user_id)
    active_accounts = _active_account_by_toolkit(connected_summary.get("accounts", []))
    missing_toolkits = [toolkit for toolkit in toolkit_slugs if toolkit not in active_accounts]
    if missing_toolkits:
        task["status"] = "needs_connected_channel"
        task["composio"] = {
            **(task.get("composio") or {}),
            "execution_state": "blocked",
            "connected_toolkits": sorted(active_accounts.keys()),
            "missing_toolkits": missing_toolkits,
            "note": f"Connect these channels before execution: {', '.join(missing_toolkits)}.",
        }
        task["execution"] = {
            **execution_record,
            "state": "blocked",
            "connected_accounts": connected_summary,
        }
        return {"status": task["status"], "execution_state": "blocked", "task": task, "note": task["composio"]["note"]}

    if _future_publish_wait(str(task.get("publish_at") or "")):
        task["status"] = "scheduled_waiting"
        task["execution"] = {
            **execution_record,
            "state": "waiting",
            "note": "This task has a future publish time. Keep it queued and execute when the scheduled time arrives.",
        }
        _persist_task(state, task)
        return {"status": task["status"], "execution_state": "waiting", "task": task, "note": task["execution"]["note"]}

    media_url = _task_media_url(task)
    if not media_url:
        task["status"] = "needs_public_media_url"
        task["execution"] = {
            **execution_record,
            "state": "blocked",
            "note": "A public media URL is required before Composio can upload to YouTube, Instagram, or TikTok. Host the upload through Anna Files or paste a provider-accessible URL.",
        }
        _persist_task(state, task)
        return {"status": task["status"], "execution_state": "blocked", "task": task, "note": task["execution"]["note"]}

    execution_plan = []
    for platform in chosen_platforms:
        toolkit = platform.lower()
        tool_slug = PLATFORM_EXECUTION_TOOLS.get(toolkit, [])[0]
        execution_plan.append(
            {
                "platform": platform,
                "toolkit": toolkit,
                "tool_slug": tool_slug,
                "connected_account_id": active_accounts[toolkit].get("id"),
            }
        )

    if not live_execute:
        task["status"] = "ready_for_composio_execute"
        task["execution"] = {
            **execution_record,
            "state": "ready",
            "execution_plan": execution_plan,
            "note": "All safety gates passed. Set live_execute=true after final user confirmation to call Composio.",
        }
        _persist_task(state, task)
        return {"status": task["status"], "execution_state": "ready", "task": task, "execution_plan": execution_plan}

    results = []
    any_failed = False
    for step in execution_plan:
        platform = step["platform"]
        tool_slug = step["tool_slug"]
        if not tool_slug:
            any_failed = True
            results.append({"platform": platform, "status": "missing_tool", "error": "No Composio publish/upload tool is configured."})
            continue
        payload = {
            "user_id": user_id or "creatoros-user",
            "connected_account_id": step["connected_account_id"],
            "text": _task_execution_text(task, platform, media_url),
        }
        response = _post_json_headers(
            f"{COMPOSIO_BASE_URL}/tools/execute/{urllib.parse.quote(tool_slug)}",
            payload,
            {"x-api-key": composio_key},
            timeout=60,
        )
        body = response.get("response") if response.get("ok") else None
        successful = bool(response.get("ok") and (body or {}).get("successful", True))
        if not successful:
            any_failed = True
        results.append(
            {
                "platform": platform,
                "tool_slug": tool_slug,
                "status": "executed" if successful else "execution_error",
                "status_code": response.get("status_code"),
                "log_id": (body or {}).get("log_id") if isinstance(body, dict) else None,
                "data": (body or {}).get("data") if isinstance(body, dict) else None,
                "error": response.get("error") or ((body or {}).get("error") if isinstance(body, dict) else None),
            }
        )

    task["status"] = "execution_error" if any_failed else "executed"
    task["composio"] = {
        **(task.get("composio") or {}),
        "execution_state": task["status"],
        "missing_toolkits": [],
    }
    task["execution"] = {
        **execution_record,
        "state": task["status"],
        "execution_plan": execution_plan,
        "results": results,
        "note": "Composio execution finished." if not any_failed else "At least one Composio execution failed; inspect the result details.",
    }
    _persist_task(state, task)
    return {"status": task["status"], "execution_state": task["execution"]["state"], "task": task, "results": results}


def _persist_task(state: dict[str, Any], task: dict[str, Any]) -> None:
    tasks = [entry for entry in state.get("tasks", []) if entry.get("id") != task.get("id")]
    tasks.append(task)
    state["tasks"] = tasks[-100:]
    _save_state(state)


def action_agent_status(
    plan: dict[str, Any] | None = None,
    uploads: list[dict[str, Any]] | None = None,
    tasks: list[dict[str, Any]] | None = None,
    connections: list[dict[str, Any]] | None = None,
    inactive_connections: list[dict[str, Any]] | None = None,
    approved_ids: list[str] | None = None,
    composio_api_key: str = "",
    **_: Any,
) -> dict[str, Any]:
    state = _load_state()
    composio_configured = bool(_composio_api_key(composio_api_key))
    source = plan or state.get("last_plan") or {}
    uploads = uploads if uploads is not None else state.get("uploads", [])
    tasks = tasks if tasks is not None else state.get("tasks", [])
    connections = connections if connections is not None else state.get("connections", [])
    inactive_connections = inactive_connections or []
    approved_ids = approved_ids or []
    queued = [task for task in tasks if task.get("status") in EXECUTION_WAITING_STATUSES]
    active_count = sum(1 for connection in (connections or []) if _is_active_connection(connection))
    reconnect_count = len(inactive_connections) + sum(1 for connection in (connections or []) if not _is_active_connection(connection))
    return {
        "campaign": (source.get("strategy") or {}).get("campaign_name") or "No active campaign",
        "plan_items": len(source.get("calendar", [])),
        "approved_items": len(approved_ids),
        "uploads": len(uploads or []),
        "connected_channels": active_count,
        "channels_need_reconnect": reconnect_count,
        "tasks_total": len(tasks or []),
        "tasks_waiting": len(queued),
        "composio_configured": composio_configured,
        "video_provider_ready": False,
        "health": {
            "planner": "ready",
            "storage": "ready",
            "composio": "configured" if composio_configured else "needs_composio_api_key",
            "publishing": "review_gated",
        },
        "queue": [
            {
                "id": task.get("id"),
                "status": task.get("status"),
                "platforms": task.get("platforms", []),
                "publish_at": task.get("publish_at"),
            }
            for task in (tasks or [])[:5]
        ],
        "next_actions": [
            "Generate or refine a campaign plan" if not source.get("calendar") else "Review planned assets",
            "Upload source media" if not uploads else "Choose an uploaded asset for publishing",
            "Connect social accounts in Composio before live publishing",
        ],
    }


def action_video_job(
    plan: dict[str, Any] | None = None,
    item_id: str = "",
    video_api_key: str = "",
    video_api_endpoint: str = "",
    **_: Any,
) -> dict[str, Any]:
    source = plan or _load_state().get("last_plan") or {}
    item = _first_item(source, item_id)
    payload = _video_request_payload(source, item)
    if not video_api_key:
        return {
            "status": "needs_video_api_key",
            "provider_configured": False,
            "brief": payload,
            "note": "Add a user video provider API key in the app before submitting generation.",
        }
    if not video_api_endpoint:
        return {
            "status": "ready_for_provider",
            "provider_configured": True,
            "brief": payload,
            "note": "No provider endpoint is configured, so the app prepared a sanitized video generation packet.",
        }

    safe_endpoint, endpoint_error = _validate_public_https_endpoint(video_api_endpoint)
    if not safe_endpoint:
        return {
            "status": "provider_endpoint_blocked",
            "provider_configured": True,
            "brief": payload,
            "error": endpoint_error,
            "note": "Use a public HTTPS video provider endpoint. Localhost, private network, and plain HTTP endpoints are blocked.",
        }

    result = _post_json(video_api_endpoint, video_api_key, payload)
    if result.get("ok"):
        return {
            "status": "submitted",
            "provider_configured": True,
            "brief": payload,
            "provider_response": result.get("response"),
            "status_code": result.get("status_code"),
        }
    return {
        "status": "provider_error",
        "provider_configured": True,
        "brief": payload,
        "error": result.get("error"),
        "status_code": result.get("status_code"),
    }


def tool_creatoros_plan(action: str, **kwargs: Any) -> dict[str, Any]:
    actions = {
        "plan": action_plan,
        "content_pack": action_content_pack,
        "analytics": action_analytics,
        "integrations_status": action_integrations_status,
        "connect_channel": action_connect_channel,
        "list_media_connections": action_list_media_connections,
        "upload_asset": action_upload_asset,
        "schedule_action": action_schedule_action,
        "execute_task": action_execute_task,
        "agent_status": action_agent_status,
        "video_job": action_video_job,
        "save_state": lambda state=None, **_: _save_state(state or {}),
        "get_state": lambda **_: _load_state(),
    }
    fn = actions.get(action)
    if not fn:
        raise ValueError(f"unknown action: {action}")
    return fn(**kwargs)


TOOL_DISPATCH = {"creatoros_plan": tool_creatoros_plan}


def make_response(req_id: Any, result: Any = None, error: dict[str, Any] | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        message["error"] = error
    else:
        message["result"] = result
    return message


def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    req_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}
    if method == "initialize":
        proto = params.get("protocolVersion") or PROTOCOL_VERSION_V2
        if proto not in ("1.1", PROTOCOL_VERSION_V2):
            proto = PROTOCOL_VERSION_V2
        return make_response(
            req_id,
            {
                "protocolVersion": proto,
                "serverInfo": {"name": MANIFEST["display_name"], "version": MANIFEST["version"]},
                "client_capabilities": {},
                "capabilities": {},
            },
        )
    if method == "describe":
        return make_response(req_id, MANIFEST)
    if method == "health":
        return make_response(req_id, {"status": "ok", "state_file": str(STATE_FILE)})
    if method == "shutdown":
        return make_response(req_id, {"ok": True})
    if method != "invoke":
        return make_response(req_id, error={"code": -32601, "message": f"method not found: {method}"})

    tool_name = params.get("tool")
    args = params.get("arguments") or {}
    fn = TOOL_DISPATCH.get(tool_name)
    if fn is None:
        return make_response(req_id, error={"code": -32601, "message": f"unknown tool: {tool_name}"})
    try:
        payload = fn(**args)
        return make_response(req_id, {"success": True, "data": payload, "tool": tool_name})
    except Exception as exc:  # noqa: BLE001
        return make_response(req_id, {"success": False, "error": f"{type(exc).__name__}: {exc}", "tool": tool_name})


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    print("[creatoros-planner] ready", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            send(make_response(None, error={"code": -32700, "message": f"parse error: {exc}"}))
            continue
        send(handle_request(request))


if __name__ == "__main__":
    main()
