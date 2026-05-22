"""Hermes platform plugin entrypoint for the official DingTalk connector.

Hermes already owns a DingTalk gateway adapter.  The official OpenClaw
connector and that adapter use the same DingTalk Stream registration flow, so
this plugin keeps the channel implementation in one place and contributes the
official defaults that differ from a bare Hermes DingTalk config.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

PLATFORM_NAME = "dingtalk"
OFFICIAL_CARD_TEMPLATE_ID = "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema"
DINGTALK_API = "https://api.dingtalk.com"
DINGTALK_OAPI = "https://oapi.dingtalk.com"
MAX_MEDIA_UPLOAD_BYTES = 20 * 1024 * 1024
IMAGE_EXTENSIONS = frozenset({".gif", ".jpeg", ".jpg", ".png", ".webp"})
_OFFICIAL_ADAPTER_CLASS: type | None = None
CHATBOT_ID_PATTERN = re.compile(r"\$:LWCP_v1:\$[A-Za-z0-9+/=]+")
logger = logging.getLogger(__name__)


DINGTALK_OFFICIAL_SEND_SCHEMA: dict[str, Any] = {
    "name": "dingtalk_official_send",
    "description": (
        "Send a proactive DingTalk robot message through the official robot "
        "OpenAPI to a DingTalk user or group. Use this for DingTalk delivery "
        "that is not a reply to the current inbound message, and for local "
        "image or file attachments."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "target_type": {
                "type": "string",
                "enum": ["user", "group"],
                "description": "Whether target_id is a DingTalk staff_id or group open conversation ID.",
            },
            "target_id": {
                "type": "string",
                "description": "DingTalk staff_id for user sends or group openConversationId.",
            },
            "content": {
                "type": "string",
                "description": "Optional text or Markdown content to send before any attachment.",
            },
            "format": {
                "type": "string",
                "enum": ["auto", "text", "markdown"],
                "description": "Content message format. Default auto.",
            },
            "title": {
                "type": "string",
                "description": "Markdown title when format resolves to markdown.",
            },
            "file_path": {
                "type": "string",
                "description": "Optional local image or file path to upload and send.",
            },
            "file_kind": {
                "type": "string",
                "enum": ["auto", "image", "file"],
                "description": "Attachment kind. Default auto by file extension.",
            },
            "at_accounts": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional configured DingTalk bot account IDs or aliases "
                    "to @. Resolved through DINGTALK_BOT_MENTIONS or "
                    "platforms.dingtalk.extra.bot_mentions."
                ),
            },
            "at_dingtalk_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional encrypted DingTalk chatbotUserId values to @.",
            },
            "at_user_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional DingTalk staff/user IDs to visibly @ in text content.",
            },
            "at_all": {
                "type": "boolean",
                "description": "Append @all to text content when supported by the target conversation.",
            },
        },
        "required": ["target_type", "target_id"],
        "additionalProperties": False,
    },
}


DINGTALK_OFFICIAL_MENTIONS_SCHEMA: dict[str, Any] = {
    "name": "dingtalk_official_mentions",
    "description": (
        "List DingTalk bot mention aliases configured for multi-bot handoff "
        "and report which entries have chatbotUserId values ready."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
}


def _load_hermes_dingtalk() -> tuple[type, Callable[[], bool]]:
    """Load the Hermes adapter lazily so plugin metadata can be inspected alone."""
    from gateway.platforms.dingtalk import DingTalkAdapter, check_dingtalk_requirements

    return DingTalkAdapter, check_dingtalk_requirements


def _extra(config: Any) -> dict[str, Any]:
    return dict(getattr(config, "extra", {}) or {})


def _has_credentials(config: Any) -> bool:
    extra = _extra(config)
    return bool(
        (extra.get("client_id") or os.getenv("DINGTALK_CLIENT_ID"))
        and (extra.get("client_secret") or os.getenv("DINGTALK_CLIENT_SECRET"))
    )


def _apply_official_defaults(config: Any) -> Any:
    """Set official defaults while preserving user-provided Hermes extras."""
    extra = _extra(config)
    account_id = os.getenv("DINGTALK_ACCOUNT_ID", "").strip()
    if account_id:
        extra.setdefault("account_id", account_id)

    extra.setdefault(
        "card_template_id",
        os.getenv("DINGTALK_CARD_TEMPLATE_ID") or OFFICIAL_CARD_TEMPLATE_ID,
    )

    robot_code = os.getenv("DINGTALK_ROBOT_CODE") or extra.get("client_id")
    if robot_code:
        extra.setdefault("robot_code", robot_code)

    if "suppress_intermediate" not in extra:
        env_value = os.getenv("DINGTALK_SUPPRESS_INTERMEDIATE", "").strip()
        show_activity = os.getenv("DINGTALK_SHOW_ACTIVITY", "").strip()
        extra["suppress_intermediate"] = (
            not _boolish(show_activity, default=False)
            if show_activity
            else _boolish(env_value, default=True)
        )

    config.extra = extra
    return config


def _send_result(*, success: bool, message_id: str | None = None, error: str | None = None, raw_response: Any = None):
    from gateway.platforms.base import SendResult

    return SendResult(
        success=success,
        message_id=message_id,
        error=error,
        raw_response=raw_response,
    )


def _parse_proactive_target(chat_id: str | None) -> dict[str, str] | None:
    """Parse explicit Hermes chat IDs for non-session DingTalk sends."""
    raw = str(chat_id or "").strip()
    lowered = raw.lower()
    for prefix, target_type in (("user:", "user"), ("group:", "group")):
        if lowered.startswith(prefix):
            target_id = raw[len(prefix) :].strip()
            if target_id:
                return {"type": target_type, "id": target_id}
    return None


def _metadata_target(metadata: dict[str, Any] | None) -> dict[str, str] | None:
    if not metadata:
        return None
    raw = metadata.get("dingtalk_target") or metadata.get("proactive_target")
    if isinstance(raw, str):
        return _parse_proactive_target(raw)
    target_type = str(metadata.get("dingtalk_target_type") or "").strip().lower()
    target_id = str(metadata.get("dingtalk_target_id") or "").strip()
    if target_type in {"user", "group"} and target_id:
        return {"type": target_type, "id": target_id}
    return None


def _metadata_session_webhook(metadata: dict[str, Any] | None) -> str:
    if not metadata:
        return ""
    return str(metadata.get("session_webhook") or "").strip()


def _metadata_force_send(metadata: dict[str, Any] | None) -> bool:
    if not metadata:
        return False
    return any(
        _boolish(metadata.get(key), default=False)
        for key in (
            "dingtalk_force_send",
            "force_send",
            "deliver_intermediate",
            "show_activity",
        )
    )


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _boolish(value: Any, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if not text:
        return default
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _metadata_at_options(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        "at_accounts": (
            metadata.get("dingtalk_at_accounts")
            or metadata.get("at_accounts")
            or metadata.get("at_bot_accounts")
        ),
        "at_dingtalk_ids": (
            metadata.get("dingtalk_at_dingtalk_ids")
            or metadata.get("at_dingtalk_ids")
        ),
        "at_user_ids": metadata.get("dingtalk_at_user_ids") or metadata.get("at_user_ids"),
        "at_all": _truthy(metadata.get("dingtalk_at_all") or metadata.get("at_all")),
    }


def _message_context_target(message: Any, chat_id: str) -> dict[str, str] | None:
    if message is None:
        return None
    if str(getattr(message, "conversation_type", "1")) == "2":
        conversation_id = str(getattr(message, "conversation_id", "") or chat_id).strip()
        return {"type": "group", "id": conversation_id} if conversation_id else None

    sender_staff_id = str(getattr(message, "sender_staff_id", "") or "").strip()
    return {"type": "user", "id": sender_staff_id} if sender_staff_id else None


def _looks_like_markdown(content: str) -> bool:
    return bool(
        "\n" in content
        or any(marker in content for marker in ("#", "*", "_", "`", "[", "]", ">"))
    )


def _markdown_title(content: str, title: str | None = None) -> str:
    if title and title.strip():
        return title.strip()[:100]
    first_line = next((line.strip(" #*>-_") for line in content.splitlines() if line.strip()), "")
    return first_line[:20] or "Hermes"


def _build_message_payload(
    msg_type: str,
    content: str,
    *,
    title: str | None = None,
    file_name: str | None = None,
) -> dict[str, str]:
    """Build DingTalk's normal robot-message template payload."""
    normalized = msg_type.strip().lower()
    if normalized == "markdown":
        msg_key = "sampleMarkdown"
        msg_param = {"title": _markdown_title(content, title), "text": content}
    elif normalized == "image":
        msg_key = "sampleImageMsg"
        msg_param = {"photoURL": content}
    elif normalized == "file":
        resolved_name = file_name or "attachment"
        msg_key = "sampleFile"
        msg_param = {
            "mediaId": content,
            "fileName": resolved_name,
            "fileType": Path(resolved_name).suffix.lstrip(".") or "file",
        }
    else:
        msg_key = "sampleText"
        msg_param = {"content": content}
    return {"msgKey": msg_key, "msgParam": json.dumps(msg_param, ensure_ascii=False)}


