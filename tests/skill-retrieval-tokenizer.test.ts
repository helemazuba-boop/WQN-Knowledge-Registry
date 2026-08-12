import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import nvidiaProfile from '../registry/skill-retrieval/profiles/skill-rag-nvidia-v1.json' with { type: 'json' };
import qwenProfile from '../registry/skill-retrieval/profiles/skill-rag-qwen-v1.json' with { type: 'json' };
import {
  assertNvidiaTokenLimits,
  loadVerifiedNvidiaTokenizer,
} from '../src/skill-retrieval-tokenizer.ts';

describe('NVIDIA Skill retrieval tokenizer contract', () => {
  it('accepts exactly 4096 tokens and rejects 4097 without truncation', async () => {
    await expect(
      assertNvidiaTokenLimits(nvidiaProfile, [' x'.repeat(4096)])
    ).resolves.toEqual([{ tokens: 4096, maxTokens: 4096 }]);
    await expect(
      assertNvidiaTokenLimits(nvidiaProfile, [' x'.repeat(4097)])
    ).rejects.toThrow(/exceeds 4096 tokens: 4097/);
  });

  it('rejects a tokenizer asset identity mismatch', async () => {
    await expect(
      loadVerifiedNvidiaTokenizer({
        ...nvidiaProfile,
        tokenizer: {
          ...nvidiaProfile.tokenizer,
          files: nvidiaProfile.tokenizer.files.map((file, index) =>
            index === 0 ? { ...file, sha256: '0'.repeat(64) } : file
          ),
        },
      })
    ).rejects.toThrow(/asset hash mismatch/);
  });

  it('keeps all current NVIDIA passages inside the hosted limit', async () => {
    const source = JSON.parse(
      await readFile(
        new URL('../registry/skill-retrieval/documents.json', import.meta.url),
        'utf8'
      )
    ) as { documents: { retrieval_text: string }[] };
    const counts = await assertNvidiaTokenLimits(
      nvidiaProfile,
      source.documents.map((document) => document.retrieval_text)
    );
    expect(counts).toHaveLength(76);
    expect(Math.min(...counts.map((count) => count.tokens))).toBe(278);
    expect(Math.max(...counts.map((count) => count.tokens))).toBe(3239);
  });

  it('does not apply an NVIDIA tokenizer contract to Qwen', async () => {
    await expect(
      assertNvidiaTokenLimits(qwenProfile, ['query'])
    ).rejects.toThrow();
  });
});
