import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertSkillChunkImportPolicy,
  importSkillChunkJsonl,
  SKILL_CHUNK_FORMAT_VERSION,
} from '../src/skill-chunk-import.ts';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function row(
  stableKey: string,
  moveNo: number,
  chunkIndex: number,
  chunkType: 'recognition' | 'method' | 'core' | 'example',
  priority: number,
  content: string
) {
  return {
    format_version: SKILL_CHUNK_FORMAT_VERSION,
    registry_kind: 'skill',
    subject: 'physics',
    source_doc_id: 'physics.test.source',
    source_title: 'Physics source',
    source_page: 'P001',
    topic_key: 'physics.topic.01',
    topic: '直线运动',
    stable_key: stableKey,
    skill_name: `Skill ${moveNo}`,
    move_no: moveNo,
    chunk_key: `${stableKey}.chunk.${String(chunkIndex).padStart(3, '0')}`,
    chunk_index: chunkIndex,
    chunk_type: chunkType,
    section_title: null,
    retrieval_priority: priority,
    visual_dependency: false,
    content,
    content_sha256: hash(content),
  };
}

function jsonl(rows: unknown[]): string {
  return `${rows.map((value) => JSON.stringify(value)).join('\n')}\n`;
}

describe('Skill chunk JSONL import', () => {
  it('creates canonical Skill Marks and pre-example retrieval documents', () => {
    const serialized = jsonl([
      row('physics.skill.move.002', 2, 1, 'recognition', 1, 'recognition 2'),
      row('physics.skill.move.002', 2, 2, 'example', 0.65, 'example 2'),
      row('physics.skill.move.001', 1, 1, 'recognition', 1, 'recognition 1'),
      row('physics.skill.move.001', 1, 2, 'method', 1, 'method 1'),
      row('physics.skill.move.001', 1, 3, 'example', 0.65, 'example 1'),
    ]);

    const imported = importSkillChunkJsonl(serialized);
    expect(imported.source_sha256).toBe(hash(serialized));
    expect(imported.source_document_id).toBe('physics.test.source');
    expect(imported.marks.map((mark) => mark.stable_key)).toEqual([
      'physics.skill.move.001',
      'physics.skill.move.002',
    ]);
    expect(imported.marks[0]).toMatchObject({
      include: ['recognition 1'],
      exclude: [],
    });
    expect(imported.marks[0]).not.toHaveProperty('description');
    expect(imported.documents).toMatchObject([
      {
        stable_key: 'physics.skill.move.001',
        retrieval_text: 'recognition 1\n\nmethod 1',
        source_location: 'physics.test.source#move-001',
        status: 'active',
      },
      {
        stable_key: 'physics.skill.move.002',
        retrieval_text: 'recognition 2',
        source_location: 'physics.test.source#move-002',
        status: 'active',
      },
    ]);
    expect(imported.documents[0].document_revision).toBeGreaterThan(0);
    expect(() =>
      assertSkillChunkImportPolicy(imported, {
        expectedSourceSha256: hash(serialized),
        expectedSkillCount: 2,
        expectedChunkCount: 5,
        expectedSubject: 'physics',
        expectedSourceDocumentId: 'physics.test.source',
      })
    ).not.toThrow();
    expect(() =>
      assertSkillChunkImportPolicy(imported, { expectedSkillCount: 3 })
    ).toThrow(/Skill count/);
  });

  it.each([
    [
      'content hash mismatch',
      (rows: ReturnType<typeof row>[]) => [
        { ...rows[0], content_sha256: '0'.repeat(64) },
      ],
      /content hash mismatch/,
    ],
    [
      'stable key and move mismatch',
      (rows: ReturnType<typeof row>[]) => [
        { ...rows[0], move_no: 2, skill_name: 'Skill 2' },
      ],
      /stable key\/move mismatch/,
    ],
    [
      'chunk index gap',
      (rows: ReturnType<typeof row>[]) => [
        rows[0],
        {
          ...row('physics.skill.move.001', 1, 2, 'method', 1, 'method'),
          chunk_index: 3,
          chunk_key: 'physics.skill.move.001.chunk.003',
        },
      ],
      /indexes must be contiguous/,
    ],
    [
      'mixed source documents',
      (rows: ReturnType<typeof row>[]) => [
        rows[0],
        {
          ...row(
            'physics.skill.move.002',
            2,
            1,
            'recognition',
            1,
            'recognition 2'
          ),
          source_doc_id: 'physics.other.source',
        },
      ],
      /one source_doc_id/,
    ],
    [
      'no retrieval chunks',
      (_rows: ReturnType<typeof row>[]) => [
        row('physics.skill.move.001', 1, 1, 'example', 0.65, 'example'),
      ],
      /no retrieval chunks/,
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const rows = [
      row('physics.skill.move.001', 1, 1, 'recognition', 1, 'recognition'),
    ];
    expect(() => importSkillChunkJsonl(jsonl(mutate(rows)))).toThrow(expected);
  });
});
