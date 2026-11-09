// Measures memory of the TypeScript program alone (no extraction) for a repository: parse + bind + checker creation.
import path from 'node:path';
import { listCorpusFiles } from '../../src/config.js';
import { createProject } from '../../src/parser/typescript-parser.js';
const root = path.resolve(process.argv[2]);
const t0 = performance.now();
const p = createProject({ repoRoot: root, files: listCorpusFiles(root, ['src']) });
const mb = () => Math.round(process.memoryUsage().rss / 1e6);
console.log(`program: ${p.program.getSourceFiles().length} source files (corpus ${p.files.length}), ${Math.round(performance.now() - t0)} ms, rss ${mb()} MB`);
let n = 0; const t1 = performance.now();
for (const sf of p.sourceFiles.values()) { p.program.getSemanticDiagnostics(sf); if (++n % 2000 === 0) console.log(`  checked ${n} files, rss ${mb()} MB, ${Math.round((performance.now() - t1) / 1000)} s`); if (mb() > 6500) { console.log('stopping at 6.5 GB'); break; } }
console.log(`checked ${n} files: rss ${mb()} MB, ${Math.round((performance.now() - t1) / 1000)} s`);
