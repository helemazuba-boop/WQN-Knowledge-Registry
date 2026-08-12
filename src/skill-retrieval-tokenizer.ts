import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tokenizer } from '@huggingface/tokenizers';
import {
  NvidiaSkillEmbeddingProfileSchema,
  type SkillEmbeddingProfile,
} from './skill-retrieval-profile.ts';

const registryDir = fileURLToPath(
  new URL('../registry/skill-retrieval/', import.meta.url)
);

export interface TokenCount {
  tokens: number;
  maxTokens: number;
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenizerDirectory(profile: SkillEmbeddingProfile): string {
  if (!profile.tokenizer) throw new Error('Embedding profile has no tokenizer');
  const shortRevision = profile.tokenizer.revision.slice(0, 7);
  return path.join(
    registryDir,
    'tokenizers',
    `nemotron-3-embed-1b-${shortRevision}`
  );
}

export async function loadVerifiedNvidiaTokenizer(
  profileValue: unknown
): Promise<Tokenizer> {
  const profile = NvidiaSkillEmbeddingProfileSchema.parse(profileValue);
  const tokenizer = profile.tokenizer;
  if (!tokenizer) throw new Error('NVIDIA profile has no tokenizer contract');
  const directory = tokenizerDirectory(profile);
  const files = new Map<string, Uint8Array>();
  for (const expected of tokenizer.files) {
    const contents = await readFile(path.join(directory, expected.path));
    if (sha256(contents) !== expected.sha256) {
      throw new Error(`Tokenizer asset hash mismatch: ${expected.path}`);
    }
    files.set(expected.path, contents);
  }
  const tokenizerJson = files.get('tokenizer.json');
  const tokenizerConfig = files.get('tokenizer_config.json');
  if (!tokenizerJson || !tokenizerConfig) {
    throw new Error('Tokenizer contract requires tokenizer.json and config');
  }
  return new Tokenizer(
    JSON.parse(Buffer.from(tokenizerJson).toString('utf8')) as object,
    JSON.parse(Buffer.from(tokenizerConfig).toString('utf8')) as object
  );
}

export async function assertNvidiaTokenLimits(
  profileValue: unknown,
  texts: string[]
): Promise<TokenCount[]> {
  const profile = NvidiaSkillEmbeddingProfileSchema.parse(profileValue);
  const contract = profile.tokenizer;
  if (!contract) throw new Error('NVIDIA profile has no tokenizer contract');
  const tokenizer = await loadVerifiedNvidiaTokenizer(profile);
  return texts.map((text, index) => {
    const tokens = tokenizer.encode(text).ids.length;
    if (tokens > contract.max_tokens) {
      throw new Error(
        `Embedding input ${index} exceeds ${contract.max_tokens} tokens: ${tokens}`
      );
    }
    return { tokens, maxTokens: contract.max_tokens };
  });
}
