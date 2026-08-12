import { createHash } from 'node:crypto';
import { z } from 'zod';

const NonBlankStringSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ImmutableRevisionSchema = z.string().regex(/^(?:git:)?[a-f0-9]{40}$/);
const ProfileIdSchema = z.string().regex(/^skill-rag-[a-z0-9]+-v[1-9][0-9]*$/);

const CommonProfileShape = {
  profile_id: ProfileIdSchema,
  provider: z.enum(['modelscope', 'nvidia']),
  endpoint: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://')),
  model: NonBlankStringSchema,
  model_identity_policy: z.enum(['hosted_alias', 'immutable_revision']),
  model_identity: NonBlankStringSchema,
  dimension: z.number().int().positive().max(16_384),
  encoding_format: z.literal('float'),
  normalization: z.literal('l2'),
  document_template_version: NonBlankStringSchema,
  query_template_version: NonBlankStringSchema,
  tokenizer: z
    .object({
      repository: NonBlankStringSchema,
      revision: NonBlankStringSchema,
      files: z
        .array(
          z
            .object({
              path: NonBlankStringSchema,
              sha256: Sha256Schema,
            })
            .strict()
        )
        .min(1),
      max_tokens: z.number().int().positive(),
      trust_remote_code: z.literal(false),
    })
    .strict()
    .nullable(),
};

export const QwenSkillEmbeddingProfileSchema = z
  .object({
    ...CommonProfileShape,
    provider_protocol: z.literal('qwen-instruct-query-v1'),
    provider: z.literal('modelscope'),
    model: z.literal('Qwen/Qwen3-Embedding-4B'),
    dimension: z.literal(2560),
    document_contract: z
      .object({ input_transform: z.literal('plain') })
      .strict(),
    query_contract: z
      .object({
        input_transform: z.literal('instruct-query'),
        instruction: NonBlankStringSchema,
      })
      .strict(),
    tokenizer: z.null(),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      profile.model_identity_policy === 'immutable_revision' &&
      !ImmutableRevisionSchema.safeParse(profile.model_identity).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['model_identity'],
        message: 'immutable_revision requires a pinned 40-hex revision',
      });
    }
  });

export const NvidiaSkillEmbeddingProfileSchema = z
  .object({
    ...CommonProfileShape,
    provider_protocol: z.literal('nvidia-query-passage-v1'),
    provider: z.literal('nvidia'),
    endpoint: z.literal('https://integrate.api.nvidia.com/v1/embeddings'),
    model: z.literal('nvidia/nemotron-3-embed-1b'),
    dimension: z.literal(2048),
    document_contract: z
      .object({
        input_type: z.literal('passage'),
        truncate: z.literal('NONE'),
      })
      .strict(),
    query_contract: z
      .object({
        input_type: z.literal('query'),
        truncate: z.literal('NONE'),
      })
      .strict(),
    tokenizer: CommonProfileShape.tokenizer.refine(
      (value) => value !== null && value.max_tokens === 4096,
      'NVIDIA profile requires a pinned 4096-token tokenizer contract'
    ),
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      profile.model_identity_policy === 'immutable_revision' &&
      !ImmutableRevisionSchema.safeParse(profile.model_identity).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['model_identity'],
        message: 'immutable_revision requires a pinned 40-hex revision',
      });
    }
    if (
      profile.tokenizer &&
      !ImmutableRevisionSchema.safeParse(profile.tokenizer.revision).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokenizer', 'revision'],
        message: 'tokenizer requires a pinned 40-hex revision',
      });
    }
  });

export const SkillEmbeddingProfileSchema = z.union([
  QwenSkillEmbeddingProfileSchema,
  NvidiaSkillEmbeddingProfileSchema,
]);

export type SkillEmbeddingProfile = z.infer<typeof SkillEmbeddingProfileSchema>;
export type EmbeddingRole = 'document' | 'query';

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function skillEmbeddingProfileFingerprint(
  profileValue: unknown
): string {
  const profile = SkillEmbeddingProfileSchema.parse(profileValue);
  return `sha256:${createHash('sha256')
    .update(canonicalJson(profile), 'utf8')
    .digest('hex')}`;
}

export function renderEmbeddingInputs(
  profileValue: unknown,
  texts: string[],
  role: EmbeddingRole
): string[] {
  const profile = SkillEmbeddingProfileSchema.parse(profileValue);
  if (profile.provider_protocol === 'qwen-instruct-query-v1') {
    if (role === 'document') return [...texts];
    return texts.map(
      (text) =>
        `Instruct: ${profile.query_contract.instruction}\nQuery: ${text}`
    );
  }
  return [...texts];
}

export function embeddingRequestBody(
  profileValue: unknown,
  texts: string[],
  role: EmbeddingRole
): Record<string, unknown> {
  const profile = SkillEmbeddingProfileSchema.parse(profileValue);
  const body: Record<string, unknown> = {
    model: profile.model,
    input: renderEmbeddingInputs(profile, texts, role),
    encoding_format: profile.encoding_format,
  };
  if (profile.provider_protocol === 'nvidia-query-passage-v1') {
    const contract =
      role === 'document' ? profile.document_contract : profile.query_contract;
    body.input_type = contract.input_type;
    body.truncate = contract.truncate;
  }
  return body;
}

export function embeddingCredentialEnvironment(
  profileValue: unknown
): 'MODELSCOPE_TOKEN' | 'NVIDIA_API_KEY' {
  const profile = SkillEmbeddingProfileSchema.parse(profileValue);
  return profile.provider === 'nvidia' ? 'NVIDIA_API_KEY' : 'MODELSCOPE_TOKEN';
}