def _session_image_markdown(uploaded: dict[str, str], caption: str | None = None) -> str:
    """Build the session-webhook Markdown image form used by the connector."""
    image_markdown = f"![image]({uploaded['media_id']})"
    return f"{caption}\n\n{image_markdown}" if caption else image_markdown


def _coerce_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = None
            if isinstance(parsed, list):
                return _coerce_string_list(parsed)
        return [part.strip() for part in re.split(r"[\n,]", raw) if part.strip()]
    text = str(value).strip()
    return [text] if text else []


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _load_jsonish(raw: Any) -> Any:
    if not isinstance(raw, str):
        return raw
    text = raw.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return raw


def _bot_entry_from_mapping(account_id: str, data: Any) -> dict[str, Any]:
    item = data if isinstance(data, dict) else {"chatbotUserId": data}
    resolved_id = str(
        item.get("account_id")
        or item.get("accountId")
        or item.get("id")
        or account_id
        or ""
    ).strip()
    name = str(item.get("name") or item.get("label") or "").strip()
    chatbot_user_id = str(
        item.get("chatbot_user_id")
        or item.get("chatbotUserId")
        or item.get("dingtalk_id")
        or item.get("dingtalkId")
        or ""
    ).strip()
    agent_ids = _coerce_string_list(item.get("agent_ids") or item.get("agentIds"))
    aliases = _coerce_string_list(item.get("aliases") or item.get("alias"))

    alias_candidates = [resolved_id, name, *agent_ids, *aliases]
    return {
        "account_id": resolved_id,
        "name": name,
        "chatbot_user_id": chatbot_user_id,
        "agent_ids": _dedupe_strings(agent_ids),
        "aliases": _dedupe_strings(alias_candidates),
    }


def _entries_from_openclaw_shape(raw: dict[str, Any]) -> list[dict[str, Any]]:
    root = raw.get("channels", {}).get("dingtalk-connector")
    if not isinstance(root, dict):
        root = raw
    accounts = root.get("accounts")
    if not isinstance(accounts, dict):
        return []

    entries_by_account = {
        str(account_id): _bot_entry_from_mapping(str(account_id), account)
        for account_id, account in accounts.items()
        if str(account_id).strip()
    }

    bindings = raw.get("bindings")
    if not isinstance(bindings, list):
        bindings = root.get("bindings")
    if isinstance(bindings, list):
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            match = binding.get("match")
            if not isinstance(match, dict):
                continue
            if match.get("channel") and match.get("channel") != "dingtalk-connector":
                continue
            account_id = str(match.get("accountId") or match.get("account_id") or "").strip()
            agent_id = str(binding.get("agentId") or binding.get("agent_id") or "").strip()
            entry = entries_by_account.get(account_id)
            if entry and agent_id:
                entry["agent_ids"] = _dedupe_strings([*entry["agent_ids"], agent_id])
                entry["aliases"] = _dedupe_strings([*entry["aliases"], agent_id])

    return list(entries_by_account.values())


