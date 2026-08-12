import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateKnowledgeRegistry } from '../src/registry.ts';
import type { RegistryMarkFile } from '../src/schema.ts';
import {
  assertSkillRetrievalManifest,
  canonicalJson,
  createSkillRetrievalArtifact,
  createSkillRetrievalManifest,
  parseSkillRetrievalArtifact,
  serializeSkillRetrievalArtifact,
  serializeSkillRetrievalManifest,
  sha256,
} from '../src/skill-retrieval.ts';
import {
  embeddingRequestBody,
  skillEmbeddingProfileFingerprint,
} from '../src/skill-retrieval-profile.ts';

const subjects = [
  { stable_key: 'physics', name: '物理', aliases: [], status: 'active' },
];

function mark(
  stableKey: string,
  kind: 'knowledge' | 'skill' = 'skill',
  status: 'active' | 'deprecated' = 'active'
) {
  return {
    stable_key: stableKey,
    name: stableKey,
    kind,
    subject: 'physics',
    aliases: [],
    include: [],
    exclude: [],
    status,
  };
}

function registry(
  knowledge: unknown[] = [],
  skills: unknown[] = [
    mark('physics.skill.force_decomposition'),
    mark('physics.skill.limit_reasoning'),
  ]
) {
  const files: RegistryMarkFile[] = [
    { subject: 'physics', kind: 'knowledge', value: knowledge },
    { subject: 'physics', kind: 'skill', value: skills },
  ];
  return validateKnowledgeRegistry(subjects, files);
}

function qwenProfile() {
  return {
    profile_id: 'skill-rag-qwen-v1',
    provider_protocol: 'qwen-instruct-query-v1',
    provider: 'modelscope',
    endpoint: 'https://example.com/v1/embeddings',
    model: 'Qwen/Qwen3-Embedding-4B',
    model_identity_policy: 'hosted_alias',
    model_identity: 'Qwen/Qwen3-Embedding-4B',
    dimension: 2560,
    encoding_format: 'float',
    normalization: 'l2',
    document_contract: { input_transform: 'plain' },
    query_contract: {
      input_transform: 'instruct-query',
      instruction: 'Retrieve the relevant skill.',
    },
    document_template_version: 'skill-doc-v1',
    query_template_version: 'skill-query-v1',
    tokenizer: null,
  };
}

function nvidiaProfile() {
  return {
    profile_id: 'skill-rag-nvidia-v1',
    provider_protocol: 'nvidia-query-passage-v1',
    provider: 'nvidia',
    endpoint: 'https://integrate.api.nvidia.com/v1/embeddings',
    model: 'nvidia/nemotron-3-embed-1b',
    model_identity_policy: 'hosted_alias',
    model_identity: 'nvidia/nemotron-3-embed-1b',
    dimension: 2048,
    encoding_format: 'float',
    normalization: 'l2',
    document_contract: { input_type: 'passage', truncate: 'NONE' },
    query_contract: { input_type: 'query', truncate: 'NONE' },
    document_template_version: 'skill-doc-v1',
    query_template_version: 'skill-query-v1',
    tokenizer: {
      repository: 'nvidia/Nemotron-3-Embed-1B-BF16',
      revision: 'f880174635613cff04033875fc6a69296cb72006',
      files: [{ path: 'tokenizer.json', sha256: 'a'.repeat(64) }],
      max_tokens: 4096,
      trust_remote_code: false,
    },
  };
}

function documents() {
  const rows = [
    {
      stable_key: 'physics.skill.force_decomposition',
      subject: 'physics',
      title: '正交分解',
      retrieval_text: '专题\n正交分解\n沿合适方向分解力。',
      document_revision: 1,
      source_location: 'physics-move-001',
      status: 'active',
    },
    {
      stable_key: 'physics.skill.limit_reasoning',
      subject: 'physics',
      title: '极限思维',
      retrieval_text: '专题\n极限思维\n分析边界条件。',
      document_revision: 1,
      source_location: 'physics-move-002',
      status: 'active',
    },
  ];
  return {
    format_version: 'wqn-skill-retrieval-documents-v1',
    source_corpus_sha256: 'a'.repeat(64),
    source_documents_sha256: sha256(canonicalJson(rows)),
    source_document_id: 'physics.reviewed.v1',
    documents: rows,
  };
}

