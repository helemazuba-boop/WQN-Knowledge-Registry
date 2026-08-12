import { loadKnowledgeRegistry } from '../src/registry.ts';
import {
  loadSkillEmbeddingProfile,
  loadSkillRetrievalArtifact,
} from '../src/skill-retrieval-files.ts';
import { KNOWLEDGE_REGISTRY_SCHEMA_VERSION } from '../src/schema.ts';
import {
  embeddingRequestBody,
  skillEmbeddingProfileFingerprint,
} from '../src/skill-retrieval-profile.ts';
import { assertNvidiaTokenLimits } from '../src/skill-retrieval-tokenizer.ts';

const profileIds = ['skill-rag-qwen-v1', 'skill-rag-nvidia-v1'];
const registry = await loadKnowledgeRegistry();
const profiles = [];
for (const profileId of profileIds) {
  const profile = await loadSkillEmbeddingProfile(profileId);
  skillEmbeddingProfileFingerprint(profile);
  embeddingRequestBody(profile, ['validation query'], 'query');
  if (profile.provider_protocol === 'nvidia-query-passage-v1') {
    await assertNvidiaTokenLimits(profile, ['validation query']);
  }
  profiles.push(profile);
}
const artifacts = await Promise.all(
  profileIds.map((profileId) => loadSkillRetrievalArtifact(registry, profileId))
);

console.log(
  `Knowledge Registry v${KNOWLEDGE_REGISTRY_SCHEMA_VERSION} valid: ${registry.subjects.length} subjects, ${registry.marks.length} marks`
);
for (const [index, profile] of profiles.entries()) {
  const artifact = artifacts[index];
  if (artifact) {
    console.log(
      `Skill retrieval profile valid: ${profile.profile_id}, ${artifact.documents.length} documents, dimension ${profile.dimension}`
    );
  } else {
    console.log(
      `Skill retrieval profile valid without frozen vectors: ${profile.profile_id}, dimension ${profile.dimension}`
    );
  }
}