def _normalize_bot_mention_entries(raw: Any) -> list[dict[str, Any]]:
    data = _load_jsonish(raw)
    if data is None:
        return []
    if isinstance(data, dict) and (
        "accounts" in data or "channels" in data
    ):
        return _entries_from_openclaw_shape(data)
    if isinstance(data, dict):
        return [
            _bot_entry_from_mapping(str(account_id), item)
            for account_id, item in data.items()
            if str(account_id).strip()
        ]
    if isinstance(data, list):
        entries = []
        for item in data:
            if not isinstance(item, dict):
                continue
            account_id = str(
                item.get("account_id") or item.get("accountId") or item.get("id") or ""
            ).strip()
            if account_id:
                entries.append(_bot_entry_from_mapping(account_id, item))
        return entries
    return []


def _configured_bot_mentions(config_or_extra: Any = None) -> list[dict[str, Any]]:
    extra = config_or_extra if isinstance(config_or_extra, dict) else _extra(config_or_extra)
    sources: list[Any] = []

    env_mentions = os.getenv("DINGTALK_BOT_MENTIONS", "").strip()
    if env_mentions:
        sources.append(env_mentions)

    for key in ("bot_mentions", "botMentions"):
        if key in extra:
            sources.append(extra.get(key))

    if "accounts" in extra:
        sources.append({"accounts": extra.get("accounts"), "bindings": extra.get("bindings")})

    merged: list[dict[str, Any]] = []
    for source in sources:
        merged.extend(_normalize_bot_mention_entries(source))
    return merged


def _bot_alias_map(config_or_extra: Any = None) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    for entry in _configured_bot_mentions(config_or_extra):
        chatbot_user_id = str(entry.get("chatbot_user_id") or "").strip()
        if not chatbot_user_id:
            continue
        for alias in _coerce_string_list(entry.get("aliases")):
            alias_map.setdefault(alias.lower(), chatbot_user_id)
    return alias_map


def _resolve_at_accounts(
    at_accounts: Any,
    config_or_extra: Any = None,
) -> tuple[list[str], list[str]]:
    if not at_accounts:
        return [], []
    alias_map = _bot_alias_map(config_or_extra)
    resolved: list[str] = []
    missing: list[str] = []
    for account in _coerce_string_list(at_accounts):
        chatbot_user_id = alias_map.get(account.lower())
        if chatbot_user_id:
            resolved.append(chatbot_user_id)
        else:
            missing.append(account)
    return _dedupe_strings(resolved), missing


def _substitute_bot_mentions(
    text: str,
    config_or_extra: Any = None,
) -> tuple[str, list[str]]:
    if not text:
        return text or "", []
    alias_map = _bot_alias_map(config_or_extra)
    if not alias_map:
        return text, _dedupe_strings(CHATBOT_ID_PATTERN.findall(text))

    injected: list[str] = []
    out = text
    for alias in sorted(alias_map, key=len, reverse=True):
        chatbot_user_id = alias_map[alias]
        pattern = re.compile(
            rf"@{re.escape(alias)}(?![A-Za-z0-9_\u4e00-\u9fff-])",
            re.IGNORECASE,
        )

        def replace(_match: re.Match[str]) -> str:
            injected.append(chatbot_user_id)
            return f"@{chatbot_user_id}"

        out = pattern.sub(replace, out)

    injected.extend(CHATBOT_ID_PATTERN.findall(out))
    return out, _dedupe_strings(injected)


def _prepare_multi_bot_mentions(
    content: str,
    *,
    config_or_extra: Any = None,
    at_accounts: Any = None,
    at_dingtalk_ids: Any = None,
) -> dict[str, Any]:
    resolved_accounts, missing_accounts = _resolve_at_accounts(at_accounts, config_or_extra)
    substituted, injected_ids = _substitute_bot_mentions(content, config_or_extra)
    explicit_ids = _coerce_string_list(at_dingtalk_ids)
    merged_ids = _dedupe_strings([*explicit_ids, *resolved_accounts, *injected_ids])

    final_content = substituted
    for chatbot_user_id in _dedupe_strings([*explicit_ids, *resolved_accounts]):
        marker = f"@{chatbot_user_id}"
        if marker not in final_content:
            final_content = f"{final_content} {marker}".strip()

    return {
        "content": final_content,
        "at_dingtalk_ids": merged_ids,
        "missing_accounts": missing_accounts,
    }


def _append_visible_mentions(
    content: str,
    *,
    at_dingtalk_ids: Any = None,
    at_user_ids: Any = None,
    at_all: bool = False,
) -> str:
    final_content = content or ""
    for mention_id in _dedupe_strings(
        [*_coerce_string_list(at_dingtalk_ids), *_coerce_string_list(at_user_ids)]
    ):
        marker = f"@{mention_id}"
        if marker not in final_content:
            final_content = f"{final_content} {marker}".strip()
    if at_all and "@all" not in final_content:
        final_content = f"{final_content} @all".strip()
    return final_content


def _display_bot_mention_entry(entry: dict[str, Any]) -> dict[str, Any]:
    account_id = str(entry.get("account_id") or "").strip()
    chatbot_user_id = str(entry.get("chatbot_user_id") or "").strip()
    aliases = _coerce_string_list(entry.get("aliases"))
    return {
        "account_id": account_id,
        "name": str(entry.get("name") or account_id).strip(),
        "agent_ids": _coerce_string_list(entry.get("agent_ids")),
        "aliases": aliases,
        "chatbotUserId": chatbot_user_id or None,
        "mentionReady": bool(chatbot_user_id),
    }


