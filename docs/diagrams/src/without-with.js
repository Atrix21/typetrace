// Without vs with TypeTrace: the grep-and-read loop vs one call that returns a map. Numbers: Twenty server, Claude Haiku 5.5,
// 18 held-out tasks x 3 runs (experiments/03-graph-scale/results/agent/h2h-L-haiku-test-report.md).
function draw(k, C) {
  k.text(750, 46, 'Finding the code for a task in a big repository', { size: 40, weight: 700 });
  k.line(750, 100, 750, 690, { color: C.muted, dash: [8, 10] });

  // ---- without
  k.text(375, 118, 'Without TypeTrace', { size: 32, weight: 700, color: C.red });
  k.box(200, 150, 350, 66, { title: 'Coding agent', stroke: C.ink, fill: C.grayFill, titleSize: 26 });
  k.arrow(375, 222, 375, 300, { color: C.red, label: 'grep → open file → grep → open file …', ly: 262, lx: 568, labelSize: 19 });
  k.box(60, 310, 630, 270, { stroke: C.muted, fill: '#f6f5f1', roughness: 1.4 });
  const opened = new Set([1, 3, 6, 8, 11, 12, 15, 18]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    const i = r * 5 + c, x = 90 + c * 120, y = 330 + r * 60;
    k.box(x, y, 92, 40, { stroke: opened.has(i) ? C.red : C.muted, fill: opened.has(i) ? C.redFill : C.grayFill, strokeWidth: 1.6, roughness: 0.9 });
  }
  k.text(375, 600, 'reads file after file to find the right ones', { size: 19, color: C.ink2 });
  k.box(185, 625, 380, 58, { title: '513k tokens per task', stroke: C.red, fill: C.redFill, titleSize: 26 });

  // ---- with
  k.text(1125, 118, 'With TypeTrace', { size: 32, weight: 700, color: C.green });
  k.box(950, 150, 350, 66, { title: 'Coding agent', stroke: C.ink, fill: C.grayFill, titleSize: 26 });
  k.arrow(1125, 222, 1125, 268, { color: C.blue, label: 'asks once: find_relevant_code', lx: 1270, ly: 245, labelSize: 19 });
  k.ellipse(1125, 296, 230, 56, { stroke: C.blue, fill: C.blueFill, title: 'TypeTrace', size: 24 });
  k.arrow(1125, 326, 1125, 368, { color: C.blue });
  k.box(812, 372, 628, 150, { stroke: C.green, fill: C.greenFill });
  k.text(832, 398, 'a map, not a pile of files (real output on a small repo, excerpt):', { size: 18, color: C.green, anchor: 'start' });
  const rows = ['1. AuthService.refreshToken   auth.service.ts:523', '   → calls SessionService.updateByHash, UsersService.findById', '   ← called by AuthController.refresh', '4. AuthController.refresh      ← route: /auth/refresh'];
  rows.forEach((t, i) => k.text(832, 430 + i * 25, t, { size: 15.5, mono: true, anchor: 'start', color: C.ink }));
  k.arrow(1125, 526, 1125, 548, { color: C.green });
  for (let i = 0; i < 3; i++) k.box(985 + i * 105, 552, 92, 34, { stroke: C.green, fill: C.greenFill, strokeWidth: 1.6, roughness: 0.9 });
  k.text(1125, 607, 'then opens just the files that matter', { size: 19, color: C.ink2 });
  k.box(935, 625, 380, 58, { title: '453k tokens per task', stroke: C.green, fill: C.greenFill, titleSize: 26 });

  // ---- bottom line
  k.box(110, 718, 1280, 64, { title: 'Fewer tokens, same or better answers (task score 0.90 vs 0.84)', stroke: C.blue, fill: C.blueFill, titleSize: 27 });
  k.text(750, 815, 'Twenty server (763k lines) · Claude Haiku 5.5 · 18 held-out tasks × 3 runs · grep-only agent vs agent + TypeTrace.', { size: 17, color: C.muted });
  k.text(750, 840, 'Token savings replicate on Immich and with Sonnet; accuracy gains vs. other graph tools are not statistically significant.', { size: 17, color: C.muted });
}
