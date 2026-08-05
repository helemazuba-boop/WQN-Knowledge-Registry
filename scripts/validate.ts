import { loadKnowledgeRegistry } from '../src/registry.ts';
import { KNOWLEDGE_REGISTRY_SCHEMA_VERSION } from '../src/schema.ts';

const registry = await loadKnowledgeRegistry();
console.log(
  `Knowledge Registry v${KNOWLEDGE_REGISTRY_SCHEMA_VERSION} valid: ${registry.subjects.length} subjects, ${registry.marks.length} marks`
);
