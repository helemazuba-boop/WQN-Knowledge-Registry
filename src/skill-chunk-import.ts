import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  type KnowledgeMarkDefinition,
  StableMarkKeySchema,
  StableSubjectKeySchema,
} from './schema.ts';

export const SKILL_CHUNK_FORMAT_VERSION = 'wqn-skill-rag-clean-v1' as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const NonBlankStringSchema = z.string().trim().min(1);
const NullableNonBlankStringSchema = NonBlankStringSchema.nullable();

export const SkillChunkSchema = z
  .object({
    format_version: z.literal(SKILL_CHUNK_FORMAT_VERSION),
    registry_kind: z.literal('skill'),
    subject: StableSubjectKeySchema,
    source_doc_id: NonBlankStringSchema,
    source_title: NonBlankStringSchema,
    source_page: NullableNonBlankStringSchema,
    topic_key: NonBlankStringSchema,
    topic: NonBlankStringSchema,
    stable_key: StableMarkKeySchema,
    skill_name: NonBlankStringSchema,
    move_no: z.number().int().positive(),
    chunk_key: NonBlankStringSchema,
    chunk_index: z.number().int().positive(),
    chunk_type: z.enum(['recognition', 'method', 'core', 'example']),
    section_title: NullableNonBlankStringSchema,
    retrieval_priority: z.number().min(0).max(1),
    visual_dependency: z.boolean(),
    content: NonBlankStringSchema,
    content_sha256: Sha256Schema,
  })
  .strict();

export type SkillChunk = z.infer<typeof SkillChunkSchema>;

export interface ImportedSkillDocument {
  stable_key: string;
  subject: string;
  title: string;
  retrieval_text: string;
  document_revision: number;
  source_location: string;
  status: 'active';
}

export interface SkillChunkImport {
  source_sha256: string;
  source_document_id: string;
  chunks: SkillChunk[];
  marks: KnowledgeMarkDefinition[];
  documents: ImportedSkillDocument[];
}

export interface SkillChunkImportPolicy {
  expectedSourceSha256?: string;
  expectedSkillCount?: number;
  expectedChunkCount?: number;
  expectedSubject?: string;
  expectedSourceDocumentId?: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function parseLines(serialized: string): SkillChunk[] {
  const chunks: SkillChunk[] = [];
  for (const [index, line] of serialized.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      chunks.push(SkillChunkSchema.parse(JSON.parse(line) as unknown));
    } catch (error) {
      throw new Error(`Invalid Skill chunk JSONL line ${index + 1}`, {
        cause: error,
      });
    }
  }
  if (chunks.length === 0) throw new Error('Skill chunk JSONL is empty');
  return chunks;
}

function validateChunk(chunks: SkillChunk[]): void {
  assertUnique(
    chunks.map((chunk) => chunk.chunk_key),
    'Skill chunk key'
  );

  for (const chunk of chunks) {
    if (sha256(chunk.content) !== chunk.content_sha256) {
      throw new Error(`Skill chunk content hash mismatch: ${chunk.chunk_key}`);
    }
    const expectedKey = `${chunk.stable_key}.chunk.${String(chunk.chunk_index).padStart(3, '0')}`;
    if (chunk.chunk_key !== expectedKey) {
      throw new Error(
        `Skill chunk key/index mismatch: ${chunk.chunk_key} != ${expectedKey}`
      );
    }
    if (
      chunk.stable_key !==
      `${chunk.subject}.skill.move.${String(chunk.move_no).padStart(3, '0')}`
    ) {
      throw new Error(
        `Skill stable key/move mismatch: ${chunk.stable_key} / ${chunk.move_no}`
      );
    }
  }
}

