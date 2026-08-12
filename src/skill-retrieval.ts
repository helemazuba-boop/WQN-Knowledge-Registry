import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  SkillEmbeddingProfileSchema,
  skillEmbeddingProfileFingerprint,
  type SkillEmbeddingProfile,
} from './skill-retrieval-profile.ts';
import {
  RegistryStatusSchema,
  StableMarkKeySchema,
  StableSubjectKeySchema,
  type KnowledgeRegistry,
} from './schema.ts';

export const SKILL_RETRIEVAL_SCHEMA_VERSION = 1 as const;

const NonBlankStringSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const SkillRetrievalDocumentSchema = z
  .object({
    stable_key: StableMarkKeySchema,
    subject: StableSubjectKeySchema,
    title: NonBlankStringSchema,
    retrieval_text: NonBlankStringSchema,
    document_revision: z.number().int().positive(),
    source_location: NonBlankStringSchema,
    status: RegistryStatusSchema,
  })
  .strict();

export const SkillRetrievalDocumentsSourceSchema = z
  .object({
    format_version: z.literal('wqn-skill-retrieval-documents-v1'),
    source_corpus_sha256: Sha256Schema,
    source_documents_sha256: Sha256Schema,
    source_document_id: NonBlankStringSchema,
    documents: z.array(SkillRetrievalDocumentSchema),
  })
  .strict();

export const SkillRetrievalVectorSchema = z
  .object({
    index: z.number().int().nonnegative(),
    stable_key: StableMarkKeySchema,
    source_location: NonBlankStringSchema,
    vector: z.array(z.number().finite()),
  })
  .strict();

export const SkillRetrievalVectorSourceSchema = z
  .object({
    format_version: z.literal('wqn-skill-retrieval-vectors-v1'),
    source_corpus_sha256: Sha256Schema,
    source_documents_sha256: Sha256Schema,
    profile_id: NonBlankStringSchema,
    profile_fingerprint: RevisionSchema,
    source_vectors_sha256: Sha256Schema,
    source_vector_cache_key: Sha256Schema,
    vectors: z.array(SkillRetrievalVectorSchema),
  })
  .strict();

const SkillRetrievalArtifactDocumentSchema =
  SkillRetrievalDocumentSchema.extend({
    vector: z.array(z.number().finite()),
  }).strict();

export const SkillRetrievalArtifactSchema = z
  .object({
    schema_version: z.literal(SKILL_RETRIEVAL_SCHEMA_VERSION),
    profile_id: NonBlankStringSchema,
    profile_fingerprint: RevisionSchema,
    source_corpus_sha256: Sha256Schema,
    source_documents_sha256: Sha256Schema,
    source_vectors_sha256: Sha256Schema,
    source_vector_cache_key: Sha256Schema,
    embedding_profile: SkillEmbeddingProfileSchema,
    documents: z.array(SkillRetrievalArtifactDocumentSchema),
  })
  .strict();

export const SkillRetrievalManifestSchema = z
  .object({
    schema_version: z.literal(SKILL_RETRIEVAL_SCHEMA_VERSION),
    representation_revision: RevisionSchema,
    artifact: NonBlankStringSchema,
    artifact_sha256: Sha256Schema,
    profile_id: NonBlankStringSchema,
    profile_fingerprint: RevisionSchema,
    provider_protocol: NonBlankStringSchema,
    provider: NonBlankStringSchema,
    model: NonBlankStringSchema,
    model_identity_policy: z.enum(['hosted_alias', 'immutable_revision']),
    model_identity: NonBlankStringSchema,
    dimension: z.number().int().positive(),
    normalization: z.literal('l2'),
    source_corpus_sha256: Sha256Schema,
    source_documents_sha256: Sha256Schema,
    source_vectors_sha256: Sha256Schema,
    source_vector_cache_key: Sha256Schema,
    documents_sha256: Sha256Schema,
    vectors_sha256: Sha256Schema,
    document_count: z.number().int().nonnegative(),
  })
  .strict();

export const SkillRetrievalIndexSchema = z
  .object({
    schema_version: z.literal(SKILL_RETRIEVAL_SCHEMA_VERSION),
    profiles: z.array(
      z
        .object({
          profile_id: NonBlankStringSchema,
          profile_fingerprint: RevisionSchema,
          representation_revision: RevisionSchema,
          artifact: NonBlankStringSchema,
          artifact_sha256: Sha256Schema,
          manifest: NonBlankStringSchema,
          manifest_sha256: Sha256Schema,
          dimension: z.number().int().positive(),
          document_count: z.number().int().nonnegative(),
        })
        .strict()
    ),
  })
  .strict();

export type SkillRetrievalDocument = z.infer<
  typeof SkillRetrievalDocumentSchema
>;
export type SkillRetrievalDocumentsSource = z.infer<
  typeof SkillRetrievalDocumentsSourceSchema
>;
export type SkillRetrievalVector = z.infer<typeof SkillRetrievalVectorSchema>;
export type SkillRetrievalVectorSource = z.infer<
  typeof SkillRetrievalVectorSourceSchema
