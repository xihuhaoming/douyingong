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
    const absX = (s) => {
      let x = 0;
      let c = s;
      while (c) {
        x += c.position.x;
        c = c.parent;
      }
      return x;
    };
    const chainX = (n) => absX(n) - absX(canvas);
    const UT = (n) => (n ? n.getComponent('cc.UITransform') : null);

    const L = pick('LeftBackground');
    const R = pick('RightBackground');
    const LL = pick('Left_Land');
    const RL = pick('Right_Land');
    const LP = pick('Left_Player');
    const RP = pick('Right_Player');
    const LM = pick('LeftBgMask');
    const RM = pick('RightBgMask');
    const CL = pick('CenterLine');

    out.debug = { L: !!L, R: !!R, LL: !!LL, RL: !!RL, LP: !!LP, RP: !!RP, LM: !!LM, RM: !!RM, CL: !!CL, ut: [!!UT(L), !!UT(LM)] };
    const base = { L: chainX(L), R: chainX(R), LL: chainX(LL), RL: chainX(RL), LP: chainX(LP), RP: chainX(RP) };
    const LM_EDGE = chainX(LM) - UT(LM).width / 2;
    const RM_EDGE = chainX(RM) + UT(RM).width / 2;
    const maskParentX = chainX(LM.parent);
    const CL_BASE = CL.position.x;
    const SWING = 80;
    const halfL = UT(L).width / 2;
    const halfR = UT(R).width / 2;
    const MAXS = Math.floor(Math.min(
      LM_EDGE - (base.L - halfL),          // 左背景左缘
      base.L + halfL + SWING,              // 左背景内缘 + 交界摆动
      base.R + halfR - RM_EDGE,            // 右背景右缘
      SWING - (base.R - halfR),            // 右背景内缘
    ));

    out.setup = {
      base,
      leftMaskEdge: +LM_EDGE.toFixed(1),
      rightMaskEdge: +RM_EDGE.toFixed(1),
      maskParentX: +maskParentX.toFixed(1),
      swing: SWING,
      maxShift: MAXS,
      visible: cc.view.getVisibleSize(),
    };

    const place = (node, target, parentX) => node.setPosition(target - parentX, node.position.y, 0);

    const apply = (v) => {
      const b = -v * SWING;
      let w = Math.max(1, b - LM_EDGE);
      UT(LM).width = w;
      LM.setPosition(LM_EDGE + w / 2 - maskParentX, LM.position.y, 0);
      let w2 = Math.max(1, RM_EDGE - b);
      UT(RM).width = w2;
      RM.setPosition(RM_EDGE - w2 / 2 - maskParentX, RM.position.y, 0);

      CL.setPosition(CL_BASE + b, CL.position.y, 0);

      const shift = -v * MAXS;
      place(L, base.L + shift * 1.0, maskParentX + LM.position.x);
      place(R, base.R + shift * 1.0, maskParentX + RM.position.x);
      place(LL, base.LL + shift * 0.85, chainX(LL.parent));
      place(RL, base.RL + shift * 0.85, chainX(RL.parent));
      place(LP, base.LP + shift * 0.72, chainX(LP.parent));
      place(RP, base.RP + shift * 0.72, chainX(RP.parent));
    };

    const snap = (tag, v) => {
      const lx = chainX(L);
      const rx = chainX(R);
      const lw = UT(L).width;
      const rw = UT(R).width;
      const lme = chainX(LM) - UT(LM).width / 2;
      const lmr = chainX(LM) + UT(LM).width / 2;
      const rme = chainX(RM) - UT(RM).width / 2;
      const rmr = chainX(RM) + UT(RM).width / 2;
      return {
        tag,
        v: +v.toFixed(2),
        seamLeft: +lmr.toFixed(1),
        seamRight: +rme.toFixed(1),
        seamMeet: Math.abs(lmr - rme) < 1,
        leftMaskW: +UT(LM).width.toFixed(1),
        rightMaskW: +UT(RM).width.toFixed(1),
        leftBg: [+(lx - lw / 2).toFixed(1), +(lx + lw / 2).toFixed(1)],
        rightBg: [+(rx - rw / 2).toFixed(1), +(rx + rw / 2).toFixed(1)],
        leftWin: [+lme.toFixed(1), +lmr.toFixed(1)],
        rightWin: [+rme.toFixed(1), +rmr.toFixed(1)],
        leftNoGap: lx - lw / 2 <= lme + 0.5 && lx + lw / 2 >= lmr - 0.5,
        rightNoGap: rx - rw / 2 <= rme + 0.5 && rx + rw / 2 >= rmr - 0.5,
        centerX: +CL.position.x.toFixed(1),
      };
    };

    // 补遮罩高度：设计 1334 但可见高 1588，不补就上下黑边
    const needH = cc.view.getVisibleSize().height + 120;
    UT(LM).height = needH;
    UT(RM).height = needH;
    out.maskHeight = +needH.toFixed(0);

    apply(0);
    out.idle = snap('idle', 0);
    apply(1);
    out.right = snap('推满右', 1);
    apply(-1);
    out.left = snap('推满左', -1);
    apply(0.55);
    await new Promise((r) => setTimeout(r, 120));
    out.final = snap('final 55%', 0.55);

    out.pass =
      out.idle.leftNoGap && out.idle.rightNoGap &&
      out.right.leftNoGap && out.right.rightNoGap &&
      out.left.leftNoGap && out.left.rightNoGap &&
      out.right.seamMeet && out.left.seamMeet;
    out.centerSwing = [+out.left.centerX.toFixed(1), +out.right.centerX.toFixed(1)];
    out.maskWidthRange = [[out.left.leftMaskW, out.right.rightMaskW], [out.right.leftMaskW, out.left.rightMaskW]];
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
