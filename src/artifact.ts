import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CanonicalSubjectSchema,
  KNOWLEDGE_REGISTRY_SCHEMA_VERSION,
  KnowledgeMarkSchema,
  type KnowledgeRegistry,
} from './schema.ts';

export const KnowledgeRegistryArtifactSchema = z
  .object({
    schema_version: z.literal(KNOWLEDGE_REGISTRY_SCHEMA_VERSION),
    subjects: z.array(CanonicalSubjectSchema),
    marks: z.array(KnowledgeMarkSchema),
  })
  .strict();

export type KnowledgeRegistryArtifact = z.infer<
  typeof KnowledgeRegistryArtifactSchema
>;

export function createKnowledgeRegistryArtifact(
  registry: KnowledgeRegistry
): KnowledgeRegistryArtifact {
  return KnowledgeRegistryArtifactSchema.parse({
    schema_version: KNOWLEDGE_REGISTRY_SCHEMA_VERSION,
    subjects: [...registry.subjects].sort((left, right) =>
      left.stable_key.localeCompare(right.stable_key, 'en')
    ),
    marks: [...registry.marks].sort((left, right) =>
      left.stable_key.localeCompare(right.stable_key, 'en')
    ),
  });
}

export function parseKnowledgeRegistryArtifact(
  value: unknown
): KnowledgeRegistryArtifact {
  return KnowledgeRegistryArtifactSchema.parse(value);
}

export function serializeKnowledgeRegistryArtifact(
  artifact: KnowledgeRegistryArtifact
): string {
  const parsed = KnowledgeRegistryArtifactSchema.parse(artifact);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function hashKnowledgeRegistryArtifact(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

export function assertKnowledgeRegistryCompatibility(
  baseline: KnowledgeRegistryArtifact,
  candidate: KnowledgeRegistryArtifact
): void {
  const baselineSubjects = new Map(
    baseline.subjects.map((subject) => [subject.stable_key, subject])
  );
  const candidateSubjects = new Map(
    candidate.subjects.map((subject) => [subject.stable_key, subject])
  );
  const baselineMarks = new Map(
    baseline.marks.map((mark) => [mark.stable_key, mark])
  );
  const candidateMarks = new Map(
    candidate.marks.map((mark) => [mark.stable_key, mark])
  );

  for (const [key, previous] of baselineSubjects) {
    const current = candidateSubjects.get(key);
    if (!current) throw new Error(`Published Subject key removed: ${key}`);
    if (previous.status === 'deprecated' && current.status !== 'deprecated') {
      throw new Error(`Deprecated Subject key reactivated: ${key}`);
    }
  }

  for (const [key, previous] of baselineMarks) {
    const current = candidateMarks.get(key);
    if (!current) throw new Error(`Published Mark key removed: ${key}`);
    if (
      current.subject !== previous.subject ||
      current.kind !== previous.kind
    ) {
      throw new Error(`Published Mark identity changed: ${key}`);
    }
    if (previous.status === 'deprecated' && current.status !== 'deprecated') {
      throw new Error(`Deprecated Mark key reactivated: ${key}`);
    }
  }
}