def _bot_mentions_report(config_or_extra: Any = None) -> dict[str, Any]:
    entries = [_display_bot_mention_entry(entry) for entry in _configured_bot_mentions(config_or_extra)]
    ready = [entry for entry in entries if entry["mentionReady"]]
    missing = [entry["account_id"] for entry in entries if not entry["mentionReady"]]

    report_lines = [
        f"[BotIdentity] configured={len(entries)} ready={len(ready)} missing={len(missing)}"
    ]
    if ready:
        report_lines.append(
            "[OK] Ready: "
            + ", ".join(
                f"{entry['account_id']}({', '.join(entry['aliases'])})"
                for entry in ready
            )
        )
    if missing:
        report_lines.append(
            "[WARN] Missing chatbotUserId: "
            + ", ".join(missing)
            + ". Send a DingTalk message to each bot and copy the [BotIdentity] log value."
        )
    if not entries:
        report_lines.append(
            "[INFO] No bot mention aliases configured. Set DINGTALK_BOT_MENTIONS "
            "or platforms.dingtalk.extra.bot_mentions."
        )

    return {
        "ready": bool(entries) and not missing,
        "totalAccounts": len(entries),
        "readyAccounts": len(ready),
        "missingChatbotUserId": missing,
        "accounts": entries,
        "report": "\n".join(report_lines),
    }


def _response_json(response: Any) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}


def _response_excerpt(response: Any) -> str:
    body = str(getattr(response, "text", "") or "").strip()
    return body[:200] or "empty response"


def _proactive_send_error(response: Any) -> str:
    payload = _response_json(response)
    code = str(payload.get("code") or "").strip()
    message = str(payload.get("message") or "").strip()
    excerpt = _response_excerpt(response)

    if code == "staffId.notExisted":
        return (
            "DingTalk proactive user send failed: target_id must be a DingTalk "
            "staff_id available to this bot and organization; a Hermes sender_id "
            f"is not interchangeable. DingTalk response: {excerpt}"
        )
    if code == "resource.not.found" and ("robot" in message.lower() or "机器人" in message):
        return (
            "DingTalk proactive send failed: DingTalk did not find robotCode. "
            "Check DINGTALK_ROBOT_CODE or platforms.dingtalk.extra.robot_code, "
            "and verify that these credentials belong to a robot-enabled DingTalk "
            f"app. DingTalk response: {excerpt}"
        )
    return f"DingTalk proactive send failed: {excerpt}"


async def _api_access_token(http_client: Any, client_id: str, client_secret: str) -> str:
    response = await http_client.post(
        f"{DINGTALK_API}/v1.0/oauth2/accessToken",
        json={"appKey": client_id, "appSecret": client_secret},
        timeout=15.0,
    )
    payload = _response_json(response)
    token = str(payload.get("accessToken") or "").strip()
    if getattr(response, "status_code", 500) >= 300 or not token:
        raise RuntimeError(f"DingTalk access token request failed: {_response_excerpt(response)}")
    return token


async def _oapi_access_token(http_client: Any, client_id: str, client_secret: str) -> str:
    response = await http_client.get(
        f"{DINGTALK_OAPI}/gettoken",
        params={"appkey": client_id, "appsecret": client_secret},
        timeout=15.0,
    )
    payload = _response_json(response)
    token = str(payload.get("access_token") or "").strip()
    if (
        getattr(response, "status_code", 500) >= 300
        or payload.get("errcode") not in (0, "0", None)
        or not token
    ):
        raise RuntimeError(f"DingTalk OAPI token request failed: {_response_excerpt(response)}")
    return token


async def _upload_local_media(
    http_client: Any,
    client_id: str,
    client_secret: str,
    file_path: str,
    media_type: str,
) -> dict[str, str]:
    """Upload a local file through DingTalk OAPI media/upload."""
    path = Path(file_path).expanduser()
    if not path.is_file():
        raise RuntimeError(f"Local file does not exist: {path}")
    if path.stat().st_size > MAX_MEDIA_UPLOAD_BYTES:
        raise RuntimeError("DingTalk local media upload is limited to 20 MB in this plugin")

    upload_type = "image" if media_type == "image" else "file"
    token = await _oapi_access_token(http_client, client_id, client_secret)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with path.open("rb") as handle:
        response = await http_client.post(
            f"{DINGTALK_OAPI}/media/upload",
            params={"access_token": token, "type": upload_type},
            files={"media": (path.name, handle, content_type)},
            timeout=60.0,
        )
    payload = _response_json(response)
    media_id = str(payload.get("media_id") or "").strip()
    if getattr(response, "status_code", 500) >= 300 or not media_id:
        raise RuntimeError(f"DingTalk media upload failed: {_response_excerpt(response)}")
    clean_media_id = media_id[1:] if media_id.startswith("@") else media_id
    return {
        "media_id": media_id,
        "download_url": f"https://down.dingtalk.com/media/{clean_media_id}",
        "file_name": path.name,
    }


async def _send_proactive_payload(
    http_client: Any,
    *,
    client_id: str,
    client_secret: str,
    robot_code: str,
    target: dict[str, str],
    payload: dict[str, str],
) -> dict[str, Any]:
    token = await _api_access_token(http_client, client_id, client_secret)
    target_type = target.get("type")
    target_id = str(target.get("id") or "").strip()
    if target_type == "user":
        endpoint = f"{DINGTALK_API}/v1.0/robot/oToMessages/batchSend"
        target_body = {"userIds": [target_id]}
    elif target_type == "group":
        endpoint = f"{DINGTALK_API}/v1.0/robot/groupMessages/send"
        target_body = {"openConversationId": target_id}
    else:
        raise RuntimeError("DingTalk proactive target must be a user or group")
    if not target_id:
        raise RuntimeError("DingTalk proactive target ID is required")

    body = {"robotCode": robot_code or client_id, **target_body, **payload}
    response = await http_client.post(
        endpoint,
        json=body,
        headers={
            "x-acs-dingtalk-access-token": token,
            "Content-Type": "application/json",
        },
        timeout=15.0,
    )
    data = _response_json(response)
    if getattr(response, "status_code", 500) >= 300 or data.get("success") is False:
        raise RuntimeError(_proactive_send_error(response))
    return data


