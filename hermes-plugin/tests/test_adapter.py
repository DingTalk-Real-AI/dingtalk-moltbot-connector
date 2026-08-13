import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "dingtalk_official_hermes_adapter", PLUGIN_ROOT / "adapter.py"
)
adapter = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(adapter)


class Config:
    def __init__(self, extra=None):
        self.extra = extra or {}


class FakeContext:
    def __init__(self):
        self.platforms = []
        self.skills = []
        self.tools = []

    def register_platform(self, **kwargs):
        self.platforms.append(kwargs)

    def register_skill(self, name, path, description=""):
        self.skills.append((name, path, description))

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self.payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self.payload


class FakeHTTPClient:
    def __init__(self):
        self.get_calls = []
        self.post_calls = []

    async def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        return FakeResponse({"errcode": 0, "access_token": "oapi-token"})

    async def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        if url.endswith("/v1.0/oauth2/accessToken"):
            return FakeResponse({"accessToken": "api-token"})
        if url.endswith("/media/upload"):
            return FakeResponse({"media_id": "@media-id"})
        return FakeResponse({"processQueryKey": "sent-key"})


class BaseReplyAdapter:
    MAX_MESSAGE_LENGTH = 20000

    async def send(
        self,
        chat_id,
        content,
        reply_to=None,
        metadata=None,
    ):
        self.base_send_calls.append(
            {
                "chat_id": chat_id,
                "content": content,
                "reply_to": reply_to,
                "metadata": metadata,
            }
        )
        return SimpleNamespace(success=True, message_id="text-reply")

    async def send_image(
        self,
        chat_id,
        image_url,
        caption=None,
        reply_to=None,
        metadata=None,
    ):
        self.base_image_calls.append(
            {
                "chat_id": chat_id,
                "image_url": image_url,
                "caption": caption,
                "reply_to": reply_to,
                "metadata": metadata,
            }
        )
        return SimpleNamespace(success=True, message_id="image-reply")


class ReplyImageAdapter(adapter._OfficialDingTalkMixin, BaseReplyAdapter):
    def __init__(self):
        self.base_send_calls = []
        self.base_image_calls = []
        self._http_client = FakeHTTPClient()
        self._client_id = "ding-client"
        self._client_secret = "ding-secret"
        self._message_contexts = {
            "cid-group": SimpleNamespace(conversation_type="2", conversation_id="cid-group")
        }
        self._session_webhooks = {
            "cid-group": ("https://api.dingtalk.com/robot/sendBySession", 0)
        }

    def _get_valid_webhook(self, chat_id):
        return self._session_webhooks.get(chat_id)

    async def _official_upload(self, file_path, media_type):
        return {
            "media_id": "@media-id",
            "download_url": "https://down.dingtalk.com/media/media-id",
            "file_name": "plot.png",
        }

    async def _official_send_payload(self, target, payload):
        raise AssertionError(f"unexpected proactive send: {target} {payload}")


class ReplyDocumentAdapter(adapter._OfficialDingTalkMixin, BaseReplyAdapter):
    def __init__(self):
        self.base_send_calls = []
        self.base_image_calls = []
        self._http_client = FakeHTTPClient()
        self._client_id = "ding-client"
        self._client_secret = "ding-secret"
        self._message_contexts = {
            "cid-group": SimpleNamespace(conversation_type="2", conversation_id="cid-group")
        }
        self._session_webhooks = {
            "cid-group": ("https://api.dingtalk.com/robot/sendBySession", 0)
        }

    def _get_valid_webhook(self, chat_id):
        return self._session_webhooks.get(chat_id)

    async def _official_upload(self, file_path, media_type):
        return {
            "media_id": "@file-media",
            "download_url": "https://down.dingtalk.com/media/file-media",
            "file_name": "report.pdf",
        }

    async def _official_send_payload(self, target, payload):
        raise AssertionError(f"unexpected proactive send: {target} {payload}")


