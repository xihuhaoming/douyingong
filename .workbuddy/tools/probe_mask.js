(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const bg = canvas.getChildByName('Background');
    out.useMask = comp.useMask;
    out.maxShift = comp.maxShift;
    out.bgChildren = bg.children.map((c) => c.name);
    const lm = bg.getChildByName('LeftMask');
    const rm = bg.getChildByName('RightMask');
    out.masks = [lm, rm].map((m) => {
      if (!m) return null;
      const ut = m.getComponent('cc.UITransform');
      const mk = m.getComponent('cc.Mask');
      return {
        name: m.name,
        pos: [+m.position.x.toFixed(1), +m.position.y.toFixed(1)],
        size: ut ? [+ut.width.toFixed(1), +ut.height.toFixed(1)] : null,
        hasMask: !!mk,
        maskType: mk ? mk.type : null,
        children: m.children.map((c) => ({ name: c.name, x: +c.position.x.toFixed(1) })),
      };
    });
    // 背景还在不在原来的世界位置
    const layerOf = (n) => {
      const bgL = comp.layers.find((l) => l.node.name === n);
      return bgL ? { baseX: +bgL.baseX.toFixed(1), x: +bgL.node.position.x.toFixed(1), worldX: +(bgL.node.worldPosition.x - canvas.worldPosition.x).toFixed(1) } : null;
    };
    out.leftBg = layerOf('LeftBackground');
    out.rightBg = layerOf('RightBackground');
    out.visible = cc.view.getVisibleSize();
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
