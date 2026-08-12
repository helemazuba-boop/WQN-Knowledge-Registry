import { z } from 'zod';

export const KNOWLEDGE_REGISTRY_SCHEMA_VERSION = 1 as const;
export const RegistryStatusSchema = z.enum(['active', 'deprecated']);
export const MarkKindSchema = z.enum(['knowledge', 'skill']);

export const StableSubjectKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
export const StableMarkKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.(?:knowledge|skill)\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/);
const NonBlankStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonBlankStringSchema).default([]);

export const CanonicalSubjectSchema = z
  .object({
    stable_key: StableSubjectKeySchema,
    name: NonBlankStringSchema,
    aliases: StringListSchema,
    status: RegistryStatusSchema,
  })
  .strict();

export const KnowledgeMarkSchema = z
  .object({
    stable_key: StableMarkKeySchema,
    name: NonBlankStringSchema,
    kind: MarkKindSchema,
    subject: StableSubjectKeySchema,
    aliases: StringListSchema,
    description: NonBlankStringSchema.optional(),
    parent: StableMarkKeySchema.optional(),
    include: StringListSchema,
    exclude: StringListSchema,
    status: RegistryStatusSchema,
  })
  .strict();

export const CanonicalSubjectListSchema = z.array(CanonicalSubjectSchema);
export const KnowledgeMarkListSchema = z.array(KnowledgeMarkSchema);

export type RegistryStatus = z.infer<typeof RegistryStatusSchema>;
export type MarkKind = z.infer<typeof MarkKindSchema>;
export type CanonicalSubjectDefinition = z.infer<typeof CanonicalSubjectSchema>;
export type KnowledgeMarkDefinition = z.infer<typeof KnowledgeMarkSchema>;

export interface KnowledgeRegistry {
  subjects: CanonicalSubjectDefinition[];
  marks: KnowledgeMarkDefinition[];
}

export interface RegistryMarkFile {
  subject: string;
  kind: MarkKind;
  value: unknown;
}