class MentionReplyAdapter(adapter._OfficialDingTalkMixin, BaseReplyAdapter):
    def __init__(self):
        self.base_send_calls = []
        self.base_image_calls = []
        self._http_client = FakeHTTPClient()
        self._client_id = "ding-client"
        self._client_secret = "ding-secret"
        self.config = Config(
            {
                "bot_mentions": [
                    {
                        "account_id": "dev-bot",
                        "name": "开发助手",
                        "agent_ids": ["dev-agent"],
                        "aliases": ["dev"],
                        "chatbot_user_id": "$:LWCP_v1:$devbot",
                    }
                ]
            }
        )
        self._message_contexts = {
            "cid-group": SimpleNamespace(conversation_type="2", conversation_id="cid-group")
        }
        self._session_webhooks = {
            "cid-group": ("https://api.dingtalk.com/robot/sendBySession", 0)
        }
        self.done_calls = []

    def _get_valid_webhook(self, chat_id):
        return self._session_webhooks.get(chat_id)

    def _normalize_markdown(self, content):
        return content

    def _fire_done_reaction(self, chat_id):
        self.done_calls.append(chat_id)

    async def _official_send_payload(self, target, payload):
        raise AssertionError(f"unexpected proactive send: {target} {payload}")


class IdentityAdapter(adapter._OfficialDingTalkMixin):
    def __init__(self):
        self.config = Config({"account_id": "main-bot"})
        self.messages = []

    async def _on_message_super(self, message):
        self.messages.append(message)


class QuietActivityAdapter(adapter._OfficialDingTalkMixin, BaseReplyAdapter):
    def __init__(self):
        self.config = Config({})
        self.base_send_calls = []
        self.base_image_calls = []
        self._message_contexts = {}
        self._http_client = FakeHTTPClient()
        self._client_id = "ding-client"
        self._client_secret = "ding-secret"
        self.proactive_calls = []

    async def _official_send_payload(self, target, payload):
        self.proactive_calls.append((target, payload))
        return SimpleNamespace(success=True, message_id="proactive-sent")


class AdapterDefaultsTests(unittest.TestCase):
    def test_env_enablement_seeds_official_card_template(self):
        env = {
            "DINGTALK_CLIENT_ID": "ding-client",
            "DINGTALK_CLIENT_SECRET": "ding-secret",
            "DINGTALK_HOME_CHANNEL": "cid-home",
        }
        with patch.dict(os.environ, env, clear=True):
            seeded = adapter._env_enablement()

        self.assertEqual(seeded["client_id"], "ding-client")
        self.assertEqual(seeded["client_secret"], "ding-secret")
        self.assertEqual(seeded["card_template_id"], adapter.OFFICIAL_CARD_TEMPLATE_ID)
        self.assertEqual(seeded["home_channel"]["chat_id"], "cid-home")

    def test_explicit_card_template_survives_defaults(self):
        config = Config(
            {
                "client_id": "ding-client",
                "card_template_id": "custom-template",
            }
        )
        with patch.dict(os.environ, {}, clear=True):
            adapter._apply_official_defaults(config)

        self.assertEqual(config.extra["card_template_id"], "custom-template")
        self.assertEqual(config.extra["robot_code"], "ding-client")

    def test_register_overrides_dingtalk_platform_and_bundles_skill(self):
        ctx = FakeContext()
        adapter.register(ctx)

        self.assertEqual(len(ctx.platforms), 1)
        self.assertEqual(ctx.platforms[0]["name"], "dingtalk")
        self.assertEqual(ctx.platforms[0]["allowed_users_env"], "DINGTALK_ALLOWED_USERS")
        self.assertEqual(ctx.skills[0][0], "dingtalk-dws")
        self.assertTrue(ctx.skills[0][1].exists())
        self.assertEqual(ctx.tools[0]["name"], "dingtalk_official_send")
        self.assertTrue(ctx.tools[0]["is_async"])
        props = ctx.tools[0]["schema"]["parameters"]["properties"]
        self.assertIn("at_accounts", props)
        self.assertIn("at_dingtalk_ids", props)
        self.assertIn("at_user_ids", props)
        self.assertIn("at_all", props)
        self.assertEqual(ctx.tools[1]["name"], "dingtalk_official_mentions")


