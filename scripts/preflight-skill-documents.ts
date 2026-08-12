import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parseSkillRetrievalDocumentsSource,
  type SkillRetrievalDocumentsSource,
} from '../src/skill-retrieval.ts';
import {
  embeddingCredentialEnvironment,
  embeddingEndpointEnvironment,
  renderEmbeddingInputs,
  skillEmbeddingProfileFingerprint,
  SkillEmbeddingProfileSchema,
  type SkillEmbeddingProfile,
} from '../src/skill-retrieval-profile.ts';
import { assertNvidiaTokenLimits } from '../src/skill-retrieval-tokenizer.ts';

interface PreflightResult {
  profile_id: string;
  profile_fingerprint: string;
  credential_environment:
    'MODELSCOPE_TOKEN' | 'NVIDIA_API_KEY' | 'DASHSCOPE_API_KEY';
  endpoint_environment: string | null;
  document_count: number;
  token_limit: number | null;
  min_tokens: number | null;
  max_tokens: number | null;
}

function argumentValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function requiredArgument(argv: string[], name: string): string {
  const value = argumentValue(argv, name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

async function loadInputs(
  documentsPath: string,
  profilePath: string
): Promise<{
  source: SkillRetrievalDocumentsSource;
  profile: SkillEmbeddingProfile;
}> {
  const [documentsSerialized, profileSerialized] = await Promise.all([
    readFile(documentsPath, 'utf8'),
    readFile(profilePath, 'utf8'),
  ]);
  return {
    source: parseSkillRetrievalDocumentsSource(
      JSON.parse(documentsSerialized) as unknown
    ),
    profile: SkillEmbeddingProfileSchema.parse(
      JSON.parse(profileSerialized) as unknown
    ),
  };
}

async function preflight(
  source: SkillRetrievalDocumentsSource,
  profile: SkillEmbeddingProfile
): Promise<PreflightResult> {
  const texts = renderEmbeddingInputs(
    profile,
    source.documents.map((document) => document.retrieval_text),
    'document'
  );
  const counts =
    profile.provider_protocol === 'nvidia-query-passage-v1'
      ? await assertNvidiaTokenLimits(profile, texts)
      : [];
  const tokens = counts.map((count) => count.tokens);
  return {
    profile_id: profile.profile_id,
    profile_fingerprint: skillEmbeddingProfileFingerprint(profile),
    credential_environment: embeddingCredentialEnvironment(profile),
    endpoint_environment: embeddingEndpointEnvironment(profile),
    document_count: source.documents.length,
    token_limit: profile.tokenizer?.max_tokens ?? null,
    min_tokens: tokens.length ? Math.min(...tokens) : null,
    max_tokens: tokens.length ? Math.max(...tokens) : null,
  };
}

const argv = process.argv.slice(2);
const documentsPath = path.resolve(requiredArgument(argv, '--documents'));
const profilePath = path.resolve(requiredArgument(argv, '--profile'));
const { source, profile } = await loadInputs(documentsPath, profilePath);
const result = await preflight(source, profile);

if (argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  console.log(
    [
      `Skill document preflight passed: profile=${result.profile_id}`,
      `documents=${result.document_count}`,
      `token_limit=${result.token_limit ?? 'provider-managed'}`,
      `min_tokens=${result.min_tokens ?? 'not-counted'}`,
      `max_tokens=${result.max_tokens ?? 'not-counted'}`,
    ].join(' ')
  );
}
