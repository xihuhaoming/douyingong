(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(800);
  const out = { ok: true };
  try {
    out.hasCC = typeof cc !== 'undefined';
    out.ccVersion = out.hasCC ? cc.ENGINE_VERSION : null;
    const scene = cc.director.getScene();
    out.scene = scene ? scene.name : null;
    const Cls = cc.js.getClassByName('TugOfWar');
    out.clsFound = !!Cls;
    const canvas = scene ? scene.getChildByName('Canvas') : null;
    out.canvasFound = !!canvas;
    if (canvas) {
      out.canvasChildren = canvas.children.map((c) => c.name);
      const comps = canvas.components.map((c) => c.__classname__ || (c.constructor && c.constructor.name));
      out.canvasComponents = comps;
      if (Cls) {
        const comp = canvas.getComponent(Cls);
        out.compOnCanvas = !!comp;
        if (comp) {
          out.layerCount = comp.layers.length;
          out.layerPaths = comp.layers.map((l) => ({
            name: l.node.name,
            baseX: l.baseX,
            factor: l.factor,
            x: +l.node.position.x.toFixed(2),
          }));
        }
      }
    }
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
