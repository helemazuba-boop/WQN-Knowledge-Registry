import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSkillRetrievalArtifacts,
  buildSkillRetrievalProfileArtifact,
} from '../src/skill-retrieval-files.ts';
import { validateKnowledgeRegistry } from '../src/registry.ts';
import type { RegistryMarkFile } from '../src/schema.ts';
import { canonicalJson, sha256 } from '../src/skill-retrieval.ts';
import { skillEmbeddingProfileFingerprint } from '../src/skill-retrieval-profile.ts';

const subjects = [
  { stable_key: 'physics', name: '物理', aliases: [], status: 'active' },
];
const skill = {
  stable_key: 'physics.skill.force_decomposition',
  name: '正交分解',
  kind: 'skill',
  subject: 'physics',
  aliases: [],
  include: [],
  exclude: [],
  status: 'active',
};
const files: RegistryMarkFile[] = [
  { subject: 'physics', kind: 'knowledge', value: [] },
  { subject: 'physics', kind: 'skill', value: [skill] },
];
const registry = validateKnowledgeRegistry(subjects, files);

function profile() {
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

function sources() {
  const rows = [
    {
      stable_key: skill.stable_key,
      subject: 'physics',
      title: skill.name,
      retrieval_text: '专题\n正交分解\n沿合适方向分解力。',
      document_revision: 1,
      source_location: 'physics-move-001',
      status: 'active',
    },
  ];
  const documents = {
    format_version: 'wqn-skill-retrieval-documents-v1',
    source_corpus_sha256: 'a'.repeat(64),
    source_documents_sha256: sha256(canonicalJson(rows)),
    source_document_id: 'physics.reviewed.v1',
    documents: rows,
  };
  const vectorRows = [
    {
      index: 0,
      stable_key: skill.stable_key,
      source_location: 'physics-move-001',
      vector: Array.from({ length: 2560 }, (_value, index) =>
        index === 0 ? 1 : 0
      ),
    },
  ];
  const fingerprint = skillEmbeddingProfileFingerprint(profile());
  const vectorsHash = sha256(canonicalJson(vectorRows));
  const vectors = {
    format_version: 'wqn-skill-retrieval-vectors-v1',
    source_corpus_sha256: documents.source_corpus_sha256,
    source_documents_sha256: documents.source_documents_sha256,
    profile_id: profile().profile_id,
    profile_fingerprint: fingerprint,
    source_vectors_sha256: vectorsHash,
    source_vector_cache_key: sha256(
      canonicalJson({
        profile_fingerprint: fingerprint,
        source_documents_sha256: documents.source_documents_sha256,
        source_vectors_sha256: vectorsHash,
      })
    ),
    vectors: vectorRows,
  };
  return { documents, vectors };
}

async function writeSources(
  root: string,
  includeVectors: boolean
): Promise<{
  documentsPath: string;
  profilesDir: string;
  vectorsDir: string;
}> {
  const documentsPath = path.join(root, 'documents.json');
  const profilesDir = path.join(root, 'profiles');
  const vectorsDir = path.join(root, 'vectors');
  await Promise.all([
    import('node:fs/promises').then(({ mkdir }) =>
      Promise.all([
        mkdir(profilesDir, { recursive: true }),
        mkdir(vectorsDir, { recursive: true }),
      ])
    ),
    writeFile(
      documentsPath,
      `${JSON.stringify(sources().documents)}\n`,
      'utf8'
    ),
  ]);
  await writeFile(
    path.join(profilesDir, 'skill-rag-qwen-v1.json'),
    `${JSON.stringify(profile())}\n`,
    'utf8'
  );
  if (includeVectors) {
    await writeFile(
      path.join(vectorsDir, 'skill-rag-qwen-v1.json'),
      `${JSON.stringify(sources().vectors)}\n`,
      'utf8'
    );
  }
  return { documentsPath, profilesDir, vectorsDir };
}

describe('Skill retrieval artifact files', () => {
  it('publishes only profiles with frozen vector sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wqn-skill-artifact-'));
    try {
      const options = await writeSources(root, false);
      const outputDir = path.join(root, 'dist');
      await expect(
        buildSkillRetrievalProfileArtifact(
          registry,
          'skill-rag-qwen-v1',
          outputDir,
          options
        )
      ).resolves.toBeNull();
      const index = await buildSkillRetrievalArtifacts(
        registry,
        ['skill-rag-qwen-v1'],
        outputDir,
        options
      );
      expect(index.profiles).toEqual([]);
      expect(
        JSON.parse(await readFile(path.join(outputDir, 'index.json'), 'utf8'))
      ).toEqual({ schema_version: 1, profiles: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes profile artifact, manifest, and explicit catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wqn-skill-artifact-'));
    try {
      const options = await writeSources(root, true);
      const outputDir = path.join(root, 'dist');
      const index = await buildSkillRetrievalArtifacts(
        registry,
        ['skill-rag-qwen-v1'],
        outputDir,
        options
      );
      expect(index.profiles).toHaveLength(1);
      const entry = index.profiles[0];
      expect(entry).toMatchObject({
        profile_id: 'skill-rag-qwen-v1',
        artifact: 'skill-retrieval/skill-rag-qwen-v1.json',
        manifest: 'skill-retrieval/skill-rag-qwen-v1.manifest.json',
        dimension: 2560,
        document_count: 1,
      });
      expect(
        JSON.parse(
          await readFile(path.join(outputDir, 'skill-rag-qwen-v1.json'), 'utf8')
        )
      ).toMatchObject({
        profile_id: 'skill-rag-qwen-v1',
        documents: [{ stable_key: skill.stable_key }],
      });
      expect(
        JSON.parse(
          await readFile(
            path.join(outputDir, 'skill-rag-qwen-v1.manifest.json'),
            'utf8'
          )
        )
      ).toMatchObject({ artifact_sha256: entry.artifact_sha256 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
