# Governance

## Authority and scope

The merged Registry is the canonical vocabulary authority. Runtime database rows are
projections of this repository and must not be edited as an independent taxonomy.

The Registry describes objective Problem semantics:

- what a Problem targets;
- what knowledge or skill it requires.

It does not describe a user's weakness, infer why an Attempt failed, or contain user
feedback. Canonical Subjects classify WQN's user-owned Subject containers many-to-one;
they do not replace those containers.

## Stable identity

A published Subject or Mark stable key is permanent.

- Never delete a published key.
- Never reuse a key for another meaning.
- Never change a Mark's subject or kind in place.
- To replace an identity, add a new key and set the old entry to `deprecated`.
- Display names, aliases, descriptions, and include/exclude guidance may evolve without
  changing identity when the underlying meaning is preserved.

Mark keys use `<subject>.<knowledge|skill>.<path>`. The only merged statuses are
`active` and `deprecated`; there is no `draft` status. Proposals remain outside the
merged Registry until reviewed.

## Hierarchy

A Mark may reference a parent only when the parent:

- exists in the same Registry revision;
- belongs to the same Canonical Subject;
- has the same `knowledge` or `skill` kind.

The parent graph must remain acyclic. Hierarchy is navigation and explanation, not a
license to transfer evidence between every ancestor and descendant.

## Review requirements

Every Registry change must:

1. pass `npm run check`;
2. preserve all published stable identities;
3. pass the historical compatibility check against the artifact from protected `main`;
4. use deprecation instead of deletion;
5. avoid inventing taxonomy entries without review;
6. contain no user data, Problem records, credentials, or deployment configuration.

Structural validation and historical compatibility are separate gates. The checkout
validator proves that one revision is internally valid. The compatibility gate proves
that it preserves published identities, keeps a Mark's subject/kind immutable, and
does not reactivate deprecated identities.

## Runtime boundary

WQN remains authoritative for Problems. Derived Problem-to-Mark relationships must not
block Problem edits. Runtime synchronization may update Canonical Subject and Mark
projections, but it must not rewrite user evidence or silently delete stable
identities.
