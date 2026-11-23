import json
import pathlib
import sys
import unittest

PERPLEXITY_SERVICE_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PERPLEXITY_SERVICE_ROOT))

from perplexity.client import Client, _parse_sse_message, normalize_search_response  # noqa: E402


class StubStreamingResponse:
    def __init__(self, event_blocks):
        self.event_blocks = event_blocks

    def iter_lines(self, delimiter=None):
        del delimiter
        for event_block in self.event_blocks:
            yield event_block.encode("utf-8")


class StubSession:
    def __init__(self, event_blocks):
        self.response = StubStreamingResponse(event_blocks)

    def post(self, *args, **kwargs):
        del args, kwargs
        return self.response


def create_client_without_network(event_blocks):
    client = Client.__new__(Client)
    client.session = StubSession(event_blocks)
    client.own = True
    client.copilot = float("inf")
    client.file_upload = float("inf")
    return client


def create_sse_event(event_name, payload=None, line_ending="\r\n"):
    lines = [f"event: {event_name}"]
    if payload is not None:
        lines.append(f"data: {json.dumps(payload)}")
    return line_ending.join(lines) + line_ending + line_ending


class ClientResponseParsingTests(unittest.TestCase):
    def test_normalize_search_response_keeps_legacy_final_answer_compatible(self):
        legacy_answer_payload = {
            "answer": "legacy answer",
            "chunks": [{"url": "https://example.com/legacy"}],
        }
        response_payload = {
            "text": json.dumps(
                [
                    {
                        "step_type": "FINAL",
                        "content": {"answer": json.dumps(legacy_answer_payload)},
                    }
                ]
            )
        }

        normalized_response = normalize_search_response(response_payload)

        self.assertEqual(normalized_response["answer"], "legacy answer")
        self.assertEqual(
            normalized_response["chunks"],
            [{"url": "https://example.com/legacy"}],
        )
        self.assertIsInstance(normalized_response["text"], list)

    def test_normalize_search_response_reads_current_markdown_and_web_result_blocks(self):
        response_payload = {
            "blocks": [
                {
                    "intended_usage": "ask_text",
                    "markdown_block": {
                        "progress": "DONE",
                        "chunks": ["current ", "answer"],
                        "answer": "current answer",
                    },
                },
                {
                    "intended_usage": "web_results",
                    "web_result_block": {
                        "web_results": [
                            {
                                "name": "Current source",
                                "url": "https://example.com/current",
                            }
                        ]
                    },
                },
            ]
        }

        normalized_response = normalize_search_response(response_payload)

        self.assertEqual(normalized_response["answer"], "current answer")
        self.assertEqual(
            normalized_response["chunks"],
            [{"name": "Current source", "url": "https://example.com/current"}],
        )

    def test_parse_sse_message_accepts_crlf_event_blocks(self):
        self.assert_sse_line_ending_is_supported("\r\n")

    def test_parse_sse_message_accepts_lf_event_blocks(self):
        self.assert_sse_line_ending_is_supported("\n")

    def assert_sse_line_ending_is_supported(self, line_ending):
        event_block = create_sse_event(
            "message",
            {
                "blocks": [
                    {
                        "intended_usage": "ask_text",
                        "markdown_block": {
                            "progress": "DONE",
                            "answer": "parsed answer",
                        },
                    }
                ]
            },
            line_ending=line_ending,
        )

        event_name, response_payload = _parse_sse_message(event_block)

        self.assertEqual(event_name, "message")
        self.assertEqual(response_payload["answer"], "parsed answer")

    def test_non_streaming_search_combines_sources_and_answer_from_separate_frames(self):
        source_payload = {
            "blocks": [
                {
                    "intended_usage": "web_results",
                    "web_result_block": {
                        "web_results": [
                            {"name": "Source one", "url": "https://example.com/one"},
                            {"name": "Source two", "url": "https://example.com/two"},
                        ]
                    },
                },
            ]
        }
        answer_payload = {
            "blocks": [
                {
                    "intended_usage": "ask_text",
                    "markdown_block": {
                        "progress": "DONE",
                        "chunks": ["143"],
                        "answer": "143",
                    },
                }
            ]
        }
        client = create_client_without_network(
            [
                create_sse_event("message", source_payload),
                create_sse_event("message", answer_payload),
                create_sse_event("end_of_stream"),
            ]
        )

        result = client.search("What is eleven multiplied by thirteen?", mode="auto")

        self.assertEqual(result["answer"], "143")
        self.assertEqual(
            result["chunks"],
            [
                {"name": "Source one", "url": "https://example.com/one"},
                {"name": "Source two", "url": "https://example.com/two"},
            ],
        )

    def test_non_streaming_search_rejects_successful_http_response_without_answer(self):
        client = create_client_without_network(
            [
                create_sse_event("message", {"final": True, "blocks": []}),
                create_sse_event("end_of_stream"),
            ]
        )

        with self.assertRaisesRegex(RuntimeError, "contained no answer"):
            client.search("This response must not be treated as successful", mode="auto")


    def test_account_hint_prefers_last_active_account_and_falls_back_to_session_cookie_suffix(self):
        client = Client.__new__(Client)
        client._cookies = {
            "__Host-pplx-last-active-account": "acct-from-host",
            "__Secure-pplx.session.acct-from-session": "tok",
        }
        self.assertEqual(client.account_hint(), "acct-from-host")

        client2 = Client.__new__(Client)
        client2._cookies = {
            "__Secure-pplx.session.b2f12bc5-8f30-431e-80bc-66dc3143f926": "tok",
        }
        self.assertEqual(client2.account_hint(), "b2f12bc5-8f30-431e-80bc-66dc3143f926")

        client3 = Client.__new__(Client)
        client3._cookies = {"__Secure-next-auth.session-token": "legacy"}
        self.assertEqual(client3.account_hint(), "")

    def test_build_account_cookies_and_persistable_filter(self):
        from perplexity.server.client_pool import (
            build_account_cookies,
            extract_persistable_extra_cookies,
        )

        # Rolling cookie only is accepted
        rolling = build_account_cookies(
            extra_cookies={
                "__Secure-pplx.session.u-1": "sval",
                "__Host-pplx-last-active-account": "u-1",
            }
        )
        self.assertEqual(rolling["__Secure-pplx.session.u-1"], "sval")
        self.assertEqual(rolling["__Host-pplx-last-active-account"], "u-1")

        # Empty input rejected
        with self.assertRaises(ValueError):
            build_account_cookies("", "", {})

        # Transient CF cookies stripped while auth + operator-supplied cookies kept
        filtered = extract_persistable_extra_cookies(
            {
                "__Secure-next-auth.session-token": "leg",
                "next-auth.csrf-token": "csrf",
                "__Secure-pplx.session.u-1": "new-sval",
                "__Host-pplx-last-active-account": "u-1",
                "__cf_bm": "transient",
                "AWSALB": "transient2",
                "custom_flag": "keepme",
            },
            supplied_keys={"custom_flag"},
        )
        self.assertEqual(
            filtered,
            {
                "__Secure-pplx.session.u-1": "new-sval",
                "__Host-pplx-last-active-account": "u-1",
                "custom_flag": "keepme",
            },
        )


if __name__ == "__main__":
    unittest.main()
