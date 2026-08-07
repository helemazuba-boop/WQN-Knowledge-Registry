import { describe, expect, it } from 'vitest';
import {
  assertKnowledgeRegistryCompatibility,
  createKnowledgeRegistryArtifact,
  hashKnowledgeRegistryArtifact,
  parseKnowledgeRegistryArtifact,
  serializeKnowledgeRegistryArtifact,
} from '../src/artifact.ts';
import {
  loadKnowledgeRegistry,
  validateKnowledgeRegistry,
} from '../src/registry.ts';
import {
  KNOWLEDGE_REGISTRY_SCHEMA_VERSION,
  type RegistryMarkFile,
} from '../src/schema.ts';

const subjects = [
  {
    stable_key: 'math',
    name: '数学',
    aliases: [],
    status: 'active',
  },
  {
    stable_key: 'physics',
    name: '物理',
    aliases: [],
    status: 'active',
  },
];

function mark(
  stableKey: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const [subject, kind] = stableKey.split('.');
  return {
    stable_key: stableKey,
    name: stableKey,
    kind,
    subject,
    aliases: [],
    include: [],
    exclude: [],
    status: 'active',
    ...overrides,
  };
}

function files(
  mathKnowledge: unknown[] = [],
  mathSkills: unknown[] = [],
  physicsKnowledge: unknown[] = [],
  physicsSkills: unknown[] = []
): RegistryMarkFile[] {
  return [
    { subject: 'math', kind: 'knowledge', value: mathKnowledge },
    { subject: 'math', kind: 'skill', value: mathSkills },
    { subject: 'physics', kind: 'knowledge', value: physicsKnowledge },
    { subject: 'physics', kind: 'skill', value: physicsSkills },
  ];
}

