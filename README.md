# WQN Knowledge Registry

WQN 的 Canonical Subject、Knowledge Mark 与 Skill Mark 事实源。

This repository is the source of truth for WQN's canonical learning vocabulary.
The WQN Supabase database is a runtime projection, not an independently editable
authority.

## Repository scope

This repository owns:

- canonical Subject definitions;
- canonical Knowledge and Skill Mark definitions;
- stable-key and parent-graph validation;
- deterministic `dist/registry.json` artifact generation;
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
