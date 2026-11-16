// One question -> the connected code. Every node and edge below appears in TypeTrace's real output for this query on
// nestjs-boilerplate (search hit + callers/callees/route from the typed graph).
function draw(k, C) {
  k.text(750, 46, 'One question in, the connected code out', { size: 40, weight: 700 });
  k.box(330, 92, 840, 62, { title: '“a refresh token still works after the user changes their password”', stroke: C.gray, fill: C.grayFill, titleSize: 23, titleColor: C.ink2 });
  k.arrow(750, 160, 750, 214, { color: C.purple, label: 'search by meaning', lx: 850, ly: 187, labelSize: 18 });

  // centre: the search hit
  k.box(560, 222, 380, 92, { title: 'AuthService.refreshToken', sub: 'auth.service.ts:523', stroke: C.blue, fill: C.blueFill, titleSize: 25, subSize: 17, subMono: true, strokeWidth: 3 });
  k.text(750, 336, 'top result', { size: 17, color: C.purple });

  // left: who reaches it (graph, incoming)
  k.box(60, 236, 300, 64, { title: 'POST /auth/refresh', sub: 'HTTP route', stroke: C.orange, fill: C.orangeFill, titleSize: 22, subSize: 16 });
  k.box(410, 380, 290, 64, { title: 'AuthController.refresh', sub: 'auth.controller.ts:106', stroke: C.blue, fill: '#eef4fd', titleSize: 21, subSize: 15, subMono: true });
  k.arrow(210, 306, 420, 384, { color: C.orange, label: 'route handler', lx: 270, ly: 360, labelSize: 17 });
  k.arrow(600, 376, 680, 318, { color: C.ink2, label: 'calls', lx: 676, ly: 360, labelSize: 17 });

  // right: what it calls (graph, outgoing)
  const callees = [['SessionService.updateByHash', 'session.service.ts:31'], ['UsersService.findById', 'users.service.ts:147'], ['AuthService.getTokensData', 'auth.service.ts:599']];
  callees.forEach(([t, s], i) => {
    const y = 200 + i * 96;
    k.box(1110, y, 340, 64, { title: t, sub: s, stroke: C.blue, fill: '#eef4fd', titleSize: 20, subSize: 15, subMono: true });
    k.arrow(946, 268, 1104, y + 32, { color: C.ink2 });
  });
  k.text(1080, 280, 'calls', { size: 17, color: C.ink2 });

  // legend / takeaway
  k.box(150, 500, 1200, 118, { stroke: C.green, fill: C.greenFill });
  k.text(750, 534, 'Search finds the right function. The graph adds the route that reaches it and the code it calls,', { size: 22, color: C.ink });
  k.text(750, 566, 'so the agent sees the whole path in one short answer instead of grepping for each piece.', { size: 22, color: C.ink });
  k.text(750, 598, 'Links come from the TypeScript compiler (types, not name matching): calls through injected services, routes, events, DB tables.', { size: 16.5, color: C.green });
  k.text(750, 650, 'Real output on nestjs-boilerplate (6k lines). Shown: the top result and its graph neighbours. The full answer lists 9 functions in 769 tokens,', { size: 16, color: C.muted });
  k.text(750, 674, 'including AuthService.update, where the password is changed and other sessions are revoked: both halves of the question.', { size: 16, color: C.muted });
}
