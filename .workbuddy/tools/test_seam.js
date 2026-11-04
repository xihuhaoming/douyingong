(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const vs = cc.view.getVisibleSize();
    const halfW = vs.width / 2;

    out.startup = {
      maxShift: comp.maxShift,
      maskSwing: comp.maskSwing,
      centerFollows: comp.centerFollows,
      layerCount: comp.layers.length,
      hasLeftMask: !!comp.leftMask,
      hasRightMask: !!comp.rightMask,
    };

    // 用组件自己的父链算法量位置（和它内部一致）
    const lb = comp.bgLeft.node;
    const rb = comp.bgRight.node;
    const lm = comp.leftMask;
    const rm = comp.rightMask;
    const CL = canvas.getChildByName('CenterLine');

    const utOf = (n) => n.getComponent('cc.UITransform');

    const state = (tag) => {
      const lLb = comp.chainX(lb);
      const rLb = comp.chainX(rb);
      const lW = utOf(lb).width;
      const rW = utOf(rb).width;
      const lMW = utOf(lm).width;
      const rMW = utOf(rm).width;
      const bLeft = comp.chainX(lm) + lMW / 2;   // 左遮罩右边缘
      const bRight = comp.chainX(rm) - rMW / 2;  // 右遮罩左边缘

      const s = {
        tag,
        value: +comp.value.toFixed(3),
        seamLeft: +bLeft.toFixed(1),
        seamRight: +bRight.toFixed(1),
        leftMaskW: +lMW.toFixed(1),
        rightMaskW: +rMW.toFixed(1),
        leftBgCover: [+(lLb - lW / 2).toFixed(1), +(lLb + lW / 2).toFixed(1)],
        rightBgCover: [+(rLb - rW / 2).toFixed(1), +(rLb + rW / 2).toFixed(1)],
        centerX: +CL.position.x.toFixed(1),
      };
      // 左遮罩窗口 = [左遮罩左缘, 交界]；背景要盖满它
      const lMaskLeft = comp.chainX(lm) - lMW / 2;
      const rMaskRight = comp.chainX(rm) + rMW / 2;
      s.leftWindow = [+lMaskLeft.toFixed(1), +bLeft.toFixed(1)];
      s.rightWindow = [+bRight.toFixed(1), +rMaskRight.toFixed(1)];
      s.leftBgCoversWindow = s.leftBgCover[0] <= lMaskLeft + 0.5 && s.leftBgCover[1] >= bLeft - 0.5;
      s.rightBgCoversWindow = s.rightBgCover[0] <= bRight + 0.5 && s.rightBgCover[1] >= rMaskRight - 0.5;
      s.seamsMeet = Math.abs(bLeft - bRight) < 1;
      return s;
    };

    comp.recoverPerSec = 0;
    out.t0 = state('idle');

    comp.target = 1;
    await sleep(1200);
    out.atRight = state('推满右');

    comp.target = -1;
    await sleep(1200);
    out.atLeft = state('推满左');

    // 停 55% 截图
    comp.target = 0.55;
    await sleep(1000);
    out.final = state('final');
    out.centerMoved = Math.abs(out.atRight.centerX - out.t0.centerX) > 1;
    out.pass =
      out.atRight.leftBgCoversWindow && out.atRight.rightBgCoversWindow &&
      out.atLeft.leftBgCoversWindow && out.atLeft.rightBgCoversWindow &&
      out.atRight.seamsMeet && out.atLeft.seamsMeet;
    out.visible = { w: vs.width, h: vs.height, halfW };
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
