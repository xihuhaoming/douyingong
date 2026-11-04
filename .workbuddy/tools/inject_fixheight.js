(async () => {
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const pick = (name) => {
      const walk = (n) => {
        if (n.name === name) return n;
        for (const c of n.children) {
          const r = walk(c);
          if (r) return r;
        }
        return null;
      };
      return walk(scene);
    };
    const UT = (n) => (n ? n.getComponent('cc.UITransform') : null);
    const LM = pick('LeftBgMask');
    const RM = pick('RightBgMask');
    const vs = cc.view.getVisibleSize();

    out.before = { visibleH: +vs.height.toFixed(0), leftMaskH: +UT(LM).height.toFixed(0), rightMaskH: +UT(RM).height.toFixed(0) };

    const need = vs.height + 120;
    UT(LM).height = need;
    UT(RM).height = need;

    out.after = { leftMaskH: +UT(LM).height.toFixed(0), rightMaskH: +UT(RM).height.toFixed(0) };
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