function unitVector(dimension: number, position: number): number[] {
  return Array.from({ length: dimension }, (_value, index) =>
    index === position ? 1 : 0
  );
}

function vectors(
  profile = qwenProfile(),
  rows = [
    {
      index: 0,
      stable_key: 'physics.skill.force_decomposition',
      source_location: 'physics-move-001',
      vector: unitVector(profile.dimension, 0),
    },
    {
      index: 1,
      stable_key: 'physics.skill.limit_reasoning',
      source_location: 'physics-move-002',
      vector: unitVector(profile.dimension, 1),
    },
  ]
) {
  const fingerprint = skillEmbeddingProfileFingerprint(profile);
  const sourceVectorsSha256 = sha256(canonicalJson(rows));
  return {
    format_version: 'wqn-skill-retrieval-vectors-v1',
    source_corpus_sha256: documents().source_corpus_sha256,
    source_documents_sha256: documents().source_documents_sha256,
    profile_id: profile.profile_id,
    profile_fingerprint: fingerprint,
    source_vectors_sha256: sourceVectorsSha256,
    source_vector_cache_key: sha256(
      canonicalJson({
        profile_fingerprint: fingerprint,
        source_documents_sha256: documents().source_documents_sha256,
        source_vectors_sha256: sourceVectorsSha256,
      })
    ),
    vectors: rows,
  };
}

describe('Skill retrieval profiles', () => {
  it('renders provider- and role-specific request bodies', () => {
    expect(
      embeddingRequestBody(qwenProfile(), ['原始文本'], 'document')
    ).toEqual({
      model: 'Qwen/Qwen3-Embedding-4B',
      input: ['原始文本'],
      encoding_format: 'float',
    });
    expect(embeddingRequestBody(qwenProfile(), ['题面'], 'query')).toEqual({
      model: 'Qwen/Qwen3-Embedding-4B',
      input: ['Instruct: Retrieve the relevant skill.\nQuery: 题面'],
      encoding_format: 'float',
    });
    expect(
      embeddingRequestBody(nvidiaProfile(), ['原始文本'], 'document')
    ).toMatchObject({ input_type: 'passage', truncate: 'NONE' });
    expect(
      embeddingRequestBody(nvidiaProfile(), ['题面'], 'query')
    ).toMatchObject({ input_type: 'query', truncate: 'NONE' });
  });

  it('validates hosted aliases without claiming immutable identity', () => {
    expect(() =>
      skillEmbeddingProfileFingerprint({
        ...qwenProfile(),
        model_identity_policy: 'immutable_revision',
        model_identity: 'Qwen/Qwen3-Embedding-4B',
      })
    ).toThrow(/pinned 40-hex revision/);
    expect(() =>
      skillEmbeddingProfileFingerprint({
        ...qwenProfile(),
        model_identity_policy: 'immutable_revision',
        model_identity: `git:${'1'.repeat(40)}`,
      })
    ).not.toThrow();
    expect(() =>
      skillEmbeddingProfileFingerprint({
        ...nvidiaProfile(),
        tokenizer: { ...nvidiaProfile().tokenizer, revision: 'main' },
      })
    ).toThrow(/tokenizer requires a pinned 40-hex revision/);
  });
});