class ProactivePayloadTests(unittest.TestCase):
    def test_parse_explicit_proactive_targets(self):
        self.assertEqual(
            adapter._parse_proactive_target("user:alice"),
            {"type": "user", "id": "alice"},
        )
        self.assertEqual(
            adapter._parse_proactive_target("group:cid-1"),
            {"type": "group", "id": "cid-1"},
        )
        self.assertIsNone(adapter._parse_proactive_target("cid-1"))

    def test_context_target_uses_group_conversation_or_dm_staff_id(self):
        group_message = SimpleNamespace(conversation_type="2", conversation_id="cid-group")
        dm_message = SimpleNamespace(conversation_type="1", sender_staff_id="staff-alice")

        self.assertEqual(
            adapter._message_context_target(group_message, "fallback"),
            {"type": "group", "id": "cid-group"},
        )
        self.assertEqual(
            adapter._message_context_target(dm_message, "fallback"),
            {"type": "user", "id": "staff-alice"},
        )

    def test_file_payload_keeps_media_id_and_file_metadata(self):
        payload = adapter._build_message_payload("file", "@media-id", file_name="report.pdf")

        self.assertEqual(payload["msgKey"], "sampleFile")
        self.assertIn('"mediaId": "@media-id"', payload["msgParam"])
        self.assertIn('"fileType": "pdf"', payload["msgParam"])

    def test_proactive_errors_explain_identity_mismatches(self):
        staff_error = adapter._proactive_send_error(
            FakeResponse({"code": "staffId.notExisted", "message": "staff missing"}, status_code=400)
        )
        robot_error = adapter._proactive_send_error(
            FakeResponse({"code": "resource.not.found", "message": "robot does not exist"}, status_code=404)
        )

        self.assertIn("staff_id", staff_error)
        self.assertIn("sender_id", staff_error)
        self.assertIn("DINGTALK_ROBOT_CODE", robot_error)


class MultiBotMentionTests(unittest.TestCase):
    def test_openclaw_accounts_and_bindings_resolve_bot_aliases(self):
        cfg = {
            "accounts": {
                "dev-bot": {
                    "name": "开发助手",
                    "chatbotUserId": "$:LWCP_v1:$devbot",
                    "aliases": ["dev"],
                }
            },
            "bindings": [
                {
                    "agentId": "dev-agent",
                    "match": {"channel": "dingtalk-connector", "accountId": "dev-bot"},
                }
            ],
        }

        content, ids = adapter._substitute_bot_mentions("请 @dev-agent 看一下", cfg)

        self.assertEqual(content, "请 @$:LWCP_v1:$devbot 看一下")
        self.assertEqual(ids, ["$:LWCP_v1:$devbot"])

    def test_explicit_at_accounts_append_real_chatbot_id(self):
        cfg = {
            "bot_mentions": [
                {
                    "account_id": "dev-bot",
                    "agent_ids": ["dev-agent"],
                    "chatbot_user_id": "$:LWCP_v1:$devbot",
                }
            ]
        }

        prepared = adapter._prepare_multi_bot_mentions(
            "请处理",
            config_or_extra=cfg,
            at_accounts=["dev-agent"],
        )

        self.assertEqual(prepared["content"], "请处理 @$:LWCP_v1:$devbot")
        self.assertEqual(prepared["at_dingtalk_ids"], ["$:LWCP_v1:$devbot"])
        self.assertEqual(prepared["missing_accounts"], [])

    def test_mentions_report_shows_ready_and_missing_accounts(self):
        report = adapter._bot_mentions_report(
            {
                "accounts": {
                    "ready-bot": {"chatbotUserId": "$:LWCP_v1:$ready"},
                    "missing-bot": {"name": "未配置"},
                }
            }
        )

        self.assertFalse(report["ready"])
        self.assertEqual(report["readyAccounts"], 1)
        self.assertEqual(report["missingChatbotUserId"], ["missing-bot"])
        self.assertIn("ready-bot", report["report"])

    def test_record_bot_identity_keeps_latest_identity(self):
        identity_adapter = IdentityAdapter()
        message = SimpleNamespace(
            chatbot_user_id="$:LWCP_v1:$main",
            chatbot_corp_id="corp-main",
        )

        with patch("builtins.print") as printed:
            identity_adapter._record_bot_identity(message)

        self.assertEqual(
            identity_adapter._official_last_bot_identity,
            {
                "accountId": "main-bot",
                "chatbotUserId": "$:LWCP_v1:$main",
                "chatbotCorpId": "corp-main",
            },
        )
        printed.assert_called_once()

    def test_visible_mentions_append_user_ids_and_all_once(self):
        content = adapter._append_visible_mentions(
            "请处理 @staff-a",
            at_dingtalk_ids=["$:LWCP_v1:$devbot"],
            at_user_ids=["staff-a", "staff-b"],
            at_all=True,
        )

        self.assertEqual(
            content,
            "请处理 @staff-a @$:LWCP_v1:$devbot @staff-b @all",
        )


