(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cc = window.cc;
  if (!cc) return { err: 'no cc' };
  let scene = null;
  for (let i = 0; i < 100; i++) {
    scene = cc.director && cc.director.getScene();
    if (scene && scene.name) break;
    await sleep(300);
  }
  const findAll = (n, name, out) => {
    if (!n) return out;
    if (n.name === name) out.push(n);
    (n.children || []).forEach((c) => findAll(c, name, out));
    return out;
  };
  const canvases = findAll(scene, 'Canvas', []);
  const allComps = [];
  canvases.forEach((c) =>
    (c.components || []).forEach((x) => {
      if (x && x.constructor && x.constructor.name === 'TugOfWar') allComps.push(x);
    }),
  );
  const comp = allComps[0];
  if (!comp) return { err: 'no comp', canvases: canvases.length };

  const before = {
    scene: scene.name,
    canvasCount: canvases.length,
    compCount: allComps.length,
    canvasActive: canvases[0].activeInHierarchy,
    onLoadCalled: comp._isOnLoadCalled,
    bgLeft: !!comp.bgLeft,
    bgRight: !!comp.bgRight,
    stepL: comp.stepL,
    hud: !!comp.hud,
  };

  // 再手动跑一次 start，把真实异常抓出来
  let thrown = null;
  try {
    comp.start();
  } catch (e) {
    thrown = (e && e.stack) || String(e);
  }

  return {
    before,
    thrown,
    after: {
      stepL: comp.stepL,
      stepR: comp.stepR,
      rangeRight: comp.rangeRight,
      rangeLeft: comp.rangeLeft,
      hud: !!comp.hud,
      scoreL: comp.scoreL ? comp.scoreL.string : null,
      animL: String(comp.animL),
    },
  };
})()
