# WQN Knowledge Registry

WQN 的 Canonical Subject、Knowledge Mark 与 Skill Mark 事实源。

This repository is the source of truth for WQN's canonical learning vocabulary.
The WQN Supabase database is a runtime projection, not an independently editable
authority.

## Repository scope

This repository owns:

- canonical Subject definitions;
- canonical Knowledge and Skill Mark definitions;
- reviewed Skill retrieval documents and vectors bound to those canonical Skill keys;
- stable-key and parent-graph validation;
- deterministic `dist/registry.json` artifact generation;
- deterministic profile-scoped `dist/skill-retrieval/` artifacts, manifests, and
  catalog generation when frozen vectors are present;
- published-identity compatibility validation;
- authoring rules and governance.

It does **not** contain user data, Problems, credentials, Supabase deployment code,
or production synchronization automation. WQN consumes a validated runtime
projection; the application repository is
[Wrong-Question-Notebook](https://github.com/helemazuba-boop/Wrong-Question-Notebook).

## Identity model

- Subject keys use lower snake case, for example `math`.
- Mark keys use `<subject>.<kind>.<path>`, for example
  `math.skill.parameter_separation`.
- A stable key is permanent. A display-name, alias, or hierarchy change never makes
  the key available for another meaning.
- Published entries are never deleted. Set `status` to `deprecated` instead.
- Runtime status is only `active` or `deprecated`. Proposed entries stay outside the
  merged Registry until reviewed.
- A Canonical Subject is a classification dimension. It does not replace or merge
  user-owned Subject containers in WQN.

See [GOVERNANCE.md](GOVERNANCE.md) for the complete compatibility rules.

## Files

`registry/subjects.json` contains Canonical Subjects. Every declared Subject has:

```text
registry/<subject-key>/knowledge.json
registry/<subject-key>/skills.json
```

Each file contains an array. Empty arrays are intentional and valid: curriculum
coverage is added through review rather than guessed in advance.

A Mark contains:

- required `stable_key`, `name`, `kind`, `subject`, and `status`;
- optional `aliases`, `description`, `parent`, `include`, and `exclude`.

## Local validation

Node.js 24 or newer is required.

```sh
npm ci
npm run check
```

For a faster content-only check:

```sh
npm run validate
```

`npm run build` validates the source and writes `dist/registry.json`. Subjects and
Marks are sorted by stable key, JSON formatting is fixed, and the UTF-8 file has one
trailing newline. Consumers calculate SHA-256 over those exact bytes.

Before publishing a candidate, compare it with the artifact from protected `main`:

```sh
npm run compatibility -- /path/to/published-registry.json
```

The compatibility gate rejects removed published identities, Mark subject/kind
mutation, and reactivation of deprecated identities. Metadata may evolve and active
identities may be deprecated.

The initial Registry schema version is `1`.

## Skill retrieval artifacts

Skill retrieval publication is split into three independent layers:

```text
registry/skill-retrieval/documents.json
registry/skill-retrieval/profiles/<profile-id>.json
registry/skill-retrieval/vectors/<profile-id>.json
```

The document source is provider-neutral. Every document binds one reviewed canonical
`*.skill.*` Mark to `title`, `retrieval_text`, `document_revision`,
`source_location`, and active status. A vector source is valid only for the exact
profile ID and fingerprint recorded in that file. Each vector repeats the canonical
key and source location and has a unique contiguous index.

Two isolated v1 contracts are checked in:

- `skill-rag-qwen-v1`: ModelScope Qwen3-Embedding-4B, 2560 dimensions; documents are
  plain retrieval text and queries use the versioned `Instruct`/`Query` renderer;
- `skill-rag-nvidia-v1`: NVIDIA Nemotron-3-Embed-1B, 2048 dimensions; documents use
  `input_type=passage`, queries use `input_type=query`, and both use
  `truncate=NONE`.

Both profiles record `model_identity_policy=hosted_alias`. This does not claim that
provider weights are immutable. Request contracts, profile fingerprints, and frozen
published document-vector bytes are immutable within a profile version. Regenerating
vectors or changing provider behavior requires a new profile version. Qwen vectors
must never be paired with an NVIDIA query, or vice versa.

For NVIDIA, the pinned tokenizer assets are hash-verified locally and every input must
fit the hosted 4096-token limit before any request is sent. Provider truncation and
arbitrary end truncation are forbidden. Current reviewed documents range from 278 to
3239 tokens and all 76 pass this gate.

When frozen vectors exist, `npm run build` writes one homogeneous artifact and manifest
per profile plus an explicit publication catalog:

```text
dist/skill-retrieval/<profile-id>.json
dist/skill-retrieval/<profile-id>.manifest.json
dist/skill-retrieval/index.json
```

The catalog lists only profiles with valid frozen vector sources; it does not choose an
active profile. The WQN application lock is the active-profile authority. Rebuilding
from the same frozen source is deterministic. Repeating a hosted provider request is
not expected to reproduce identical floating-point bytes.

Source locations such as `physics.jietijuexing2.teacher_tricks.2027#move-056` are
provenance only and must never become a second canonical identity.

### Canonical Skill chunk JSONL import

The reusable import contract is line-delimited JSON with
`format_version = wqn-skill-rag-clean-v1`. Each line is one immutable chunk and must
carry canonical `stable_key`, `chunk_key`, `chunk_index`, `retrieval_priority`,
`content`, and `content_sha256`, plus source/topic metadata. The importer:

- verifies every JSON line and content hash;
- requires canonical keys to agree with the reviewed `move_no`;
- checks contiguous chunk indexes and one consistent Skill identity per group;
- creates one canonical Registry Skill row per stable key;
- builds one retrieval document from chunks with `retrieval_priority >= 0.95`;
- excludes example chunks (`0.65`) from candidate embeddings while retaining them in
  the source JSONL for provenance and later evaluation;
- requires explicit expected source SHA-256, Skill count, chunk count, Subject, and
  source document ID, so a changed file cannot be silently imported.

Import the reviewed corpus into canonical Skills and the profile-neutral document
source:

```sh
npm run import:skill-chunks -- \
  --source /path/to/WQN_RAG_chunks.jsonl \
  --expected-source-sha256 <sha256> \
  --expected-skills <count> \
  --expected-chunks <count> \
  --subject physics \
  --source-document-id <source_doc_id>
```

The import never selects a provider and never writes vectors. Review both the canonical
Skill rows and `registry/skill-retrieval/documents.json` before embedding.

Run the protected NVIDIA preflight and offline embedding with:

```sh
npm run preflight:skill-docs -- \
  --documents registry/skill-retrieval/documents.json \
  --profile registry/skill-retrieval/profiles/skill-rag-nvidia-v1.json

NVIDIA_API_KEY=... npm run embed:skill-docs -- \
  registry/skill-retrieval/documents.json \
  registry/skill-retrieval/profiles/skill-rag-nvidia-v1.json \
  registry/skill-retrieval/vectors/skill-rag-nvidia-v1.json
npm run check
```

Use `MODELSCOPE_TOKEN` with the Qwen profile. The embedder chooses the credential name
from the validated provider protocol; callers cannot redirect it to an arbitrary
environment variable. Credentials, Authorization headers, and raw provider error bodies
are never written to Registry source, artifacts, manifests, browser code, or logs. No
partial vector file is published after a failed request.

## Runtime synchronization

The public runtime contract is the deterministic `dist/registry.json` artifact bound
to an exact Registry commit and its SHA-256. The source commit is provenance outside
the artifact bytes, so a documentation-only commit may retain the same content hash.
Production credentials and synchronization remain in the WQN application repository;
this repository never carries WQN or Supabase secrets. Registry synchronization and
WQN application deployment remain independent operations.

## License

GPL-3.0-only. The initial validator and Registry definitions were separated from
uncommitted work developed for Wrong-Question-Notebook and start here with independent
Git history.
