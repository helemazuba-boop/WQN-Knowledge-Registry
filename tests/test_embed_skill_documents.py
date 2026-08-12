from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "embed-skill-documents.py"
SPEC = importlib.util.spec_from_file_location("embed_skill_documents", SCRIPT_PATH)
assert SPEC and SPEC.loader
embedder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(embedder)


def qwen_profile() -> dict:
    return {
        "provider_protocol": "qwen-instruct-query-v1",
        "model": "Qwen/Qwen3-Embedding-4B",
        "encoding_format": "float",
        "query_contract": {"instruction": "Retrieve the relevant skill."},
    }


def nvidia_profile() -> dict:
    return {
        "provider_protocol": "nvidia-query-passage-v1",
        "model": "nvidia/nemotron-3-embed-1b",
        "encoding_format": "float",
        "document_contract": {"input_type": "passage", "truncate": "NONE"},
        "query_contract": {"input_type": "query", "truncate": "NONE"},
    }


class RequestContractTests(unittest.TestCase):
    def test_qwen_roles_use_plain_documents_and_instructed_queries(self) -> None:
        self.assertEqual(
            embedder.request_body(qwen_profile(), ["document"], "document"),
            {
                "model": "Qwen/Qwen3-Embedding-4B",
                "input": ["document"],
                "encoding_format": "float",
            },
        )
        self.assertEqual(
            embedder.request_body(qwen_profile(), ["question"], "query")["input"],
            ["Instruct: Retrieve the relevant skill.\nQuery: question"],
        )

    def test_nvidia_roles_are_passage_and_query_without_truncation(self) -> None:
        document = embedder.request_body(nvidia_profile(), ["document"], "document")
        query = embedder.request_body(nvidia_profile(), ["question"], "query")
        self.assertEqual(document["input_type"], "passage")
        self.assertEqual(query["input_type"], "query")
        self.assertEqual(document["truncate"], "NONE")
        self.assertEqual(query["truncate"], "NONE")

    def test_provider_protocol_selects_fixed_credential_name(self) -> None:
        self.assertEqual(
            embedder.credential_environment(qwen_profile()), "MODELSCOPE_TOKEN"
        )
        self.assertEqual(
            embedder.credential_environment(nvidia_profile()), "NVIDIA_API_KEY"
        )


class ProviderResponseTests(unittest.TestCase):
    def test_response_indexes_are_complete_unique_and_ordered(self) -> None:
        self.assertEqual(
            embedder.decode_embeddings(
                {
                    "data": [
                        {"index": 1, "embedding": [0.0, 1.0]},
                        {"index": 0, "embedding": [1.0, 0.0]},
                    ]
                },
                2,
            ),
            [[1.0, 0.0], [0.0, 1.0]],
        )
        with self.assertRaisesRegex(embedder.ProviderContractError, "duplicate"):
            embedder.decode_embeddings(
                {
                    "data": [
                        {"index": 0, "embedding": [1.0]},
                        {"index": 0, "embedding": [1.0]},
                    ]
                },
                2,
            )
        with self.assertRaisesRegex(embedder.ProviderContractError, "missing"):
            embedder.decode_embeddings(
                {"data": [{"index": 0, "embedding": [1.0]}]}, 2
            )

    def test_retryable_http_statuses_are_narrow(self) -> None:
        for status in (429, 500, 503):
            error = HTTPError("https://example.test", status, "failure", {}, BytesIO())
            with patch.object(embedder, "urlopen", side_effect=error):
                with self.assertRaises(embedder.TransientProviderError):
                    embedder.request_embeddings(
                        ["document"],
                        {**nvidia_profile(), "endpoint": "https://example.test"},
                        "secret",
                        "document",
                        1,
                    )
        for status in (400, 401, 403, 422):
            error = HTTPError("https://example.test", status, "failure", {}, BytesIO())
            with patch.object(embedder, "urlopen", side_effect=error):
                with self.assertRaises(embedder.ProviderContractError):
                    embedder.request_embeddings(
                        ["document"],
                        {**nvidia_profile(), "endpoint": "https://example.test"},
                        "secret",
                        "document",
                        1,
                    )

    def test_vector_contract_rejects_wrong_dimension_and_non_finite_values(self) -> None:
        with self.assertRaisesRegex(embedder.ProviderContractError, "dimension"):
            embedder.normalized([1.0], 2)
        with self.assertRaisesRegex(embedder.ProviderContractError, "non-finite"):
            embedder.normalized([float("nan"), 1.0], 2)
        self.assertEqual(embedder.normalized([3.0, 4.0], 2), [0.6, 0.8])


class AtomicOutputTests(unittest.TestCase):
    def test_atomic_write_replaces_complete_file_and_leaves_no_temporary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "vectors.json"
            embedder.write_atomic(path, json.dumps({"complete": True}) + "\n")
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")), {"complete": True}
            )
            self.assertEqual(list(path.parent.glob("*.tmp-*")), [])


if __name__ == "__main__":
    unittest.main()
