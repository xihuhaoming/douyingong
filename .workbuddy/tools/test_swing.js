(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const CL = canvas.getChildByName('CenterLine');
    const vs = cc.view.getVisibleSize();

    out.hasCenterSwing = typeof comp.centerSwing !== 'undefined';
    comp.recoverPerSec = 0;

    // A) centerSwing = 0 → 中线必须一动不动
    comp.target = 1;
    await sleep(1200);
    out.A_fixed = { centerSwing: comp.centerSwing, centerX: +CL.position.x.toFixed(2), value: +comp.value.toFixed(3) };

    // B) centerSwing = 90 → 中线变成「战线」，小幅摆动
    comp.centerSwing = 90;
    await sleep(250);
    out.B_swing = { centerSwing: comp.centerSwing, centerX: +CL.position.x.toFixed(2), expected: +(-1 * comp.value * 90 + CL.position.x + comp.value * 90).toFixed(2) };

    // 停在一个「中间态」截图：右方推进 62% + 中线摆动
    comp.target = 0.62;
    await sleep(1200);
    out.final = {
      value: +comp.value.toFixed(3),
      centerX: +CL.position.x.toFixed(2),
      leftBgX: +canvas.getChildByName('Background').getChildByName('LeftBackground').position.x.toFixed(1),
      leftPlayerWorldX: +canvas.getChildByName('CenterWu').getChildByName('Left_Player').position.x.toFixed(1),
      halfW: +(vs.width / 2).toFixed(1),
    };
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
