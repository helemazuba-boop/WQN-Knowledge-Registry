import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSkillRetrievalArtifact,
  createSkillRetrievalManifest,
  parseSkillRetrievalDocumentsSource,
  serializeSkillRetrievalArtifact,
  serializeSkillRetrievalIndex,
  serializeSkillRetrievalManifest,
  sha256,
  SkillRetrievalIndexSchema,
  type SkillEmbeddingProfile,
  type SkillRetrievalArtifact,
  type SkillRetrievalIndex,
  type SkillRetrievalManifest,
} from './skill-retrieval.ts';
import { SkillEmbeddingProfileSchema } from './skill-retrieval-profile.ts';
import type { KnowledgeRegistry } from './schema.ts';

const registryDir = fileURLToPath(
  new URL('../registry/skill-retrieval/', import.meta.url)
);
export const DEFAULT_SKILL_RETRIEVAL_DOCUMENTS_PATH = path.join(
  registryDir,
  'documents.json'
);
export const DEFAULT_SKILL_RETRIEVAL_PROFILES_DIR = path.join(
  registryDir,
  'profiles'
);
export const DEFAULT_SKILL_RETRIEVAL_VECTORS_DIR = path.join(
  registryDir,
  'vectors'
);

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceFile(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function loadSkillEmbeddingProfile(
  profileId: string,
  profilesDir = DEFAULT_SKILL_RETRIEVAL_PROFILES_DIR
): Promise<SkillEmbeddingProfile> {
  return SkillEmbeddingProfileSchema.parse(
    JSON.parse(
      await readFile(path.join(profilesDir, `${profileId}.json`), 'utf8')
    ) as unknown
  );
}

export async function loadSkillRetrievalArtifact(
  registry: KnowledgeRegistry,
  profileId: string,
  options: {
    documentsPath?: string;
    profilesDir?: string;
    vectorsDir?: string;
  } = {}
): Promise<SkillRetrievalArtifact | null> {
  const documentsPath =
    options.documentsPath ?? DEFAULT_SKILL_RETRIEVAL_DOCUMENTS_PATH;
  const profilesDir =
    options.profilesDir ?? DEFAULT_SKILL_RETRIEVAL_PROFILES_DIR;
  const vectorsDir = options.vectorsDir ?? DEFAULT_SKILL_RETRIEVAL_VECTORS_DIR;
  const vectorPath = path.join(vectorsDir, `${profileId}.json`);
  if (!(await fileExists(vectorPath))) return null;

  const [documentsValue, profileValue, vectorsValue] = await Promise.all([
    readFile(documentsPath, 'utf8').then((text) => JSON.parse(text) as unknown),
    loadSkillEmbeddingProfile(profileId, profilesDir),
    readFile(vectorPath, 'utf8').then((text) => JSON.parse(text) as unknown),
  ]);
  parseSkillRetrievalDocumentsSource(documentsValue);
  return createSkillRetrievalArtifact(
    registry,
    documentsValue,
    profileValue,
    vectorsValue
  );
}

export async function buildSkillRetrievalProfileArtifact(
  registry: KnowledgeRegistry,
  profileId: string,
  outputDir: string,
  options: {
    documentsPath?: string;
    profilesDir?: string;
    vectorsDir?: string;
  } = {}
): Promise<{
  artifact: SkillRetrievalArtifact;
  manifest: SkillRetrievalManifest;
  artifactPath: string;
  manifestPath: string;
} | null> {
  const artifact = await loadSkillRetrievalArtifact(
    registry,
    profileId,
    options
  );
  if (!artifact) return null;

  await mkdir(outputDir, { recursive: true });
  const artifactName = `${profileId}.json`;
  const manifestName = `${profileId}.manifest.json`;
  const artifactRelativePath = `skill-retrieval/${artifactName}`;
  const serializedArtifact = serializeSkillRetrievalArtifact(artifact);
  const manifest = createSkillRetrievalManifest(
    serializedArtifact,
    artifactRelativePath
  );
  const artifactPath = path.join(outputDir, artifactName);
  const manifestPath = path.join(outputDir, manifestName);
  await replaceFile(artifactPath, serializedArtifact);
  await replaceFile(manifestPath, serializeSkillRetrievalManifest(manifest));
  return { artifact, manifest, artifactPath, manifestPath };
}

export async function buildSkillRetrievalArtifacts(
  registry: KnowledgeRegistry,
  profileIds: string[],
  outputDir: string,
  options: {
    documentsPath?: string;
    profilesDir?: string;
    vectorsDir?: string;
  } = {}
): Promise<SkillRetrievalIndex> {
  const profiles: SkillRetrievalIndex['profiles'] = [];
  for (const profileId of profileIds) {
    const result = await buildSkillRetrievalProfileArtifact(
      registry,
      profileId,
      outputDir,
      options
    );
    if (!result) continue;
    const manifestSerialized = serializeSkillRetrievalManifest(result.manifest);
    profiles.push({
      profile_id: result.manifest.profile_id,
      profile_fingerprint: result.manifest.profile_fingerprint,
      representation_revision: result.manifest.representation_revision,
      artifact: result.manifest.artifact,
      artifact_sha256: result.manifest.artifact_sha256,
      manifest: `skill-retrieval/${path.basename(result.manifestPath)}`,
      manifest_sha256: sha256(manifestSerialized),
      dimension: result.manifest.dimension,
      document_count: result.manifest.document_count,
    });
  }
  const index = SkillRetrievalIndexSchema.parse({
    schema_version: 1,
    profiles,
  });
  await mkdir(outputDir, { recursive: true });
  await replaceFile(
    path.join(outputDir, 'index.json'),
    serializeSkillRetrievalIndex(index)
  );
  return index;
}
