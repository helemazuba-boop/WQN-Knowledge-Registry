import { createHash } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSkillChunkImportPolicy,
  importSkillChunkJsonlFile,
} from '../src/skill-chunk-import.ts';

const repositoryDir = fileURLToPath(new URL('../', import.meta.url));

function argumentValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function requiredArgument(argv: string[], name: string): string {
  const value = argumentValue(argv, name);
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

function requiredPositiveIntegerArgument(argv: string[], name: string): number {
  const value = requiredArgument(argv, name);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} requires a positive integer`);
  }
  return Number(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

const argv = process.argv.slice(2);
const sourcePath = path.resolve(requiredArgument(argv, '--source'));
const documentsPath = path.resolve(
  argumentValue(argv, '--documents-output') ??
    path.join(repositoryDir, 'registry', 'skill-retrieval', 'documents.json')
);
const skillsPath = path.resolve(
  argumentValue(argv, '--skills-output') ??
    path.join(repositoryDir, 'registry', 'physics', 'skills.json')
);

const imported = await importSkillChunkJsonlFile(sourcePath);
assertSkillChunkImportPolicy(imported, {
  expectedSourceSha256: requiredArgument(argv, '--expected-source-sha256'),
  expectedSkillCount: requiredPositiveIntegerArgument(
    argv,
    '--expected-skills'
  ),
  expectedChunkCount: requiredPositiveIntegerArgument(
    argv,
    '--expected-chunks'
  ),
  expectedSubject: requiredArgument(argv, '--subject'),
  expectedSourceDocumentId: requiredArgument(argv, '--source-document-id'),
});
const documents = [...imported.documents].sort((left, right) =>
  left.stable_key.localeCompare(right.stable_key, 'en')
);
const documentsSerialized = `${JSON.stringify(documents)}\n`;
const documentSource = {
  format_version: 'wqn-skill-retrieval-documents-v1',
  source_corpus_sha256: imported.source_sha256,
  source_documents_sha256: sha256(documentsSerialized),
  source_document_id: imported.source_document_id,
  documents,
};

await writeAtomic(skillsPath, `${JSON.stringify(imported.marks, null, 2)}\n`);
await writeAtomic(
  documentsPath,
  `${JSON.stringify(documentSource, null, 2)}\n`
);
console.log(
  [
    `Imported ${path.relative(repositoryDir, sourcePath)}`,
    `skills=${imported.marks.length}`,
    `chunks=${imported.chunks.length}`,
    `source_sha256=${imported.source_sha256}`,
    `skills_output=${path.relative(repositoryDir, skillsPath)}`,
    `documents_output=${path.relative(repositoryDir, documentsPath)}`,
  ].join(' ')
);