class QuietActivityTests(unittest.IsolatedAsyncioTestCase):
    async def test_intermediate_activity_is_suppressed_by_default(self):
        quiet_adapter = QuietActivityAdapter()

        result = await quiet_adapter.send(
            "cid-group",
            '💻 terminal: "grep DINGTALK_CLIENT_ID ..."',
        )

        self.assertTrue(result.success)
        self.assertIsNone(result.message_id)
        self.assertEqual(quiet_adapter.base_send_calls, [])
        self.assertFalse(quiet_adapter.SUPPORTS_MESSAGE_EDITING)

    async def test_final_reply_still_sends(self):
        quiet_adapter = QuietActivityAdapter()

        result = await quiet_adapter.send(
            "cid-group",
            "这是最终回复",
            reply_to="msg-1",
            metadata={"notify": True},
        )

        self.assertTrue(result.success)
        self.assertEqual(quiet_adapter.base_send_calls[0]["content"], "这是最终回复")

    async def test_activity_can_be_enabled_for_debugging(self):
        quiet_adapter = QuietActivityAdapter()

        with patch.dict(os.environ, {"DINGTALK_SHOW_ACTIVITY": "true"}):
            result = await quiet_adapter.send("cid-group", "调试进度")

        self.assertTrue(result.success)
        self.assertEqual(quiet_adapter.base_send_calls[0]["content"], "调试进度")
        with patch.dict(os.environ, {"DINGTALK_SHOW_ACTIVITY": "true"}):
            self.assertTrue(quiet_adapter.SUPPORTS_MESSAGE_EDITING)

    async def test_explicit_proactive_targets_are_not_suppressed(self):
        quiet_adapter = QuietActivityAdapter()

        result = await quiet_adapter.send("group:cid-home", "主动发送")

        self.assertTrue(result.success)
        self.assertEqual(quiet_adapter.proactive_calls[0][0], {"type": "group", "id": "cid-home"})


