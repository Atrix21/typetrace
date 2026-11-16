// Retrieval head-to-head (no model calls). Values: experiments/03-graph-scale/results/h2h-report.md (symbol Recall@10, full corpus).
// TypeTrace is shown as its agent tool (compact_graph, <= 800 tokens), the conservative choice; its hybrid ranking scores higher.
function draw(k, C) {
  k.text(780, 46, 'It finds the code that matters, more often', { size: 40, weight: 700 });
  k.text(780, 92, 'Recall@10: share of the functions that matter (the bug and its path) found in the top 10 results. Higher is better.', { size: 19, color: C.ink2 });
  const names = ['TypeTrace (its MCP tool)', 'code-review-graph + embeddings', 'code-review-graph (default)', 'graphify'];
  const panels = [
    { repo: 'nestjs-boilerplate', sub: '6k lines · 20 tasks', v: [0.65, 0.31, 0.18, 0.12] },
    { repo: 'Immich server', sub: '63k lines · 26 tasks', v: [0.39, 0.26, 0.03, 0.04] },
    { repo: 'Twenty server', sub: '763k lines · 18 tasks', v: [0.28, 0.10, 0.01, 0.01] },
  ];
  const W = 480, gap = 20, x0 = 30, top = 128, maxV = 0.7, barMax = 330;
  panels.forEach((p, j) => {
    const x = x0 + j * (W + gap);
    k.box(x, top, W, 540, { stroke: C.muted, fill: '#fefefd', strokeWidth: 1.6, roughness: 1.2 });
    k.text(x + W / 2, top + 40, p.repo, { size: 29, weight: 700 });
    k.text(x + W / 2, top + 74, p.sub, { size: 18, color: C.ink2 });
    p.v.forEach((v, i) => {
      const y = top + 120 + i * 102;
      k.text(x + 32, y, names[i], { size: 19, anchor: 'start', weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink : C.ink2 });
      k.bar(x + 32, y + 20, (v / maxV) * barMax, 34, i === 0 ? C.blue : C.gray);
      k.text(x + 32 + (v / maxV) * barMax + 12, y + 38, v.toFixed(2), { size: 22, anchor: 'start', weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink : C.ink2 });
    });
  });
  k.text(780, 712, 'Same files, tasks, budget and scoring for every tool · graphify 0.9.108 and code-review-graph 2.4.0 as shipped · tests pre-registered.', { size: 18, color: C.ink2 });
  k.text(780, 744, "Not just the embedding model: code-review-graph given TypeTrace's own embedder scores 0.28 / 0.23 / 0.17.", { size: 18, color: C.ink2 });
  k.text(780, 776, 'TypeScript repositories, ground truth from real merged fixes and audited code questions. Python: SWE-bench Lite run pending.', { size: 17, color: C.muted });
}