function groupChunks(chunks: SkillChunk[]): SkillChunk[][] {
  const groups = new Map<string, SkillChunk[]>();
  for (const chunk of chunks) {
    const group = groups.get(chunk.stable_key) ?? [];
    group.push(chunk);
    groups.set(chunk.stable_key, group);
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.sort((left, right) => left.chunk_index - right.chunk_index);
    const first = group[0];
    const identityFields: Array<keyof SkillChunk> = [
      'subject',
      'source_doc_id',
      'source_title',
      'topic_key',
      'topic',
      'stable_key',
      'skill_name',
      'move_no',
    ];
    for (const [index, chunk] of group.entries()) {
      if (chunk.chunk_index !== index + 1) {
        throw new Error(
          `Skill chunk indexes must be contiguous: ${first.stable_key}`
        );
      }
      for (const field of identityFields) {
        if (chunk[field] !== first[field]) {
          throw new Error(
            `Skill chunk identity mismatch for ${first.stable_key}: ${field}`
          );
        }
      }
    }
  }

  return result.sort((left, right) => {
    const moveDifference = left[0].move_no - right[0].move_no;
    return moveDifference !== 0
      ? moveDifference
      : left[0].stable_key.localeCompare(right[0].stable_key, 'en');
  });
}

function documentRevision(group: SkillChunk[]): number {
  const semanticInput = group
    .filter((chunk) => chunk.retrieval_priority >= 0.95)
    .map((chunk) => ({
      chunk_key: chunk.chunk_key,
      content_sha256: chunk.content_sha256,
      retrieval_priority: chunk.retrieval_priority,
    }));
  const prefix = sha256(JSON.stringify(semanticInput)).slice(0, 12);
  return Number.parseInt(prefix, 16);
}

export function importSkillChunkJsonl(serialized: string): SkillChunkImport {
  const chunks = parseLines(serialized);
  validateChunk(chunks);
  const groups = groupChunks(chunks);
  const sourceDocumentIds = new Set(chunks.map((chunk) => chunk.source_doc_id));
  if (sourceDocumentIds.size !== 1) {
    throw new Error(
      'One Skill chunk JSONL file must contain one source_doc_id'
    );
  }

  const marks: KnowledgeMarkDefinition[] = [];
  const documents: ImportedSkillDocument[] = [];
  for (const group of groups) {
    const first = group[0];
    const retrievalChunks = group.filter(
      (chunk) => chunk.retrieval_priority >= 0.95
    );
    if (retrievalChunks.length === 0) {
      throw new Error(`Skill has no retrieval chunks: ${first.stable_key}`);
    }

    marks.push({
      stable_key: first.stable_key,
      name: first.skill_name,
      kind: 'skill',
      subject: first.subject,
      aliases: [],
      include: retrievalChunks
        .filter((chunk) => chunk.chunk_type === 'recognition')
        .map((chunk) => chunk.content),
      exclude: [],
      status: 'active',
    });
    documents.push({
      stable_key: first.stable_key,
      subject: first.subject,
      title: first.skill_name,
      retrieval_text: retrievalChunks
        .map((chunk) => chunk.content)
        .join('\n\n'),
      document_revision: documentRevision(group),
      source_location: `${first.source_doc_id}#move-${String(first.move_no).padStart(3, '0')}`,
      status: 'active',
    });
  }

  return {
    source_sha256: sha256(serialized),
    source_document_id: [...sourceDocumentIds][0],
    chunks,
    marks,
    documents,
  };
}

export function assertSkillChunkImportPolicy(
  imported: SkillChunkImport,
  policy: SkillChunkImportPolicy
): void {
  const checks: Array<[boolean, string]> = [
    [
      policy.expectedSourceSha256 === undefined ||
        imported.source_sha256 === policy.expectedSourceSha256,
      'Skill chunk source SHA-256 does not match the reviewed import policy',
    ],
    [
      policy.expectedSkillCount === undefined ||
        imported.marks.length === policy.expectedSkillCount,
      'Skill count does not match the reviewed import policy',
    ],
    [
      policy.expectedChunkCount === undefined ||
        imported.chunks.length === policy.expectedChunkCount,
      'Skill chunk count does not match the reviewed import policy',
    ],
    [
      policy.expectedSubject === undefined ||
        imported.marks.every((mark) => mark.subject === policy.expectedSubject),
      'Skill Subject does not match the reviewed import policy',
    ],
    [
      policy.expectedSourceDocumentId === undefined ||
        imported.source_document_id === policy.expectedSourceDocumentId,
      'Skill source document does not match the reviewed import policy',
    ],
  ];
  for (const [valid, message] of checks) {
    if (!valid) throw new Error(message);
  }
}

export async function importSkillChunkJsonlFile(
  filePath: string
): Promise<SkillChunkImport> {
  return importSkillChunkJsonl(await readFile(filePath, 'utf8'));
}