describe('Knowledge Registry validation', () => {
  it('accepts empty mark files', () => {
    expect(validateKnowledgeRegistry(subjects, files())).toEqual({
      subjects,
      marks: [],
    });
  });

  it('accepts same-kind parents and deprecated marks', () => {
    const parent = mark('math.skill.algebra');
    const child = mark('math.skill.algebra.parameter_separation', {
      parent: parent.stable_key,
      status: 'deprecated',
    });
    const registry = validateKnowledgeRegistry(
      subjects,
      files([], [parent, child])
    );
    expect(registry.marks).toHaveLength(2);
  });

  it.each([
    ['bad stable key', [mark('math.skill.ParameterSeparation')]],
    [
      'subject mismatch',
      [mark('math.skill.parameter_separation', { subject: 'physics' })],
    ],
    [
      'kind mismatch',
      [mark('math.skill.parameter_separation', { kind: 'knowledge' })],
    ],
    [
      'invalid status',
      [mark('math.skill.parameter_separation', { status: 'draft' })],
    ],
    [
      'blank alias',
      [mark('math.skill.parameter_separation', { aliases: [''] })],
    ],
  ])('rejects %s', (_label, invalidMarks) => {
    expect(() =>
      validateKnowledgeRegistry(subjects, files([], invalidMarks))
    ).toThrow();
  });

  it('rejects duplicate keys across files', () => {
    const duplicate = mark('math.skill.parameter_separation');
    expect(() =>
      validateKnowledgeRegistry(subjects, files([], [duplicate, duplicate]))
    ).toThrow(/Duplicate mark stable key/);
  });

  it('rejects missing and cross-kind parents', () => {
    expect(() =>
      validateKnowledgeRegistry(
        subjects,
        files(
          [],
          [
            mark('math.skill.parameter_separation', {
              parent: 'math.skill.algebra',
            }),
          ]
        )
      )
    ).toThrow(/missing parent/);

    expect(() =>
      validateKnowledgeRegistry(
        subjects,
        files(
          [mark('math.knowledge.algebra')],
          [
            mark('math.skill.parameter_separation', {
              parent: 'math.knowledge.algebra',
            }),
          ]
        )
      )
    ).toThrow(/same subject and kind/);
  });

  it('rejects parent cycles', () => {
    expect(() =>
      validateKnowledgeRegistry(
        subjects,
        files(
          [],
          [
            mark('math.skill.algebra', {
              parent: 'math.skill.algebra.parameter_separation',
            }),
            mark('math.skill.algebra.parameter_separation', {
              parent: 'math.skill.algebra',
            }),
          ]
        )
      )
    ).toThrow(/cycle/);
  });

  it('builds a deterministic sorted artifact', () => {
    const registry = validateKnowledgeRegistry(
      [...subjects].reverse(),
      files(
        [],
        [mark('math.skill.parameter_separation'), mark('math.skill.algebra')]
      )
    );
    const first = serializeKnowledgeRegistryArtifact(
      createKnowledgeRegistryArtifact(registry)
    );
    const second = serializeKnowledgeRegistryArtifact(
      createKnowledgeRegistryArtifact(registry)
    );

    expect(first).toBe(second);
    expect(first.endsWith('\n')).toBe(true);
    expect(JSON.parse(first)).toMatchObject({
      schema_version: 1,
      subjects: [{ stable_key: 'math' }, { stable_key: 'physics' }],
      marks: [
        { stable_key: 'math.skill.algebra' },
        { stable_key: 'math.skill.parameter_separation' },
      ],
    });
    expect(hashKnowledgeRegistryArtifact(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects incompatible changes to published identities', () => {
    const baseline = createKnowledgeRegistryArtifact(
      validateKnowledgeRegistry(
        subjects,
        files(
          [],
          [
            mark('math.skill.algebra'),
            mark('math.skill.parameter_separation', { status: 'deprecated' }),
          ]
        )
      )
    );

    const withoutPublishedMark = createKnowledgeRegistryArtifact(
      validateKnowledgeRegistry(
        subjects,
        files([], [mark('math.skill.algebra')])
      )
    );
    expect(() =>
      assertKnowledgeRegistryCompatibility(baseline, withoutPublishedMark)
    ).toThrow(/Published Mark key removed/);

    const changedIdentity = parseKnowledgeRegistryArtifact({
      ...baseline,
      marks: baseline.marks.map((entry) =>
        entry.stable_key === 'math.skill.algebra'
          ? {
              ...entry,
              stable_key: 'physics.skill.algebra',
              subject: 'physics',
            }
          : entry
      ),
    });
    expect(() =>
      assertKnowledgeRegistryCompatibility(baseline, changedIdentity)
    ).toThrow(/Published Mark key removed/);

    const reactivated = parseKnowledgeRegistryArtifact({
      ...baseline,
      marks: baseline.marks.map((entry) =>
        entry.stable_key === 'math.skill.parameter_separation'
          ? { ...entry, status: 'active' }
          : entry
      ),
    });
    expect(() =>
      assertKnowledgeRegistryCompatibility(baseline, reactivated)
    ).toThrow(/Deprecated Mark key reactivated/);
  });

  it('accepts metadata changes and deprecation', () => {
    const baseline = createKnowledgeRegistryArtifact(
      validateKnowledgeRegistry(
        subjects,
        files([], [mark('math.skill.algebra')])
      )
    );
    const candidate = createKnowledgeRegistryArtifact(
      validateKnowledgeRegistry(
        subjects,
        files(
          [],
          [
            mark('math.skill.algebra', {
              name: '代数方法',
              aliases: ['代数'],
              status: 'deprecated',
            }),
          ]
        )
      )
    );

    expect(() =>
      assertKnowledgeRegistryCompatibility(baseline, candidate)
    ).not.toThrow();
  });

  it('loads the checked-in Registry', async () => {
    const registry = await loadKnowledgeRegistry();
    expect(KNOWLEDGE_REGISTRY_SCHEMA_VERSION).toBe(1);
    expect(registry.subjects).toHaveLength(11);
    expect(
      registry.subjects.some((subject) => subject.stable_key === 'math')
    ).toBe(true);
    expect(registry.marks).toEqual([]);
  });
});
