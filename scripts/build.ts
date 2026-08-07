import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertKnowledgeRegistryCompatibility,
  createKnowledgeRegistryArtifact,
  hashKnowledgeRegistryArtifact,
  parseKnowledgeRegistryArtifact,
  serializeKnowledgeRegistryArtifact,
} from '../src/artifact.ts';
import { loadKnowledgeRegistry } from '../src/registry.ts';

const repositoryDir = fileURLToPath(new URL('../', import.meta.url));
const outputPath = path.join(repositoryDir, 'dist', 'registry.json');

function compatibilityPath(argv: string[]): string | null {
  const index = argv.indexOf('--baseline');
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value) throw new Error('--baseline requires an artifact path');
  return path.resolve(value);
}

const registry = await loadKnowledgeRegistry();
const artifact = createKnowledgeRegistryArtifact(registry);
const serialized = serializeKnowledgeRegistryArtifact(artifact);
const baselinePath = compatibilityPath(process.argv.slice(2));

if (baselinePath) {
  const baseline = parseKnowledgeRegistryArtifact(
    JSON.parse(await readFile(baselinePath, 'utf8'))
  );
  assertKnowledgeRegistryCompatibility(baseline, artifact);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, 'utf8');

console.log(
  [
    `Built ${path.relative(repositoryDir, outputPath)}`,
    `schema=${artifact.schema_version}`,
    `subjects=${artifact.subjects.length}`,
    `marks=${artifact.marks.length}`,
    `sha256=${hashKnowledgeRegistryArtifact(serialized)}`,
  ].join(' ')
);