class _OfficialDingTalkMixin:
    """Official-connector send features layered onto Hermes DingTalk."""

    @property
    def SUPPORTS_MESSAGE_EDITING(self) -> bool:  # noqa: N802
        if self._official_suppress_intermediate():
            return False
        return bool(getattr(super(), "SUPPORTS_MESSAGE_EDITING", True))

    @property
    def REQUIRES_EDIT_FINALIZE(self) -> bool:  # noqa: N802
        if self._official_suppress_intermediate():
            return False
        return bool(getattr(super(), "REQUIRES_EDIT_FINALIZE", False))

    def _official_suppress_intermediate(self) -> bool:
        extra = _extra(getattr(self, "config", None))
        show_activity = os.getenv("DINGTALK_SHOW_ACTIVITY", "").strip()
        if show_activity:
            return not _boolish(show_activity, default=False)
        env_value = os.getenv("DINGTALK_SUPPRESS_INTERMEDIATE", "").strip()
        if env_value:
            return _boolish(env_value, default=True)
        return _boolish(extra.get("suppress_intermediate"), default=True)

    def _should_suppress_intermediate_send(
        self,
        chat_id: str,
        reply_to: str | None,
        metadata: dict[str, Any] | None,
    ) -> bool:
        if not self._official_suppress_intermediate():
            return False
        if reply_to is not None:
            return False
        if _metadata_force_send(metadata):
            return False
        if _metadata_target(metadata) or _parse_proactive_target(chat_id):
            return False
        return True

    def _official_account_id(self) -> str:
        extra = _extra(getattr(self, "config", None))
        return (
            str(extra.get("account_id") or "").strip()
            or os.getenv("DINGTALK_ACCOUNT_ID", "").strip()
            or str(getattr(self, "_robot_code", "") or "").strip()
            or str(getattr(self, "_client_id", "") or "").strip()
            or "dingtalk"
        )

    def _record_bot_identity(self, message: Any) -> None:
        chatbot_user_id = str(
            getattr(message, "chatbot_user_id", None)
            or getattr(message, "chatbotUserId", None)
            or ""
        ).strip()
        chatbot_corp_id = str(
            getattr(message, "chatbot_corp_id", None)
            or getattr(message, "chatbotCorpId", None)
            or ""
        ).strip()
        if not (chatbot_user_id or chatbot_corp_id):
            return

        identity = {
            "accountId": self._official_account_id(),
            "chatbotUserId": chatbot_user_id or None,
            "chatbotCorpId": chatbot_corp_id or None,
        }
        if getattr(self, "_official_last_bot_identity", None) == identity:
            return
        self._official_last_bot_identity = identity
        line = (
            f"[DingTalk:{identity['accountId']}] [BotIdentity] "
            f"accountId={identity['accountId']} "
            f"chatbotUserId={chatbot_user_id or 'N/A'} "
            f"chatbotCorpId={chatbot_corp_id or 'N/A'}"
        )
        logger.info(line)
        print(line, flush=True)

    async def _on_message(self, message: Any) -> None:
        self._record_bot_identity(message)
        await super()._on_message(message)

    def _official_target(self, chat_id: str, metadata: dict[str, Any] | None = None) -> dict[str, str] | None:
        explicit = _metadata_target(metadata) or _parse_proactive_target(chat_id)
        if explicit:
            return explicit
        return _message_context_target(self._message_contexts.get(chat_id), chat_id)

    async def _official_send_payload(self, target: dict[str, str], payload: dict[str, str]):
        if not self._http_client:
            return _send_result(success=False, error="HTTP client not initialized")
        try:
            raw = await _send_proactive_payload(
                self._http_client,
                client_id=self._client_id,
                client_secret=self._client_secret,
                robot_code=self._robot_code,
                target=target,
                payload=payload,
            )
        except Exception as exc:
            return _send_result(success=False, error=str(exc))
        message_id = str(raw.get("processQueryKey") or raw.get("messageId") or uuid4().hex[:12])
        return _send_result(success=True, message_id=message_id, raw_response=raw)

    async def _official_upload(self, file_path: str, media_type: str):
        if not self._http_client:
            raise RuntimeError("HTTP client not initialized")
        return await _upload_local_media(
            self._http_client,
            self._client_id,
            self._client_secret,
            file_path,
            media_type,
        )

    def _official_session_webhook(self, chat_id: str, metadata: dict[str, Any] | None = None) -> str:
        webhook = _metadata_session_webhook(metadata)
        if webhook:
            return webhook
        getter = getattr(self, "_get_valid_webhook", None)
        if not getter:
            return ""
        webhook_info = getter(chat_id)
        if not webhook_info:
            return ""
        return str(webhook_info[0] or "").strip()

    async def _official_session_token(self) -> str:
        token_getter = getattr(self, "_get_access_token", None)
        token = ""
        if token_getter:
            token = str(await token_getter() or "").strip()
        if token:
            return token
        if not self._http_client:
            raise RuntimeError("HTTP client not initialized")
        return await _api_access_token(self._http_client, self._client_id, self._client_secret)

    async def _official_send_session_media(
        self,
        chat_id: str,
        uploaded: dict[str, str],
        *,
        media_kind: str,
        file_name: str,
        metadata: dict[str, Any] | None = None,
    ):
        if not self._http_client:
            return _send_result(success=False, error="HTTP client not initialized")
        session_webhook = self._official_session_webhook(chat_id, metadata)
        if not session_webhook:
            return _send_result(
                success=False,
                error="No valid DingTalk session_webhook available for file reply.",
            )

        try:
            token = await self._official_session_token()
            media_field = "image" if media_kind == "image" else "file"
            media_payload = {"media_id": uploaded["media_id"]}
            if media_kind == "file":
                media_payload.update(
                    {
                        "fileName": file_name,
                        "fileType": Path(file_name).suffix.lstrip(".") or "file",
                    }
                )
            response = await self._http_client.post(
                session_webhook,
                json={
                    "msgtype": media_kind,
                    media_field: media_payload,
                },
                headers={
                    "x-acs-dingtalk-access-token": token,
                    "Content-Type": "application/json",
                },
                timeout=15.0,
            )
            data = _response_json(response)
            if getattr(response, "status_code", 500) >= 300 or data.get("success") is False:
                return _send_result(
                    success=False,
                    error=f"DingTalk session {media_kind} send failed: {_response_excerpt(response)}",
                    raw_response=data,
                )
        except Exception as exc:
            return _send_result(success=False, error=str(exc))

        return _send_result(
            success=True,
            message_id=str(data.get("processQueryKey") or data.get("messageId") or uuid4().hex[:12]),
            raw_response=data,
        )

    async def _official_send_session_text(
        self,
        chat_id: str,
        content: str,
        *,
        at_dingtalk_ids: list[str] | None = None,
        at_user_ids: list[str] | None = None,
        at_all: bool = False,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        if not self._http_client:
            return _send_result(success=False, error="HTTP client not initialized")
        session_webhook = self._official_session_webhook(chat_id, metadata)
        if not session_webhook:
            return _send_result(
                success=False,
                error="No valid DingTalk session_webhook available for text reply.",
            )

        close_cards = getattr(self, "_close_streaming_siblings", None)
        if close_cards:
            await close_cards(chat_id)

        normalizer = getattr(self, "_normalize_markdown", None)
        trimmed = content[: self.MAX_MESSAGE_LENGTH]
        normalized = normalizer(trimmed) if normalizer else trimmed
        payload: dict[str, Any] = {
            "msgtype": "markdown",
            "markdown": {"title": "Hermes", "text": normalized},
        }

        dingtalk_ids = _dedupe_strings(at_dingtalk_ids or [])
        user_ids = _dedupe_strings(at_user_ids or [])
        if dingtalk_ids or user_ids or at_all:
            payload["at"] = {
                **({"atUserIds": user_ids} if user_ids else {}),
                **({"atDingtalkIds": dingtalk_ids} if dingtalk_ids else {}),
                "isAtAll": bool(at_all),
            }

        headers = {"Content-Type": "application/json"}
        try:
            token = await self._official_session_token()
            if token:
                headers["x-acs-dingtalk-access-token"] = token
        except Exception:
            pass

        try:
            response = await self._http_client.post(
                session_webhook,
                json=payload,
                headers=headers,
                timeout=15.0,
            )
            data = _response_json(response)
            if getattr(response, "status_code", 500) >= 300 or data.get("success") is False:
                return _send_result(
                    success=False,
                    error=f"DingTalk session text send failed: {_response_excerpt(response)}",
                    raw_response=data,
                )
        except Exception as exc:
            return _send_result(success=False, error=str(exc))

        if reply_to is not None:
            done = getattr(self, "_fire_done_reaction", None)
            if done:
                done(chat_id)
        return _send_result(
            success=True,
            message_id=str(data.get("processQueryKey") or data.get("messageId") or uuid4().hex[:12]),
            raw_response=data,
        )

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        target = _metadata_target(metadata) or _parse_proactive_target(chat_id)
        if self._should_suppress_intermediate_send(chat_id, reply_to, metadata):
            logger.debug(
                "[%s] Suppressed DingTalk intermediate activity message for chat_id=%s",
                getattr(self, "name", "dingtalk"),
                chat_id,
            )
            return _send_result(
                success=True,
                raw_response={"suppressed": True, "reason": "intermediate_activity"},
            )

        at_options = _metadata_at_options(metadata)
        prepared = _prepare_multi_bot_mentions(
            content,
            config_or_extra=getattr(self, "config", None),
            at_accounts=at_options.get("at_accounts"),
            at_dingtalk_ids=at_options.get("at_dingtalk_ids"),
        )
        at_user_ids = _coerce_string_list(at_options.get("at_user_ids"))
        prepared_content = _append_visible_mentions(
            prepared["content"],
            at_dingtalk_ids=prepared["at_dingtalk_ids"],
            at_user_ids=at_user_ids,
            at_all=bool(at_options.get("at_all")),
        )
        if target:
            msg_type = "markdown" if _looks_like_markdown(content) else "text"
            return await self._official_send_payload(
                target,
                _build_message_payload(
                    msg_type,
                    prepared_content[: self.MAX_MESSAGE_LENGTH],
                    title=(metadata or {}).get("title"),
                ),
            )
        if (
            prepared["at_dingtalk_ids"]
            or at_user_ids
            or at_options.get("at_all")
        ):
            return await self._official_send_session_text(
                chat_id,
                prepared_content,
                at_dingtalk_ids=prepared["at_dingtalk_ids"],
                at_user_ids=at_user_ids,
                at_all=bool(at_options.get("at_all")),
                reply_to=reply_to,
                metadata=metadata,
            )
        return await super().send(chat_id, content, reply_to=reply_to, metadata=metadata)

    async def send_image_file(
        self,
        chat_id: str,
        image_path: str,
        caption: str | None = None,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ):
        explicit_target = _metadata_target(metadata) or _parse_proactive_target(chat_id)
        current_message = self._message_contexts.get(chat_id)
        target = explicit_target or _message_context_target(current_message, chat_id)
        if not target:
            return _send_result(
                success=False,
                error="Local DingTalk images need an inbound message context or user:/group: target.",
            )
        try:
            uploaded = await self._official_upload(image_path, "image")
        except Exception as exc:
            return _send_result(success=False, error=str(exc))
        if current_message is not None and not explicit_target:
            # The official connector renders local reply images through the
            # session Markdown form after OAPI upload. Proactive robot sends
            # still use sampleImageMsg below.
            return await self._official_send_session_text(
                chat_id,
                _session_image_markdown(uploaded, caption)[: self.MAX_MESSAGE_LENGTH],
                reply_to=reply_to,
                metadata=metadata,
            )
        if caption:
            caption_mentions = _prepare_multi_bot_mentions(
                caption,
                config_or_extra=getattr(self, "config", None),
            )
            caption_result = await self._official_send_payload(
                target,
                _build_message_payload(
                    "text",
                    caption_mentions["content"][: self.MAX_MESSAGE_LENGTH],
                ),
            )
            if not caption_result.success:
                return caption_result
        return await self._official_send_payload(
            target,
            _build_message_payload("image", uploaded["media_id"]),
        )

    async def send_document(
        self,
        chat_id: str,
        file_path: str,
        caption: str | None = None,
        file_name: str | None = None,
        reply_to: str | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ):
        explicit_target = _metadata_target(metadata) or _parse_proactive_target(chat_id)
        current_message = self._message_contexts.get(chat_id)
        target = explicit_target or _message_context_target(current_message, chat_id)
        if not target:
            return _send_result(
                success=False,
                error="Local DingTalk files need an inbound message context, session_webhook, or user:/group: target.",
            )
        try:
            uploaded = await self._official_upload(file_path, "file")
        except Exception as exc:
            return _send_result(success=False, error=str(exc))
        resolved_file_name = file_name or uploaded["file_name"]
        if current_message is not None and not explicit_target:
            if caption:
                caption_result = await self.send(
                    chat_id,
                    caption[: self.MAX_MESSAGE_LENGTH],
                    reply_to=reply_to,
                    metadata=metadata,
                )
                if not caption_result.success:
                    return caption_result
            session_result = await self._official_send_session_media(
                chat_id,
                uploaded,
                media_kind="file",
                file_name=resolved_file_name,
                metadata=metadata,
            )
            if session_result.success or "session_webhook" not in str(session_result.error):
                return session_result
        if caption:
            caption_mentions = _prepare_multi_bot_mentions(
                caption,
                config_or_extra=getattr(self, "config", None),
            )
            caption_result = await self._official_send_payload(
                target,
                _build_message_payload(
                    "text",
                    caption_mentions["content"][: self.MAX_MESSAGE_LENGTH],
                ),
            )
            if not caption_result.success:
                return caption_result
        return await self._official_send_payload(
            target,
            _build_message_payload(
                "file",
                uploaded["media_id"],
                file_name=resolved_file_name,
            ),
        )


def _official_adapter_class() -> type:
    global _OFFICIAL_ADAPTER_CLASS
    if _OFFICIAL_ADAPTER_CLASS is None:
        DingTalkAdapter, _ = _load_hermes_dingtalk()
        _OFFICIAL_ADAPTER_CLASS = type(
            "OfficialDingTalkAdapter",
            (_OfficialDingTalkMixin, DingTalkAdapter),
            {},
        )
    return _OFFICIAL_ADAPTER_CLASS


def _adapter_factory(config: Any) -> Any:
    return _official_adapter_class()(_apply_official_defaults(config))


def check_requirements() -> bool:
    """Check env credentials and the Hermes DingTalk dependency set."""
    try:
        _, check_dingtalk_requirements = _load_hermes_dingtalk()
        return bool(check_dingtalk_requirements())
    except Exception:
        return False


def validate_config(config: Any) -> bool:
    return _has_credentials(config)


def is_connected(config: Any) -> bool:
    return validate_config(config)


def _env_enablement() -> dict[str, Any] | None:
    client_id = os.getenv("DINGTALK_CLIENT_ID", "").strip()
    client_secret = os.getenv("DINGTALK_CLIENT_SECRET", "").strip()
    if not (client_id and client_secret):
        return None

    seed: dict[str, Any] = {
        "client_id": client_id,
        "client_secret": client_secret,
        "card_template_id": os.getenv("DINGTALK_CARD_TEMPLATE_ID")
        or OFFICIAL_CARD_TEMPLATE_ID,
    }

    robot_code = os.getenv("DINGTALK_ROBOT_CODE", "").strip()
    if robot_code:
        seed["robot_code"] = robot_code

    account_id = os.getenv("DINGTALK_ACCOUNT_ID", "").strip()
    if account_id:
        seed["account_id"] = account_id

    bot_mentions = os.getenv("DINGTALK_BOT_MENTIONS", "").strip()
    if bot_mentions:
        seed["bot_mentions"] = _load_jsonish(bot_mentions)

    home_channel = os.getenv("DINGTALK_HOME_CHANNEL", "").strip()
    if home_channel:
        seed["home_channel"] = {
            "chat_id": home_channel,
            "name": os.getenv("DINGTALK_HOME_CHANNEL_NAME", "Home"),
            "thread_id": os.getenv("DINGTALK_HOME_CHANNEL_THREAD_ID") or None,
        }
    return seed


def _apply_yaml_config(_yaml_cfg: dict[str, Any], platform_cfg: dict[str, Any]) -> dict[str, Any]:
    """Allow concise top-level DingTalk YAML to carry official card options."""
    extra: dict[str, Any] = {}
    for key in (
        "account_id",
        "accountId",
        "card_template_id",
        "robot_code",
        "bot_mentions",
        "botMentions",
        "accounts",
        "bindings",
    ):
        value = platform_cfg.get(key)
        if value:
            extra[key] = value
    extra.setdefault("card_template_id", OFFICIAL_CARD_TEMPLATE_ID)
    return extra


def _register_skills(ctx: Any) -> None:
    skill_path = Path(__file__).parent / "skills" / "dingtalk-dws" / "SKILL.md"
    ctx.register_skill(
        "dingtalk-dws",
        skill_path,
        "Operate DingTalk product features from Hermes through the dws CLI.",
    )


def _tool_credentials() -> tuple[str, str]:
    return (
        os.getenv("DINGTALK_CLIENT_ID", "").strip(),
        os.getenv("DINGTALK_CLIENT_SECRET", "").strip(),
    )


def _send_tool_requirements() -> bool:
    client_id, client_secret = _tool_credentials()
    if not (client_id and client_secret):
        return False
    try:
        import httpx  # noqa: F401
    except Exception:
        return False
    return True


def _attachment_kind(file_path: str, requested: str | None) -> str:
    normalized = str(requested or "auto").strip().lower()
    if normalized in {"image", "file"}:
        return normalized
    return "image" if Path(file_path).suffix.lower() in IMAGE_EXTENSIONS else "file"


def _content_kind(content: str, requested: str | None) -> str:
    normalized = str(requested or "auto").strip().lower()
    if normalized in {"text", "markdown"}:
        return normalized
    return "markdown" if _looks_like_markdown(content) else "text"


async def _handle_dingtalk_official_send(args: dict[str, Any], **_kwargs: Any) -> str:
    from tools.registry import tool_error, tool_result

    client_id, client_secret = _tool_credentials()
    if not (client_id and client_secret):
        return tool_error("Set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET first.")

    target_type = str(args.get("target_type") or "").strip().lower()
    target_id = str(args.get("target_id") or "").strip()
    if target_type not in {"user", "group"} or not target_id:
        return tool_error("target_type must be user or group, and target_id is required.")

    content = str(args.get("content") or "")
    file_path = str(args.get("file_path") or "").strip()
    if not content.strip() and not file_path:
        return tool_error("Provide content, file_path, or both.")

    prepared_mentions = _prepare_multi_bot_mentions(
        content,
        at_accounts=args.get("at_accounts"),
        at_dingtalk_ids=args.get("at_dingtalk_ids"),
    )
    if prepared_mentions["missing_accounts"]:
        return tool_error(
            "Unknown DingTalk bot mention accounts or aliases: "
            + ", ".join(prepared_mentions["missing_accounts"])
            + ". Configure DINGTALK_BOT_MENTIONS first."
        )
    content = _append_visible_mentions(
        prepared_mentions["content"],
        at_dingtalk_ids=prepared_mentions["at_dingtalk_ids"],
        at_user_ids=args.get("at_user_ids"),
        at_all=_truthy(args.get("at_all")),
    )

    try:
        import httpx
    except Exception:
        return tool_error("httpx is required for DingTalk official proactive sends.")

    target = {"type": target_type, "id": target_id}
    sent: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            if content.strip():
                content_kind = _content_kind(content, args.get("format"))
                data = await _send_proactive_payload(
                    http_client,
                    client_id=client_id,
                    client_secret=client_secret,
                    robot_code=os.getenv("DINGTALK_ROBOT_CODE", "").strip() or client_id,
                    target=target,
                    payload=_build_message_payload(
                        content_kind,
                        content,
                        title=str(args.get("title") or "") or None,
                    ),
                )
                sent.append(
                    {
                        "kind": content_kind,
                        "processQueryKey": data.get("processQueryKey"),
                    }
                )
            if file_path:
                file_kind = _attachment_kind(file_path, args.get("file_kind"))
                uploaded = await _upload_local_media(
                    http_client,
                    client_id,
                    client_secret,
                    file_path,
                    file_kind,
                )
                data = await _send_proactive_payload(
                    http_client,
                    client_id=client_id,
                    client_secret=client_secret,
                    robot_code=os.getenv("DINGTALK_ROBOT_CODE", "").strip() or client_id,
                    target=target,
                    payload=_build_message_payload(
                        file_kind,
                        uploaded["media_id"],
                        file_name=uploaded["file_name"],
                    ),
                )
                sent.append(
                    {
                        "kind": file_kind,
                        "fileName": uploaded["file_name"],
                        "processQueryKey": data.get("processQueryKey"),
                    }
                )
    except Exception as exc:
        return tool_error(str(exc))

    return tool_result({"success": True, "target": target, "sent": sent})


def _handle_dingtalk_official_mentions(_args: dict[str, Any] | None = None, **_kwargs: Any) -> str:
    from tools.registry import tool_result

    return tool_result(_bot_mentions_report())


def register(ctx: Any) -> None:
    """Register the official DingTalk platform surface with Hermes."""
    ctx.register_platform(
        name=PLATFORM_NAME,
        label="DingTalk Official",
        adapter_factory=_adapter_factory,
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
        install_hint='pip install "hermes-agent[dingtalk]"',
        env_enablement_fn=_env_enablement,
        apply_yaml_config_fn=_apply_yaml_config,
        cron_deliver_env_var="DINGTALK_HOME_CHANNEL",
        allowed_users_env="DINGTALK_ALLOWED_USERS",
        allow_all_env="DINGTALK_ALLOW_ALL_USERS",
        max_message_length=20000,
        pii_safe=False,
        allow_update_command=True,
        platform_hint=(
            "You are chatting through DingTalk. DingTalk renders Markdown and "
            "the official connector enables AI Card streaming by default when "
            "the DingTalk card SDK is available. Keep group replies concise "
            "and respect DingTalk user and chat allowlists. If configured "
            "DingTalk bot mention aliases are available, write @alias to call "
            "another bot; the plugin resolves it to a real DingTalk bot @."
        ),
    )
    _register_skills(ctx)
    ctx.register_tool(
        name="dingtalk_official_send",
        toolset="dingtalk_official",
        schema=DINGTALK_OFFICIAL_SEND_SCHEMA,
        handler=_handle_dingtalk_official_send,
        check_fn=_send_tool_requirements,
        is_async=True,
    )
    ctx.register_tool(
        name="dingtalk_official_mentions",
        toolset="dingtalk_official",
        schema=DINGTALK_OFFICIAL_MENTIONS_SCHEMA,
        handler=_handle_dingtalk_official_mentions,
        check_fn=lambda: True,
        is_async=False,
    )
