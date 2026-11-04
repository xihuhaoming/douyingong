(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cc = window.cc;
  if (!cc) return { err: 'no cc' };
  const scene = cc.director.getScene();
  const findAll = (n, name, out) => {
    if (n.name === name) out.push(n);
    n.children.forEach((c) => findAll(c, name, out));
    return out;
  };
  const canvas = findAll(scene, 'Canvas', [])[0];
  if (!canvas) return { err: 'no Canvas' };
  const comps = canvas.components || [];
  const comp = comps.find((c) => c && c.constructor && c.constructor.name === 'TugOfWar');
  if (!comp) return { err: 'TugOfWar not found', have: comps.map((c) => c && c.constructor && c.constructor.name) };

  const out = {};
  out.visible = { w: cc.view.getVisibleSize().width, h: cc.view.getVisibleSize().height };
  out.rangeRight = comp.rangeRight;
  out.rangeLeft = comp.rangeLeft;
  out.bgL0 = comp.bgL0;
  out.bgR0 = comp.bgR0;
  out.runtimeButtons = comp.runtimeButtons;
  out.layers = comp.layers.map((l) => ({ name: l.node.name, base: l.baseLocalX, side: l.side, factor: l.factor }));

  // 直接验证运行时 chainX / spanX（跨 UICanvas 兄弟节点的坐标系问题）
  const sp = (name) => {
    const n = findAll(scene, name, [])[0];
    return n ? comp.spanX(n) : null;
  };
  out.spans = {
    LeftBackground: comp.spanX(comp.bgLeft),
    RightBackground: comp.spanX(comp.bgRight),
    LeftBgMask: sp('LeftBgMask'),
    RightBgMask: sp('RightBgMask'),
    CenterLine: sp('CenterLine'),
    Canvas: comp.spanX(canvas),
  };

  const snap = () => ({
    L: +comp.bgLeft.position.x.toFixed(2),
    R: +comp.bgRight.position.x.toFixed(2),
    value: +comp.value.toFixed(4),
    players: {
      Left_Player: (() => { const n = findAll(scene, 'Left_Player', [])[0]; return n ? +n.position.x.toFixed(2) : null; })(),
      Right_Player: (() => { const n = findAll(scene, 'Right_Player', [])[0]; return n ? +n.position.x.toFixed(2) : null; })(),
    },
    actors: comp.layers.reduce((a, l) => { a[l.node.name] = +l.node.position.x.toFixed(2); return a; }, {}),
  });

  comp.leftPower = 29994;
  comp.rightPower = 26320;
  comp.value = 0;
  await sleep(120);
  out.atRest = snap();

  for (let i = 0; i < 8; i++) comp.addPower(1);
  await sleep(1500);
  out.afterRight = snap();

  comp.leftPower = 29994;
  comp.rightPower = 26320;
  comp.value = 0;
  await sleep(900);
  for (let i = 0; i < 8; i++) comp.addPower(-1);
  await sleep(1500);
  out.afterLeft = snap();

  out.dRight = +(out.afterRight.L - out.atRest.L).toFixed(2);
  out.dLeft = +(out.afterLeft.L - out.atRest.L).toFixed(2);
  return out;
})()
