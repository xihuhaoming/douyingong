(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { steps: [] };
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const UT = (n) => (n ? n.getComponent('cc.UITransform') : null);
    const chain = (n) => comp.chainX(n);

    const LB = comp.bgLeft.node;
    const RB = comp.bgRight.node;
    const LP = comp.pick('Left_Player');
    const RP = comp.pick('Right_Player');
    const CL = comp.pick('CenterLine');
    const LM = comp.leftMask;
    const RM = comp.rightMask;

    out.setup = {
      leftPower: comp.leftPower,
      rightPower: comp.rightPower,
      bgShift: comp.bgShift,
      maskSwing: comp.seamSwing,
      powerGain: comp.powerGain,
      value0: +comp.value.toFixed(3),
    };

    const snap = (tag) => {
      const lx = chain(LB);
      const rx = chain(RB);
      const lw = UT(LB).width;
      const rw = UT(RB).width;
      const lme = chain(LM) - UT(LM).width / 2;
      const lmr = chain(LM) + UT(LM).width / 2;
      const rme = chain(RM) - UT(RM).width / 2;
      const rmr = chain(RM) + UT(RM).width / 2;
      const s = {
        tag,
        value: +comp.value.toFixed(3),
        left: +(comp.leftPower).toFixed(0),
        right: +(comp.rightPower).toFixed(0),
        leftBgX: +lx.toFixed(1),
        rightBgX: +rx.toFixed(1),
        // 两图相对初始位置走了多少
        leftMove: +(lx - comp.bgLeft.baseWorldX).toFixed(1),
        rightMove: +(rx - comp.bgRight.baseWorldX).toFixed(1),
        leftPlayerX: +chain(LP).toFixed(1),
        centerX: +CL.position.x.toFixed(1),
        leftWin: [+lme.toFixed(1), +lmr.toFixed(1)],
        rightWin: [+rme.toFixed(1), +rmr.toFixed(1)],
        leftBgCover: [+(lx - lw / 2).toFixed(1), +(lx + lw / 2).toFixed(1)],
        rightBgCover: [+(rx - rw / 2).toFixed(1), +(rx + rw / 2).toFixed(1)],
      };
      s.leftNoGap = s.leftBgCover[0] <= lme + 0.5 && s.leftBgCover[1] >= lmr - 0.5;
      s.rightNoGap = s.rightBgCover[0] <= rme + 0.5 && s.rightBgCover[1] >= rmr - 0.5;
      s.opposite = s.leftMove * s.rightMove < 0 || (s.leftMove === 0 && s.rightMove === 0);
      return s;
    };

    out.steps.push(snap('初始 29994:26320'));

    const btnL = canvas.getChildByName('BtnLeft');
    const btnR = canvas.getChildByName('BtnRight');

    // 点左 10 下
    for (let i = 0; i < 10; i++) { btnL.emit('click'); await sleep(25); }
    await sleep(800);
    out.afterLeft10 = snap('点左 10 下');

    // 点右 25 下（推回来还超过去）
    for (let i = 0; i < 25; i++) { btnR.emit('click'); await sleep(25); }
    await sleep(800);
    out.afterRight25 = snap('点右 25 下');

    out.pass =
      out.afterLeft10.leftMove < 0 && out.afterLeft10.rightMove > 0 &&
      out.afterRight25.leftMove > 0 && out.afterRight25.rightMove < 0 &&
      out.afterLeft10.leftNoGap && out.afterLeft10.rightNoGap &&
      out.afterRight25.leftNoGap && out.afterRight25.rightNoGap;

    // 停在一个有明显位移的状态截图
    for (let i = 0; i < 6; i++) { btnR.emit('click'); await sleep(25); }
    await sleep(900);
    out.final = snap('final');
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