class OfficialRequestTests(unittest.IsolatedAsyncioTestCase):
    async def test_proactive_group_send_uses_robot_openapi_template(self):
        client = FakeHTTPClient()

        result = await adapter._send_proactive_payload(
            client,
            client_id="ding-client",
            client_secret="ding-secret",
            robot_code="ding-robot",
            target={"type": "group", "id": "cid-group"},
            payload=adapter._build_message_payload("markdown", "# Hello"),
        )

        self.assertEqual(result["processQueryKey"], "sent-key")
        self.assertEqual(client.post_calls[0][0], f"{adapter.DINGTALK_API}/v1.0/oauth2/accessToken")
        send_url, send_kwargs = client.post_calls[1]
        self.assertEqual(send_url, f"{adapter.DINGTALK_API}/v1.0/robot/groupMessages/send")
        self.assertEqual(send_kwargs["json"]["openConversationId"], "cid-group")
        self.assertEqual(send_kwargs["json"]["robotCode"], "ding-robot")
        self.assertEqual(send_kwargs["json"]["msgKey"], "sampleMarkdown")
        self.assertEqual(
            send_kwargs["headers"]["x-acs-dingtalk-access-token"],
            "api-token",
        )

    async def test_media_upload_uses_oapi_and_returns_original_media_id(self):
        client = FakeHTTPClient()
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "plot.png"
            image_path.write_bytes(b"png-bytes")

            uploaded = await adapter._upload_local_media(
                client,
                "ding-client",
                "ding-secret",
                str(image_path),
                "image",
            )

        self.assertEqual(uploaded["media_id"], "@media-id")
        self.assertEqual(uploaded["download_url"], "https://down.dingtalk.com/media/media-id")
        self.assertEqual(client.get_calls[0][0], f"{adapter.DINGTALK_OAPI}/gettoken")
        upload_url, upload_kwargs = client.post_calls[0]
        self.assertEqual(upload_url, f"{adapter.DINGTALK_OAPI}/media/upload")
        self.assertEqual(upload_kwargs["params"]["access_token"], "oapi-token")
        self.assertEqual(upload_kwargs["params"]["type"], "image")

    async def test_current_context_local_image_uses_session_markdown_media_id(self):
        reply_adapter = ReplyImageAdapter()

        result = await reply_adapter.send_image_file(
            "cid-group",
            "/tmp/plot.png",
            caption="plot",
            reply_to="msg-1",
        )

        self.assertTrue(result.success)
        self.assertEqual(reply_adapter.base_send_calls, [])
        self.assertEqual(reply_adapter._http_client.post_calls[0][0], f"{adapter.DINGTALK_API}/v1.0/oauth2/accessToken")
        send_url, send_kwargs = reply_adapter._http_client.post_calls[1]
        self.assertEqual(send_url, "https://api.dingtalk.com/robot/sendBySession")
        self.assertEqual(send_kwargs["json"]["msgtype"], "markdown")
        self.assertEqual(
            send_kwargs["json"]["markdown"]["text"],
            "plot\n\n![image](@media-id)",
        )

    async def test_current_context_document_uses_session_file_message(self):
        reply_adapter = ReplyDocumentAdapter()

        result = await reply_adapter.send_document(
            "cid-group",
            "/tmp/report.pdf",
            file_name="report.pdf",
        )

        self.assertTrue(result.success)
        self.assertEqual(reply_adapter._http_client.post_calls[0][0], f"{adapter.DINGTALK_API}/v1.0/oauth2/accessToken")
        send_url, send_kwargs = reply_adapter._http_client.post_calls[1]
        self.assertEqual(send_url, "https://api.dingtalk.com/robot/sendBySession")
        self.assertEqual(send_kwargs["json"]["msgtype"], "file")
        self.assertEqual(send_kwargs["json"]["file"]["media_id"], "@file-media")
        self.assertEqual(send_kwargs["json"]["file"]["fileName"], "report.pdf")
        self.assertEqual(send_kwargs["json"]["file"]["fileType"], "pdf")

    async def test_session_text_with_bot_alias_uses_dingtalk_at_field(self):
        reply_adapter = MentionReplyAdapter()

        result = await reply_adapter.send(
            "cid-group",
            "请 @dev-agent 看一下",
            reply_to="msg-1",
        )

        self.assertTrue(result.success)
        self.assertEqual(reply_adapter.base_send_calls, [])
        self.assertEqual(reply_adapter._http_client.post_calls[0][0], f"{adapter.DINGTALK_API}/v1.0/oauth2/accessToken")
        send_url, send_kwargs = reply_adapter._http_client.post_calls[1]
        self.assertEqual(send_url, "https://api.dingtalk.com/robot/sendBySession")
        self.assertEqual(send_kwargs["json"]["markdown"]["text"], "请 @$:LWCP_v1:$devbot 看一下")
        self.assertEqual(
            send_kwargs["json"]["at"]["atDingtalkIds"],
            ["$:LWCP_v1:$devbot"],
        )
        self.assertEqual(reply_adapter.done_calls, ["cid-group"])

    async def test_session_text_metadata_can_at_user_and_all(self):
        reply_adapter = MentionReplyAdapter()

        result = await reply_adapter.send(
            "cid-group",
            "请大家看一下",
            reply_to="msg-1",
            metadata={"at_user_ids": ["staff-a"], "at_all": True},
        )

        self.assertTrue(result.success)
        _send_url, send_kwargs = reply_adapter._http_client.post_calls[1]
        self.assertEqual(send_kwargs["json"]["markdown"]["text"], "请大家看一下 @staff-a @all")
        self.assertEqual(send_kwargs["json"]["at"]["atUserIds"], ["staff-a"])
        self.assertTrue(send_kwargs["json"]["at"]["isAtAll"])


if __name__ == "__main__":
    unittest.main()
