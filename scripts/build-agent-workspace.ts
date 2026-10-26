import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKnowledgeRegistry } from '../src/registry.ts';
import {
  createKnowledgeRegistryArtifact,
  serializeKnowledgeRegistryArtifact,
} from '../src/artifact.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.resolve(
  process.argv[2] ?? path.join(root, 'dist/agent-marking')
);
const registry = createKnowledgeRegistryArtifact(await loadKnowledgeRegistry());
const registryBytes = Buffer.from(serializeKnowledgeRegistryArtifact(registry));
const sources = JSON.parse(
  await readFile(
    path.join(root, 'registry/skill-retrieval/documents.json'),
    'utf8'
  )
);
const skill = await readFile(
  path.join(root, '.opencode/skills/mark/SKILL.md'),
  'utf8'
);
const documents = registry.marks
  .filter((m: { status: string }) => m.status === 'active')
  .map((mark) => {
    const source = sources.documents.find(
      (d: { stable_key: unknown }) => d.stable_key === mark.stable_key
    );
    const text =
      source?.retrieval_text ??
      [
        mark.description,
        ...(mark.include as string[]),
        ...(mark.exclude as string[]),
      ]
        .filter(Boolean)
        .join('\n\n');
    return {
      stable_key: mark.stable_key,
      subject: mark.subject,
      kind: mark.kind,
      title: mark.name,
      document_revision: source?.document_revision ?? 1,
      source_location:
        source?.source_location ??
        `registry/${mark.subject}/${mark.kind}.json#${mark.stable_key}`,
      sections: text
        .split(/\n\n(?=学科：)/u)
        .filter(Boolean)
        .map((text: string, i: number) => ({
          id: `s${String(i + 1).padStart(3, '0')}`,
          text,
        })),
    };
  });
const bundle = {
  schema_version: 1,
  registry_content_sha256: createHash('sha256')
    .update(registryBytes)
    .digest('hex'),
  skill_version: '1.0.0',
  skill,
  registry,
  documents,
};
await mkdir(path.join(out, 'documents'), { recursive: true });
await mkdir(path.join(out, '.opencode/skills/mark'), { recursive: true });
await mkdir(path.join(out, '.opencode/agents'), { recursive: true });
await writeFile(
  path.join(out, 'README.md'),
  await readFile(path.join(root, 'templates/agent-marking/README.md'), 'utf8')
);
const serialized = `${JSON.stringify(bundle)}\n`;
await writeFile(path.join(out, 'bundle.json'), serialized);
await writeFile(
  path.join(out, 'CATALOG.md'),
  '# WQN classification catalog\n\nRead only the relevant documents. Stable keys are permanent identities.\n\n' +
    documents
      .map(
        (d: { subject: string; stable_key: string; title: string }) =>
          `- ${d.subject}: [${d.title}](documents/${d.stable_key}.md) — ${d.stable_key}`
      )
      .join('\n') +
    '\n'
);
for (const d of documents) {
  await writeFile(
    path.join(out, 'documents', `${d.stable_key}.md`),
    `# ${d.title}\n\nstable_key: ${d.stable_key}\ndocument_revision: ${d.document_revision}\nsource_location: ${d.source_location}\n\n` +
      d.sections
        .map((s: { id: string; text: string }) => `## ${s.id}\n\n${s.text}`)
        .join('\n\n') +
      '\n'
  );
}
await writeFile(path.join(out, '.opencode/skills/mark/SKILL.md'), skill);
await writeFile(
  path.join(out, '.opencode/agents/mark.md'),
  `---\ndescription: Classify a single WQN Problem using pinned registry documents and WQN marking MCP.\nmode: primary\nsteps: 12\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: deny\n  - action: read\n    resource: "CATALOG.md"\n    effect: allow\n  - action: read\n    resource: "documents/*"\n    effect: allow\n  - action: skill\n    resource: mark\n    effect: allow\n  - action: "wqn_mark_*"\n    resource: "*"\n    effect: allow\n---\nLoad the mark skill. Use the supplied task credentials only for that one Problem. Submit through WQN MCP; a free-text response is not a classification receipt.\n`
);
await writeFile(
  path.join(out, 'opencode.jsonc'),
  JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        timeout: { startup: 15000, catalog: 15000, execution: 30000 },
        servers: {
          wqn_mark: {
            type: 'remote',
            url: '{env:WQN_MARK_MCP_URL}',
            oauth: false,
            codemode: false,
            headers: {
              Authorization: 'Bearer {env:PROBLEM_MARKING_AGENT_SECRET}',
            },
          },
        },
      },
    },
    null,
    2
  ) + '\n'
);
console.log(
  JSON.stringify({
    output: out,
    documents: documents.length,
    artifact_sha256: createHash('sha256').update(serialized).digest('hex'),
  })
);