describe('Skill retrieval artifact', () => {
  it('builds deterministic canonical-key-sorted bytes and manifest hashes', () => {
    const first = serializeSkillRetrievalArtifact(
      createSkillRetrievalArtifact(
        registry(),
        documents(),
        qwenProfile(),
        vectors()
      )
    );
    const second = serializeSkillRetrievalArtifact(
      createSkillRetrievalArtifact(
        registry(),
        documents(),
        qwenProfile(),
        vectors()
      )
    );

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    const manifest = createSkillRetrievalManifest(
      first,
      'skill-retrieval/skill-rag-qwen-v1.json'
    );
    expect(manifest).toMatchObject({
      representation_revision: `sha256:${createHash('sha256')
        .update(first, 'utf8')
        .digest('hex')}`,
      artifact: 'skill-retrieval/skill-rag-qwen-v1.json',
      profile_id: 'skill-rag-qwen-v1',
      dimension: 2560,
      document_count: 2,
    });
    expect(serializeSkillRetrievalManifest(manifest)).toContain(
      '"document_count": 2'
    );
    expect(() => assertSkillRetrievalManifest(first, manifest)).not.toThrow();
    expect(() =>
      assertSkillRetrievalManifest(first, {
        ...manifest,
        artifact_sha256: '0'.repeat(64),
      })
    ).toThrow(/does not match artifact bytes/);
  });

  it('rejects cross-profile vectors', () => {
    expect(() =>
      createSkillRetrievalArtifact(
        registry(),
        documents(),
        nvidiaProfile(),
        vectors(qwenProfile())
      )
    ).toThrow(/profile mismatch/);
  });

  it('requires every document key to be a canonical Skill', () => {
    const invalidDocuments = documents();
    invalidDocuments.documents[0] = {
      ...invalidDocuments.documents[0],
      stable_key: 'physics.skill.a_unreviewed',
    };
    invalidDocuments.source_documents_sha256 = sha256(
      canonicalJson(invalidDocuments.documents)
    );
    const invalidVectors = vectors(
      qwenProfile(),
      vectors().vectors.map((entry) =>
        entry.index === 0
          ? { ...entry, stable_key: 'physics.skill.a_unreviewed' }
          : entry
      )
    );
    invalidVectors.source_documents_sha256 =
      invalidDocuments.source_documents_sha256;
    invalidVectors.source_vector_cache_key = sha256(
      canonicalJson({
        profile_fingerprint: invalidVectors.profile_fingerprint,
        source_documents_sha256: invalidDocuments.source_documents_sha256,
        source_vectors_sha256: invalidVectors.source_vectors_sha256,
      })
    );
    expect(() =>
      createSkillRetrievalArtifact(
        registry(),
        invalidDocuments,
        qwenProfile(),
        invalidVectors
      )
    ).toThrow(/missing Mark/);
  });

  it.each([
    [
      'missing vector',
      vectors(qwenProfile(), [vectors().vectors[0]]),
      /vector count must match|has no vector|indexes must be unique and contiguous/,
    ],
    [
      'wrong dimension',
      vectors(
        qwenProfile(),
        vectors().vectors.map((entry) => ({ ...entry, vector: [1] }))
      ),
      /dimension mismatch/,
    ],
    [
      'non-normalized vector',
      vectors(
        qwenProfile(),
        vectors().vectors.map((entry) => ({
          ...entry,
          vector: entry.vector.map((value) => value * 2),
        }))
      ),
      /L2-normalized/,
    ],
  ])('rejects %s', (_label, invalidVectors, expected) => {
    expect(() =>
      createSkillRetrievalArtifact(
        registry(),
        documents(),
        qwenProfile(),
        invalidVectors
      )
    ).toThrow(expected);
  });

  it('rejects malformed runtime artifact vectors', () => {
    const artifact = createSkillRetrievalArtifact(
      registry(),
      documents(),
      qwenProfile(),
      vectors()
    );
    expect(() =>
      parseSkillRetrievalArtifact({
        ...artifact,
        documents: artifact.documents.map((document) => ({
          ...document,
          vector: [2, 0],
        })),
      })
    ).toThrow(/dimension mismatch|L2-normalized/);
  });
});
