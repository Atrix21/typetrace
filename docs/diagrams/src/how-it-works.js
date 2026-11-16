// How TypeTrace works: repo -> compiler graph -> search -> follow links -> short answer.
function draw(k, C) {
  k.text(850, 48, 'How TypeTrace works', { size: 44, weight: 700 });
  const y = 120, h = 150, w = 268, gap = 62, x0 = 55;
  const steps = [
    { title: 'Your repo', sub: 'TypeScript\n(Python: experimental)', stroke: C.gray, fill: C.grayFill },
    { title: 'Read the code', sub: 'the TypeScript compiler\nbuilds a typed call graph', stroke: C.orange, fill: C.orangeFill },
    { title: 'Search', sub: 'by words (BM25) and\nby meaning (local model)', stroke: C.purple, fill: C.purpleFill },
    { title: 'Follow the links', sub: 'callers · callees · routes\nevents · injected services', stroke: C.blue, fill: C.blueFill },
    { title: 'Short answer', sub: '≤ 800 tokens of\nfile:line pointers', stroke: C.green, fill: C.greenFill },
  ];
  steps.forEach((s, i) => {
    const x = x0 + i * (w + gap);
    k.box(x, y, w, h, { ...s, titleSize: 28, subSize: 19 });
    if (i < steps.length - 1) k.arrow(x + w + 8, y + h / 2, x + w + gap - 8, y + h / 2, { color: C.ink2 });
  });
  k.line(x0, 320, x0 + 5 * w + 4 * gap, 320, { color: C.muted });
  k.line(x0, 310, x0, 320, { color: C.muted });
  k.line(x0 + 5 * w + 4 * gap, 310, x0 + 5 * w + 4 * gap, 320, { color: C.muted });
  k.text(850, 352, 'Runs on your machine · no API keys · one MCP tool for the agent: find_relevant_code', { size: 22, color: C.ink2 });
  k.text(850, 384, 'Indexes are cached; re-indexing only embeds code that changed.', { size: 18, color: C.muted });
}