>;
export type SkillRetrievalArtifact = z.infer<
  typeof SkillRetrievalArtifactSchema
>;
export type SkillRetrievalManifest = z.infer<
  typeof SkillRetrievalManifestSchema
>;
export type SkillRetrievalIndex = z.infer<typeof SkillRetrievalIndexSchema>;

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertNormalized(vector: number[], stableKey: string): void {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-4) {
    throw new Error(`Skill vector must be L2-normalized: ${stableKey}`);
  }
}

export function parseSkillRetrievalDocumentsSource(
  value: unknown
): SkillRetrievalDocumentsSource {
  const source = SkillRetrievalDocumentsSourceSchema.parse(value);
  assertUnique(
    source.documents.map((document) => document.stable_key),
    'Skill retrieval document key'
  );
  const sortedKeys = [...source.documents]
    .map((document) => document.stable_key)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (
    source.documents.some(
      (document, index) => document.stable_key !== sortedKeys[index]
    )
  ) {
    throw new Error(
      'Skill retrieval documents must be sorted by canonical key'
    );
  }
  const expectedHash = sha256(canonicalJson(source.documents));
  if (source.source_documents_sha256 !== expectedHash) {
    throw new Error('Skill retrieval documents hash mismatch');
  }
  return source;
}

export function createSkillRetrievalArtifact(
  registry: KnowledgeRegistry,
  documentsValue: unknown,
  profileValue: unknown,
  vectorsValue: unknown
): SkillRetrievalArtifact {
  const documentSource = parseSkillRetrievalDocumentsSource(documentsValue);
  const profile = SkillEmbeddingProfileSchema.parse(profileValue);
  const vectorSource = SkillRetrievalVectorSourceSchema.parse(vectorsValue);
  const profileFingerprint = skillEmbeddingProfileFingerprint(profile);

  if (
    vectorSource.profile_id !== profile.profile_id ||
    vectorSource.profile_fingerprint !== profileFingerprint
  ) {
    throw new Error('Skill vector source profile mismatch');
  }
  if (
    vectorSource.source_corpus_sha256 !== documentSource.source_corpus_sha256 ||
    vectorSource.source_documents_sha256 !==
      documentSource.source_documents_sha256
  ) {
    throw new Error('Skill vector source corpus mismatch');
  }

  const sortedVectors = [...vectorSource.vectors].sort(
    (left, right) => left.index - right.index
  );
  if (sortedVectors.length !== documentSource.documents.length) {
    throw new Error('Skill vector count must match retrieval document count');
  }
  for (const [index, entry] of sortedVectors.entries()) {
    if (entry.index !== index) {
      throw new Error('Skill vector indexes must be unique and contiguous');
    }
  }
  assertUnique(
    sortedVectors.map((entry) => entry.stable_key),
    'Skill retrieval vector key'
  );
  const expectedVectorsHash = sha256(canonicalJson(sortedVectors));
  if (vectorSource.source_vectors_sha256 !== expectedVectorsHash) {
    throw new Error('Skill retrieval vectors hash mismatch');
  }

  const marks = new Map(registry.marks.map((mark) => [mark.stable_key, mark]));
  const vectors = new Map(
    sortedVectors.map((entry) => [entry.stable_key, entry])
  );
  const documentKeys = new Set(
    documentSource.documents.map((document) => document.stable_key)
  );
  for (const key of vectors.keys()) {
    if (!documentKeys.has(key)) {
      throw new Error(`Skill vector has no retrieval document: ${key}`);
    }
  }

  const documents = documentSource.documents
    .map((document) => {
      const mark = marks.get(document.stable_key);
      if (!mark) {
        throw new Error(
          `Skill retrieval document references missing Mark: ${document.stable_key}`
        );
      }
      if (mark.kind !== 'skill') {
        throw new Error(
          `Skill retrieval document references non-Skill Mark: ${document.stable_key}`
        );
      }
      if (mark.status !== 'active' || document.status !== 'active') {
        throw new Error(
          `Skill retrieval document must reference an active Mark: ${document.stable_key}`
        );
      }
      if (mark.subject !== document.subject) {
        throw new Error(
          `Skill retrieval document mismatches canonical Mark subject: ${document.stable_key}`
        );
      }
      const vectorEntry = vectors.get(document.stable_key);
      if (!vectorEntry) {
        throw new Error(
          `Skill retrieval document has no vector: ${document.stable_key}`
        );
      }
      if (vectorEntry.source_location !== document.source_location) {
        throw new Error(
          `Skill vector source location mismatches document: ${document.stable_key}`
        );
      }
      if (vectorEntry.vector.length !== profile.dimension) {
        throw new Error(
          `Skill vector dimension mismatch for ${document.stable_key}: ` +
            `${vectorEntry.vector.length} != ${profile.dimension}`
        );
      }
      assertNormalized(vectorEntry.vector, document.stable_key);
      return { ...document, vector: vectorEntry.vector };
    })
    .sort((left, right) =>
      left.stable_key.localeCompare(right.stable_key, 'en')
    );

  const cacheIdentity = {
    profile_fingerprint: profileFingerprint,
    source_documents_sha256: documentSource.source_documents_sha256,
    source_vectors_sha256: vectorSource.source_vectors_sha256,
  };
  const expectedCacheKey = sha256(canonicalJson(cacheIdentity));
  if (vectorSource.source_vector_cache_key !== expectedCacheKey) {
    throw new Error('Skill vector cache key mismatch');
  }

  return SkillRetrievalArtifactSchema.parse({
    schema_version: SKILL_RETRIEVAL_SCHEMA_VERSION,
    profile_id: profile.profile_id,
    profile_fingerprint: profileFingerprint,
    source_corpus_sha256: documentSource.source_corpus_sha256,
    source_documents_sha256: documentSource.source_documents_sha256,
    source_vectors_sha256: vectorSource.source_vectors_sha256,
    source_vector_cache_key: vectorSource.source_vector_cache_key,
    embedding_profile: profile,
    documents,
  });
}

