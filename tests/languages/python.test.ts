/**
 * Python front-end (src/languages/python.ts): imports across files, inheritance, calls through self to an inherited
 * method, and a class shadowed by a later function of the same name in the same file (sympy does this; the front-end
 * threw on it before experiment 05, decision E5-D02).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { listCorpusFiles } from '../../src/config.js';
import { buildPythonGraph } from '../../src/languages/python.js';
import { initLanguages } from '../../src/languages/registry.js';

function graph(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-py-'));
  for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
  const g = buildPythonGraph(dir, listCorpusFiles(dir, [''], ['.py']), 'fixture');
  const edges = (type: string) => g.edges.filter((e) => e.type === type).map((e) => `${e.src} -> ${e.dst}`);
  return { g, edges };
}

const BASE = `class Base:
    def helper(self):
        return 1
`;

describe('python front-end', () => {
  beforeAll(async () => { await initLanguages(['python']); }, 60_000);

  it('resolves imports, inheritance and calls through self to an inherited method', () => {
    const { edges } = graph({
      'pkg/__init__.py': '',
      'pkg/base.py': BASE,
      'pkg/child.py': `from pkg.base import Base

class Child(Base):
    def run(self):
        return self.helper()
`,
    });
    expect(edges('EXTENDS')).toContain('class:pkg/child.py::Child -> class:pkg/base.py::Base');
    expect(edges('CALLS')).toContain('method:pkg/child.py::Child.run -> method:pkg/base.py::Base.helper');
  });

  it('keeps a class that a later function of the same name shadows (no crash; the class keeps its EXTENDS edge)', () => {
    const { g, edges } = graph({
      'pkg/__init__.py': '',
      'pkg/base.py': BASE,
      'pkg/shapes.py': `from pkg.base import Base

class Shape(Base):
    def area(self):
        return 0

def Shape(*args):
    return None
`,
    });
    expect(g.nodes.some((n) => n.id === 'class:pkg/shapes.py::Shape')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'function:pkg/shapes.py::Shape')).toBe(true);
    expect(edges('EXTENDS')).toContain('class:pkg/shapes.py::Shape -> class:pkg/base.py::Base');
  });
});
