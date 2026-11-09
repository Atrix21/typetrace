/** Experiment 3 metrics on hand-made cases: path recall@k and impact precision/recall/F1@k. */
import { describe, expect, it } from 'vitest';
import { impactPRF, pathRecall } from '../../src/evaluation/metrics-v2.js';

describe('path recall', () => {
  const path = ['a', 'b', 'c', 'd'];
  it('counts consecutive ground-truth pairs whose both ends are in the top k', () => {
    expect(pathRecall(['a', 'b', 'x', 'c'], 10, path)).toBeCloseTo(2 / 3); // a-b, b-c hit; c-d missed
    expect(pathRecall(['a', 'b', 'x', 'c'], 2, path)).toBeCloseTo(1 / 3); // only a-b within top 2
    expect(pathRecall(['d', 'c', 'b', 'a'], 10, path)).toBe(1); // set membership, order of retrieval irrelevant
    expect(pathRecall([], 10, path)).toBe(0);
  });
  it('is undefined (null) without a path of at least two steps', () => {
    expect(pathRecall(['a'], 10, ['a'])).toBeNull();
    expect(pathRecall(['a'], 10, undefined)).toBeNull();
  });
});

describe('impact precision / recall / F1', () => {
  it('scores the top k against direct ∪ indirect impact', () => {
    const r = impactPRF(['a', 'x', 'b', 'y'], 4, { direct: ['a', 'b'], indirect: ['c'] })!;
    expect(r.p).toBeCloseTo(0.5);
    expect(r.r).toBeCloseTo(2 / 3);
    expect(r.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3));
  });
  it('handles empty predictions and missing ground truth', () => {
    expect(impactPRF([], 20, { direct: ['a'] })).toEqual({ p: 0, r: 0, f1: 0 });
    expect(impactPRF(['a'], 20, { direct: [], indirect: [] })).toBeNull();
  });
});
