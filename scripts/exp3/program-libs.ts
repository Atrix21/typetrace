// Lists the largest external packages (declaration bytes) pulled into a repository's TypeScript program.
import fs from 'node:fs';
import path from 'node:path';
import { listCorpusFiles } from '../../src/config.js';
import { createProject } from '../../src/parser/typescript-parser.js';
const root = path.resolve(process.argv[2]);
const p = createProject({ repoRoot: root, files: listCorpusFiles(root, ['src']) });
const by = new Map<string, { files: number; bytes: number }>();
for (const sf of p.program.getSourceFiles()) {
  const f = sf.fileName; const i = f.lastIndexOf('/node_modules/');
  let k = '(project)';
  if (i >= 0) { const parts = f.slice(i + 14).split('/'); k = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]; }
  else if (!p.relOf(sf)) k = p.isLib(sf) ? '(ts lib)' : `(other) ${path.relative(root, path.dirname(f)).split('/').slice(0, 4).join('/')}`;
  const r = by.get(k) ?? { files: 0, bytes: 0 }; r.files++; r.bytes += sf.text.length; by.set(k, r);
}
const rows = [...by].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 18);
for (const [k, r] of rows) console.log(`${(r.bytes / 1e6).toFixed(1).padStart(7)} MB ${String(r.files).padStart(6)} files  ${k}`);
