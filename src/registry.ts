import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CanonicalSubjectListSchema,
  KnowledgeMarkListSchema,
  type KnowledgeMarkDefinition,
  type KnowledgeRegistry,
  type RegistryMarkFile,
} from './schema.ts';

export const DEFAULT_REGISTRY_DIR = fileURLToPath(
  new URL('../registry/', import.meta.url)
);

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertParentGraph(marks: KnowledgeMarkDefinition[]): void {
  const byKey = new Map(marks.map((mark) => [mark.stable_key, mark]));

  for (const mark of marks) {
    if (!mark.parent) continue;
    const parent = byKey.get(mark.parent);
    if (!parent) {
      throw new Error(
        `Mark ${mark.stable_key} references missing parent ${mark.parent}`
      );
    }
    if (parent.subject !== mark.subject || parent.kind !== mark.kind) {
      throw new Error(
        `Mark ${mark.stable_key} parent must have the same subject and kind`
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(`Mark parent cycle includes ${key}`);
    }
    visiting.add(key);
    const parent = byKey.get(key)?.parent;
    if (parent) visit(parent);
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of byKey.keys()) visit(key);
}

export function validateKnowledgeRegistry(
  subjectValue: unknown,
  markFiles: RegistryMarkFile[]
): KnowledgeRegistry {
  const subjects = CanonicalSubjectListSchema.parse(subjectValue);
  assertUnique(
    subjects.map((subject) => subject.stable_key),
    'canonical subject key'
  );
  const subjectKeys = new Set(subjects.map((subject) => subject.stable_key));
  const marks: KnowledgeMarkDefinition[] = [];

  for (const file of markFiles) {
    if (!subjectKeys.has(file.subject)) {
      throw new Error(`Mark file uses unknown subject ${file.subject}`);
    }
    const parsed = KnowledgeMarkListSchema.parse(file.value);
    for (const mark of parsed) {
      if (mark.subject !== file.subject || mark.kind !== file.kind) {
        throw new Error(
          `Mark ${mark.stable_key} does not match its ${file.subject}/${file.kind} file`
        );
      }
      const expectedPrefix = `${mark.subject}.${mark.kind}.`;
      if (!mark.stable_key.startsWith(expectedPrefix)) {
        throw new Error(
          `Mark ${mark.stable_key} must start with ${expectedPrefix}`
        );
      }
      marks.push(mark);
    }
  }

  assertUnique(
    marks.map((mark) => mark.stable_key),
    'mark stable key'
  );
  assertParentGraph(marks);

  return { subjects, marks };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadKnowledgeRegistry(
  registryDir = DEFAULT_REGISTRY_DIR
): Promise<KnowledgeRegistry> {
  const subjectValue = await readJson(path.join(registryDir, 'subjects.json'));
  const subjects = CanonicalSubjectListSchema.parse(subjectValue);
  const markFiles: RegistryMarkFile[] = [];

  for (const subject of subjects) {
    markFiles.push(
      {
        subject: subject.stable_key,
        kind: 'knowledge',
        value: await readJson(
          path.join(registryDir, subject.stable_key, 'knowledge.json')
        ),
      },
      {
        subject: subject.stable_key,
        kind: 'skill',
        value: await readJson(
          path.join(registryDir, subject.stable_key, 'skills.json')
        ),
      }
    );
  }

  return validateKnowledgeRegistry(subjectValue, markFiles);
}
