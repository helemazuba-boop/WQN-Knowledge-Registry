#!/usr/bin/env python3
"""Embed profile-scoped Skill retrieval documents through a protected provider."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ProviderContractError(Exception):
    """A non-retryable provider or profile contract failure."""


class TransientProviderError(Exception):
    """A provider failure that may succeed on bounded retry."""


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_json_sha256(value: object) -> str:
    """Hash JSON using the Registry's JavaScript serialization contract."""
    process = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            (
                "let input='';"
                "for await (const chunk of process.stdin) input += chunk;"
                "process.stdout.write("
                "await crypto.subtle.digest('SHA-256', "
                "new TextEncoder().encode(JSON.stringify(JSON.parse(input))+'\\n'))"
                ".then(value => Buffer.from(value).toString('hex')));"
            ),
        ],
        input=json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0 or len(process.stdout.strip()) != 64:
        raise ProviderContractError("Unable to apply canonical vector serialization")
    return process.stdout.strip()


def source_cache_key(
    profile_fingerprint: str,
    source_documents_sha256: str,
    source_vectors_sha256: str,
) -> str:
    identity = {
        "profile_fingerprint": profile_fingerprint,
        "source_documents_sha256": source_documents_sha256,
        "source_vectors_sha256": source_vectors_sha256,
    }
    serialized = (
        json.dumps(identity, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode("utf-8")
    return sha256_bytes(serialized)


def credential_environment(profile: dict) -> str:
    protocol = profile.get("provider_protocol")
    if protocol == "qwen-instruct-query-v1":
        return "MODELSCOPE_TOKEN"
    if protocol == "nvidia-query-passage-v1":
        return "NVIDIA_API_KEY"
    if protocol == "dashscope-qwen37-native-v1":
        return "DASHSCOPE_API_KEY"
    raise ProviderContractError("Unsupported embedding provider protocol")


def endpoint_environment(profile: dict) -> str | None:
    if profile.get("provider_protocol") == "dashscope-qwen37-native-v1":
        return "DASHSCOPE_ENDPOINT"
    return None


def request_body(profile: dict, texts: list[str], role: str) -> dict:
    protocol = profile.get("provider_protocol")
    inputs = texts
    if protocol == "qwen-instruct-query-v1":
        if role == "query":
            instruction = profile["query_contract"]["instruction"]
            inputs = [f"Instruct: {instruction}\nQuery: {text}" for text in texts]
    elif protocol == "nvidia-query-passage-v1":
        contract = (
            profile["document_contract"]
            if role == "document"
            else profile["query_contract"]
        )
        return {
            "model": profile["model"],
            "input": inputs,
            "encoding_format": profile["encoding_format"],
            "input_type": contract["input_type"],
            "truncate": contract["truncate"],
        }
    elif protocol == "dashscope-qwen37-native-v1":
        contract = (
            profile["document_contract"]
            if role == "document"
            else profile["query_contract"]
        )
        parameters = {
            "dimension": profile["dimension"],
            "output_type": contract["output_type"],
            "text_type": contract["text_type"],
        }
        if role == "query":
            parameters["instruct"] = contract["instruct"]
        return {
            "model": profile["model"],
            "input": {"texts": inputs},
            "parameters": parameters,
        }
    else:
        raise ProviderContractError("Unsupported embedding provider protocol")
    return {
        "model": profile["model"],
        "input": inputs,
        "encoding_format": profile["encoding_format"],
    }


def decode_embeddings(payload: object, expected_rows: int) -> list[list[float]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ProviderContractError("Embedding provider returned malformed JSON")
    by_index: dict[int, list[float]] = {}
    for item in payload["data"]:
        if not isinstance(item, dict):
            raise ProviderContractError("Embedding provider returned a malformed row")
        index = item.get("index")
        vector = item.get("embedding")
        if (
            not isinstance(index, int)
            or isinstance(index, bool)
            or not isinstance(vector, list)
        ):
            raise ProviderContractError("Embedding provider returned a malformed row")
        if index in by_index:
            raise ProviderContractError("Embedding provider returned duplicate indexes")
        by_index[index] = vector
    if set(by_index) != set(range(expected_rows)):
        raise ProviderContractError("Embedding provider returned missing indexes")
    return [by_index[index] for index in range(expected_rows)]


def decode_dashscope_embeddings(
    payload: object, expected_rows: int
) -> list[list[float]]:
    if not isinstance(payload, dict):
        raise ProviderContractError("Embedding provider returned malformed JSON")
    status_code = payload.get("status_code", 200)
    if status_code != 200:
        raise ProviderContractError(
            f"Embedding provider rejected the request (status {status_code})"
        )
    output = payload.get("output")
    if not isinstance(output, dict) or not isinstance(output.get("embeddings"), list):
        raise ProviderContractError("Embedding provider returned malformed JSON")
    by_index: dict[int, list[float]] = {}
    for item in output["embeddings"]:
        if not isinstance(item, dict):
            raise ProviderContractError("Embedding provider returned a malformed row")
        index = item.get("text_index")
        vector = item.get("embedding")
        if (
            not isinstance(index, int)
            or isinstance(index, bool)
            or not isinstance(vector, list)
        ):
            raise ProviderContractError("Embedding provider returned a malformed row")
        if index in by_index:
            raise ProviderContractError("Embedding provider returned duplicate indexes")
        by_index[index] = vector
    if set(by_index) != set(range(expected_rows)):
        raise ProviderContractError("Embedding provider returned missing indexes")
    return [by_index[index] for index in range(expected_rows)]


def request_embeddings(
    texts: list[str], profile: dict, endpoint: str, token: str, role: str, timeout: int
) -> list[list[float]]:
    body = json.dumps(request_body(profile, texts, role)).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code == 429 or 500 <= error.code <= 599:
            raise TransientProviderError(
                f"Embedding provider temporarily unavailable (HTTP {error.code})"
            ) from None
        if error.code in (401, 403):
            raise ProviderContractError(
                f"Embedding provider authorization failed (HTTP {error.code})"
            ) from None
        raise ProviderContractError(
            f"Embedding provider rejected the request (HTTP {error.code})"
        ) from None
    except (URLError, TimeoutError, OSError):
        raise TransientProviderError("Embedding provider network request failed") from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderContractError("Embedding provider returned malformed JSON") from None
    if profile.get("provider_protocol") == "dashscope-qwen37-native-v1":
        return decode_dashscope_embeddings(payload, len(texts))
    return decode_embeddings(payload, len(texts))


def normalized(vector: list[float], dimension: int) -> list[float]:
    if len(vector) != dimension:
        raise ProviderContractError(
            f"Embedding dimension mismatch: {len(vector)} != {dimension}"
        )
    if not vector or any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in vector
    ):
        raise ProviderContractError("Embedding provider returned a non-finite vector")
    norm = sum(value * value for value in vector) ** 0.5
    if not norm or not math.isfinite(norm):
        raise ProviderContractError("Embedding provider returned a zero vector")
    return [float(value / norm) for value in vector]


def write_atomic(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    try:
        temporary_path.write_text(contents, encoding="utf-8")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def run_preflight(documents_path: Path, profile_path: Path) -> dict:
    script_path = Path(__file__).with_name("preflight-skill-documents.ts")
    process = subprocess.run(
        [
            "node",
            str(script_path),
            "--documents",
            str(documents_path),
            "--profile",
            str(profile_path),
            "--json",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        message = process.stderr.strip().splitlines()
        detail = message[-1] if message else "unknown preflight failure"
        raise ProviderContractError(f"Skill document preflight failed: {detail}")
    try:
        result = json.loads(process.stdout)
    except json.JSONDecodeError:
        raise ProviderContractError("Skill document preflight returned malformed JSON") from None
    if not isinstance(result, dict):
        raise ProviderContractError("Skill document preflight returned malformed JSON")
    return result


def embed_documents(
    documents: list[dict],
    profile: dict,
    endpoint: str,
    token: str,
    batch_size: int,
    timeout: int,
) -> list[dict]:
    vectors: list[dict] = []
    for start in range(0, len(documents), batch_size):
        batch = documents[start : start + batch_size]
        raw_vectors: list[list[float]] | None = None
        for attempt in range(4):
            try:
                raw_vectors = request_embeddings(
                    [document["retrieval_text"] for document in batch],
                    profile,
                    endpoint,
                    token,
                    "document",
                    timeout,
                )
                break
            except TransientProviderError:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        if raw_vectors is None:
            raise TransientProviderError("Embedding provider retry budget exhausted")
        for offset, (document, vector) in enumerate(
            zip(batch, raw_vectors, strict=True)
        ):
            vectors.append(
                {
                    "index": start + offset,
                    "stable_key": document["stable_key"],
                    "source_location": document["source_location"],
                    "vector": normalized(vector, profile["dimension"]),
                }
            )
        print(
            f"Embedded {min(start + batch_size, len(documents))}/{len(documents)}",
            file=sys.stderr,
        )
    return vectors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("documents_json")
    parser.add_argument("profile_json")
    parser.add_argument("output_json")
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.batch_size <= 0 or args.timeout <= 0:
        print("Batch size and timeout must be positive", file=sys.stderr)
        return 2

    documents_path = Path(args.documents_json).resolve()
    profile_path = Path(args.profile_json).resolve()
    output_path = Path(args.output_json).resolve()
    try:
        preflight = run_preflight(documents_path, profile_path)
        documents_source = json.loads(documents_path.read_text(encoding="utf-8"))
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        documents = documents_source["documents"]
        profile_id = profile["profile_id"]
        if preflight.get("profile_id") != profile_id:
            raise ProviderContractError("Preflight profile identity mismatch")
        token_environment = credential_environment(profile)
        if preflight.get("credential_environment") != token_environment:
            raise ProviderContractError("Preflight credential contract mismatch")
        endpoint_environment_name = endpoint_environment(profile)
        if preflight.get("endpoint_environment") != endpoint_environment_name:
            raise ProviderContractError("Preflight endpoint contract mismatch")
        token = os.environ.get(token_environment, "").strip()
        if not token:
            print(
                f"Missing protected server-side environment variable {token_environment}",
                file=sys.stderr,
            )
            return 2
        endpoint = profile["endpoint"]
        if endpoint_environment_name:
            endpoint = os.environ.get(endpoint_environment_name, "").strip()
            if not endpoint:
                print(
                    f"Missing protected server-side environment variable {endpoint_environment_name}",
                    file=sys.stderr,
                )
                return 2

        vectors = embed_documents(
            documents,
            profile,
            endpoint,
            token,
            args.batch_size,
            args.timeout,
        )
        vectors_sha256 = canonical_json_sha256(vectors)
        profile_fingerprint = preflight["profile_fingerprint"]
        cache_key = source_cache_key(
            profile_fingerprint,
            documents_source["source_documents_sha256"],
            vectors_sha256,
        )
        source = {
            "format_version": "wqn-skill-retrieval-vectors-v1",
            "source_corpus_sha256": documents_source["source_corpus_sha256"],
            "source_documents_sha256": documents_source["source_documents_sha256"],
            "profile_id": profile_id,
            "profile_fingerprint": profile_fingerprint,
            "source_vectors_sha256": vectors_sha256,
            "source_vector_cache_key": cache_key,
            "vectors": vectors,
        }
        serialized = json.dumps(source, ensure_ascii=False, indent=2) + "\n"
        write_atomic(output_path, serialized)
        print(
            f"Wrote {output_path} documents={len(documents)} "
            f"dimension={profile['dimension']} "
            f"sha256={sha256_bytes(serialized.encode('utf-8'))}"
        )
        return 0
    except (ProviderContractError, TransientProviderError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
