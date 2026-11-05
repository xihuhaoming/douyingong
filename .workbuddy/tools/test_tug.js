(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { steps: [] };
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const Cls = cc.js.getClassByName('TugOfWar');
    const comp = canvas.getComponent(Cls);
    const find = (p) => {
      const parts = p.split('/').slice(1);
      let n = canvas;
      for (const s of parts) n = n && n.getChildByName(s);
      return n;
    };
    const LB = find('Canvas/Background/LeftBackground');
    const RB = find('Canvas/Background/RightBackground');
    const LP = find('Canvas/CenterWu/Left_Player');
    const RP = find('Canvas/CenterWu/Right_Player');
    const CL = canvas.getChildByName('CenterLine');
    const btnL = canvas.getChildByName('BtnLeft');
    const btnR = canvas.getChildByName('BtnRight');

    const snap = (tag) => ({
      tag,
      value: +comp.value.toFixed(4),
      target: +comp.target.toFixed(4),
      leftBgX: +LB.position.x.toFixed(2),
      rightBgX: +RB.position.x.toFixed(2),
      leftPlayerX: +LP.position.x.toFixed(2),
      rightPlayerX: +RP.position.x.toFixed(2),
      centerLineX: +CL.position.x.toFixed(2),
    });

    // 屏幕可见范围（设计坐标）
    const vs = cc.view.getVisibleSize();
    out.visible = { w: +vs.width.toFixed(1), h: +vs.height.toFixed(1), halfW: +(vs.width / 2).toFixed(1) };

    out.base = snap('base');
    out.steps.push(out.base);

    // ---- 点 10 下「推右」
    for (let i = 0; i < 10; i++) {
      btnR.emit('click');
      await sleep(30);
    }
    await sleep(700);
    const afterRight = snap('after 10x 推右');
    out.steps.push(afterRight);

    // 几何自检：两张背景是否仍然盖满屏幕
    const lbUt = LB.getComponent('cc.UITransform');
    const rbUt = RB.getComponent('cc.UITransform');
    out.coverRight = {
      leftBgLeftEdge: +(afterRight.leftBgX - lbUt.width / 2).toFixed(1),
      leftBgRightEdge: +(afterRight.leftBgX + lbUt.width / 2).toFixed(1),
      rightBgLeftEdge: +(afterRight.rightBgX - rbUt.width / 2).toFixed(1),
      rightBgRightEdge: +(afterRight.rightBgX + rbUt.width / 2).toFixed(1),
      screenLeft: +(-vs.width / 2).toFixed(1),
      screenRight: +(vs.width / 2).toFixed(1),
    };
    out.coverRight.seamAtRightBgLeft = +out.coverRight.rightBgLeftEdge.toFixed(1);

    window.__shotA = true;

    // ---- 再点 24 下「推左」（反向推过头，验证左方占优）
    for (let i = 0; i < 24; i++) {
      btnL.emit('click');
      await sleep(30);
    }
    await sleep(700);
    const afterLeft = snap('after 24x 推左');
    out.steps.push(afterLeft);
    out.coverLeft = {
      leftBgLeftEdge: +(afterLeft.leftBgX - lbUt.width / 2).toFixed(1),
      leftBgRightEdge: +(afterLeft.leftBgX + lbUt.width / 2).toFixed(1),
      rightBgLeftEdge: +(afterLeft.rightBgX - rbUt.width / 2).toFixed(1),
      rightBgRightEdge: +(afterLeft.rightBgX + rbUt.width / 2).toFixed(1),
    };

    // ---- 结论
    out.assert = {
      // 点右后：整体左移
      rightPushMovesWorldLeft: afterRight.leftBgX < out.base.leftBgX && afterRight.rightBgX < out.base.rightBgX,
      // 中线一动不动
      centerLineFixed: afterRight.centerLineX === out.base.centerLineX && afterLeft.centerLineX === out.base.centerLineX,
      // 视差：人物动得比背景少
      parallax: Math.abs(afterRight.leftPlayerX - out.base.leftPlayerX) <
                Math.abs(afterRight.leftBgX - out.base.leftBgX),
      // 背景仍盖满屏幕（不露黑边）
      noGapRight: out.coverRight.rightBgRightEdge >= out.coverRight.screenRight &&
                  out.coverRight.leftBgLeftEdge <= out.coverRight.screenLeft,
      noGapLeft: out.coverLeft.leftBgLeftEdge <= out.coverRight.screenLeft &&
                 out.coverLeft.rightBgRightEdge >= out.coverRight.screenRight,
    };
    out.assert.ALL_PASS = Object.values(out.assert).every(Boolean);

    // 停在「右方推满」状态给截图看
    for (let i = 0; i < 30; i++) { btnR.emit('click'); await sleep(20); }
    await sleep(900);
    out.final = snap('final 右方推满');
    out.finalPct = +comp.value.toFixed(3);
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
