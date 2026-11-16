// Agent head-to-head: tokens per task (lower is better) with the task score beside each bar.
// Values: experiments/03-graph-scale/results/agent/h2h-L-haiku-test-report.md and h2h-M-haiku-test-report.md (all tasks, arm means).
function draw(k, C) {
  k.text(780, 46, 'With a coding agent: fewer tokens per task', { size: 40, weight: 700 });
  k.text(780, 92, 'Claude Code + Claude Haiku 5.5 on held-out tasks, 3 runs each. Bars: tokens per task (lower is better). Right: task score.', { size: 19, color: C.ink2 });
  const names = ['+ TypeTrace', '+ graphify', '+ code-review-graph (embeddings)', 'grep / read only'];
  const panels = [
    { repo: 'Twenty server', sub: '763k lines · 18 tasks', t: [453, 521, 779, 513], s: [0.896, 0.867, 0.851, 0.837] },
    { repo: 'Immich server', sub: '63k lines · 26 tasks', t: [190, 248, 399, 235], s: [0.860, 0.833, 0.859, 0.816] },
  ];
  const W = 735, gap = 30, x0 = 30, top = 128, maxT = 800, barMax = 470;
  panels.forEach((p, j) => {
    const x = x0 + j * (W + gap);
    k.box(x, top, W, 500, { stroke: C.muted, fill: '#fefefd', strokeWidth: 1.6, roughness: 1.2 });
    k.text(x + W / 2, top + 40, p.repo, { size: 29, weight: 700 });
    k.text(x + W / 2, top + 74, p.sub, { size: 18, color: C.ink2 });
    k.text(x + W - 40, top + 106, 'task score', { size: 16, color: C.muted, anchor: 'end' });
    p.t.forEach((t, i) => {
      const y = top + 134 + i * 88;
      k.text(x + 32, y, names[i], { size: 19, anchor: 'start', weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink : C.ink2 });
      k.bar(x + 32, y + 18, (t / maxT) * barMax, 32, i === 0 ? C.blue : C.gray);
      k.text(x + 32 + (t / maxT) * barMax + 12, y + 35, `${t}k`, { size: 21, anchor: 'start', weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink : C.ink2 });
      k.text(x + W - 40, y + 35, p.s[i].toFixed(2), { size: 21, anchor: 'end', weight: i === 0 ? 700 : 400, color: i === 0 ? C.ink : C.ink2 });
    });
  });
  k.text(780, 672, 'Token savings are significant (vs graphify p ≤ 0.003, vs code-review-graph p < 0.001, vs grep-only p ≤ 0.008, Holm-corrected where pre-registered).', { size: 18, color: C.ink2 });
  k.text(780, 704, 'Task-score differences between the graph tools are small and not statistically significant with 18–26 tasks.', { size: 18, color: C.ink2 });
}