export function parseSkillRetrievalArtifact(
  value: unknown
): SkillRetrievalArtifact {
  const artifact = SkillRetrievalArtifactSchema.parse(value);
  if (
    artifact.profile_fingerprint !==
    skillEmbeddingProfileFingerprint(artifact.embedding_profile)
  ) {
    throw new Error('Skill retrieval artifact profile fingerprint mismatch');
  }
  assertUnique(
    artifact.documents.map((document) => document.stable_key),
    'Skill retrieval artifact key'
  );
  for (const document of artifact.documents) {
    if (document.vector.length !== artifact.embedding_profile.dimension) {
      throw new Error(
        `Skill vector dimension mismatch for ${document.stable_key}`
      );
    }
    assertNormalized(document.vector, document.stable_key);
  }
  return artifact;
}

export function serializeSkillRetrievalArtifact(
  artifact: SkillRetrievalArtifact
): string {
  return prettyJson(parseSkillRetrievalArtifact(artifact));
}

export function createSkillRetrievalManifest(
  serializedArtifact: string,
  artifactPath: string
): SkillRetrievalManifest {
  const artifact = parseSkillRetrievalArtifact(
    JSON.parse(serializedArtifact) as unknown
  );
  const artifactSha256 = sha256(serializedArtifact);
  const documents = artifact.documents.map(
    ({ vector: _vector, ...document }) => document
  );
  const vectors = artifact.documents.map(({ stable_key, vector }, index) => ({
    index,
    stable_key,
    vector,
  }));
  const profile = artifact.embedding_profile;

  return SkillRetrievalManifestSchema.parse({
    schema_version: SKILL_RETRIEVAL_SCHEMA_VERSION,
    representation_revision: `sha256:${artifactSha256}`,
    artifact: artifactPath,
    artifact_sha256: artifactSha256,
    profile_id: artifact.profile_id,
    profile_fingerprint: artifact.profile_fingerprint,
    provider_protocol: profile.provider_protocol,
    provider: profile.provider,
    model: profile.model,
    model_identity_policy: profile.model_identity_policy,
    model_identity: profile.model_identity,
    dimension: profile.dimension,
    normalization: profile.normalization,
    source_corpus_sha256: artifact.source_corpus_sha256,
    source_documents_sha256: artifact.source_documents_sha256,
    source_vectors_sha256: artifact.source_vectors_sha256,
    source_vector_cache_key: artifact.source_vector_cache_key,
    documents_sha256: sha256(canonicalJson(documents)),
    vectors_sha256: sha256(canonicalJson(vectors)),
    document_count: artifact.documents.length,
  });
}

export function serializeSkillRetrievalManifest(
  manifest: SkillRetrievalManifest
): string {
  return prettyJson(SkillRetrievalManifestSchema.parse(manifest));
}

export function assertSkillRetrievalManifest(
  serializedArtifact: string,
  manifestValue: unknown
): SkillRetrievalManifest {
  const manifest = SkillRetrievalManifestSchema.parse(manifestValue);
  const expected = createSkillRetrievalManifest(
    serializedArtifact,
    manifest.artifact
  );
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
    throw new Error('Skill retrieval manifest does not match artifact bytes');
  }
  return manifest;
}

export function serializeSkillRetrievalIndex(
  index: SkillRetrievalIndex
): string {
  const parsed = SkillRetrievalIndexSchema.parse({
    ...index,
    profiles: [...index.profiles].sort((left, right) =>
      left.profile_id.localeCompare(right.profile_id, 'en')
    ),
  });
  assertUnique(
    parsed.profiles.map((profile) => profile.profile_id),
    'Skill retrieval index profile'
  );
  return prettyJson(parsed);
}

export { SkillEmbeddingProfileSchema, skillEmbeddingProfileFingerprint };
export type { SkillEmbeddingProfile };
