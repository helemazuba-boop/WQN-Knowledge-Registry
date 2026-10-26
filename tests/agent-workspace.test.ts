import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

describe('Agent workspace publication', () => {
  it('generates deterministic pinned documents without embedding dependencies', () => {
    const one = mkdtempSync(path.join(tmpdir(), 'wqn-mark-one-'));
    const two = mkdtempSync(path.join(tmpdir(), 'wqn-mark-two-'));
    for (const dir of [one, two])
      execFileSync(process.execPath, ['scripts/build-agent-workspace.ts', dir]);
    const bytes = readFileSync(path.join(one, 'bundle.json'));
    expect(bytes.equals(readFileSync(path.join(two, 'bundle.json')))).toBe(
      true
    );
    const bundle = JSON.parse(bytes.toString());
    expect(bundle.registry_content_sha256).toBe(
      createHash('sha256')
        .update(readFileSync('dist/registry.json'))
        .digest('hex')
    );
    expect(bundle.documents.length).toBe(
      bundle.registry.marks.filter(
        (x: { status: string }) => x.status === 'active'
      ).length
    );
    for (const doc of bundle.documents) {
      const text = readFileSync(
        path.join(one, 'documents', doc.stable_key + '.md'),
        'utf8'
      );
      for (const section of doc.sections) expect(text).toContain(section.text);
      expect(doc.vector).toBeUndefined();
    }
    const config = JSON.parse(
      readFileSync(path.join(one, 'opencode.jsonc'), 'utf8')
    );
    expect(config.model).toBeUndefined();
    expect(Object.keys(config.mcp.servers)).toEqual(['wqn_mark']);
  });
});
