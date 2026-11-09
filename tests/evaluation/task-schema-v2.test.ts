/** Task schema v2 (experiment 3): frozen v2 tasks load with their v2 fields; v1 (experiment-1) tasks load unchanged. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { abs, loadConfig } from '../../src/config.js';
import { loadTasks } from '../../src/evaluation/ground-truth.js';

describe('task schema v2', () => {
  it('loads experiment-1 (v1) tasks unchanged', () => {
    const v1 = loadTasks(abs(loadConfig().dataset.tasks_dir));
    expect(v1).toHaveLength(20);
    expect(v1.every((t) => t.schema_version === undefined && t.root_cause_symbols.length > 0)).toBe(true);
  });

  for (const repo of ['immich', 'twenty']) {
    it(`frozen ${repo} tasks carry v2 fields, mechanical strata, an audit status and a split`, () => {
      const dir = abs(`experiments/03-graph-scale/dataset/v2/${repo}`);
      if (!fs.existsSync(dir)) return;
      const ts = loadTasks(dir);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) {
        expect(t.schema_version).toBe(2);
        expect(['dev', 'test']).toContain(t.split);
        expect(t.strata?.locality).toMatch(/^(local|cross_module)$/);
        expect(t.audit?.status).toMatch(/^accepted/);
        expect(t.root_cause_symbols.every((k) => t.relevant_symbols.includes(k))).toBe(true);
        if (t.task_type === 'bug_localisation') expect(t.snapshot?.kind).toBe('revert_fix');
        else expect(t.snapshot?.kind).toBe('pinned');
        if (t.task_type === 'change_impact') expect(t.impact?.direct.length).toBeGreaterThan(0);
      }
    });
  }
});
