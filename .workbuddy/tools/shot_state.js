(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mode = (location.hash || '').replace('#', '') || 'right';
  const out = { mode };
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const g = (p) => {
      let n = canvas;
      for (const s of p.split('/')) n = n && n.getChildByName(s);
      return n;
    };
    const LB = g('Background/LeftBackground');
    const RB = g('Background/RightBackground');
    const LL = g('CenterWu/Left_Land');
    const RL = g('CenterWu/Right_Land');
    const LP = g('CenterWu/Left_Player');
    const RP = g('CenterWu/Right_Player');
    const CL = canvas.getChildByName('CenterLine');
    const vs = cc.view.getVisibleSize();
    const halfW = vs.width / 2;

    if (mode === 'bgonly') {
      // 对照：只让背景动，地台/人物钉在原地 —— 看会发生什么
      comp.layers.forEach((l) => {
        if (l.factor !== 1) l.factor = 0;
      });
    }

    // 直接顶到极限，验证最大位移下会不会露黑边
    comp.recoverPerSec = 0;
    comp.target = mode === 'left' ? -1 : 1;
    await sleep(1500);

    const lbW = LB.getComponent('cc.UITransform').width;
    const rbW = RB.getComponent('cc.UITransform').width;
    const edges = {
      leftBgLeft: +(LB.position.x - lbW / 2).toFixed(1),
      leftBgRight: +(LB.position.x + lbW / 2).toFixed(1),
      rightBgLeft: +(RB.position.x - rbW / 2).toFixed(1),
      rightBgRight: +(RB.position.x + rbW / 2).toFixed(1),
      screenLeft: +(-halfW).toFixed(1),
      screenRight: +halfW.toFixed(1),
    };
    out.edges = edges;
    out.noBlackGap = edges.leftBgLeft <= edges.screenLeft && edges.rightBgRight >= edges.screenRight;
    out.positions = {
      value: +comp.value.toFixed(3),
      leftBg: +LB.position.x.toFixed(1),
      rightBg: +RB.position.x.toFixed(1),
      leftLand: +LL.position.x.toFixed(1),
      rightLand: +RL.position.x.toFixed(1),
      leftPlayer: +LP.position.x.toFixed(1),
      rightPlayer: +RP.position.x.toFixed(1),
      centerLine: +CL.position.x.toFixed(1),
    };

    // 中线两侧当前是什么颜色（用背景边缘 vs 中线的相对位置表述）
    out.seam = {
      // 中线在屏幕 x≈0；此刻中线左侧由谁覆盖
      leftOfCenter: edges.rightBgLeft <= -1 ? 'RightBackground（魔界）' : 'LeftBackground（天界）',
      rightBgLeftEdgeVsCenter: +edges.rightBgLeft.toFixed(1),
    };
    // 人物是否还在画面里
    out.playerOnScreen = {
      leftIn: LP.position.x > -halfW && LP.position.x < halfW,
      rightIn: RP.position.x > -halfW && RP.position.x < halfW,
    };
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
