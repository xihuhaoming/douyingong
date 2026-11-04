(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const btnL = canvas.getChildByName('BtnLeft');
    const btnR = canvas.getChildByName('BtnRight');
    const hud = canvas.getChildByName('HudText').getComponent('cc.Label');
    const CL = canvas.getChildByName('CenterLine');
    const LB = canvas.getChildByName('Background').getChildByName('LeftBackground');
    const RB = canvas.getChildByName('Background').getChildByName('RightBackground');

    out.hudDefault = hud.string;
    out.recoverPerSec = comp.recoverPerSec;

    // 点 6 下推右
    for (let i = 0; i < 6; i++) { btnR.emit('click'); await sleep(40); }
    await sleep(400);
    const v1 = comp.value;
    out.afterTap = { value: +v1.toFixed(4), hud: hud.string };

    // 等 4 秒，看回弹（0.02/s * 4 = 0.08）
    await sleep(4000);
    const v2 = comp.value;
    out.after4s = { value: +v2.toFixed(4), hud: hud.string };
    out.recoverWorks = v2 < v1 - 0.05;
    out.recoverDrop = +(v1 - v2).toFixed(4);

    // 停在 60% 左右，截图用
    comp.target = 0.62;
    await sleep(900);
    out.final = {
      value: +comp.value.toFixed(3),
      hud: hud.string,
      leftBgX: +LB.position.x.toFixed(1),
      rightBgX: +RB.position.x.toFixed(1),
      centerX: +CL.position.x.toFixed(2),
      btnL: [+btnL.position.x.toFixed(0), +btnL.position.y.toFixed(0)],
      btnR: [+btnR.position.x.toFixed(0), +btnR.position.y.toFixed(0)],
      btnSize: comp.btnSize,
    };
    // 按钮是否在屏幕内
    const vs = cc.view.getVisibleSize();
    out.buttonsInside = Math.abs(out.final.btnL[0]) + comp.btnSize / 2 <= vs.width / 2 &&
                        Math.abs(out.final.btnR[0]) + comp.btnSize / 2 <= vs.width / 2;
    out.centerLineNeverMoved = CL.position.x === -1.13900000000001 || Math.abs(CL.position.x + 1.139) < 0.001;
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
