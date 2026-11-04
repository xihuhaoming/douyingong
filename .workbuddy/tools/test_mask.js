(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    const scene = cc.director.getScene();
    const canvas = scene.getChildByName('Canvas');
    const comp = canvas.getComponent(cc.js.getClassByName('TugOfWar'));
    const bg = canvas.getChildByName('Background');
    const vs = cc.view.getVisibleSize();
    const halfW = vs.width / 2;

    out.before = { maxShift: comp.maxShift, bgChildren: bg.children.map((c) => c.name) };

    // 手动开遮罩（不走 onLoad，省得跟编辑器抢场景文件）
    comp.useMask = true;
    comp.applyMask();
    await sleep(300);

    out.after = {
      maxShift: comp.maxShift,
      bgChildren: bg.children.map((c) => c.name),
      masks: ['LeftMask', 'RightMask'].map((n) => {
        const m = bg.getChildByName(n);
        if (!m) return null;
        const ut = m.getComponent('cc.UITransform');
        const mk = m.getComponent('cc.Mask');
        return {
          name: n,
          x: +m.position.x.toFixed(1),
          size: ut ? [+ut.width.toFixed(0), +ut.height.toFixed(0)] : null,
          maskType: mk ? mk.type : 'NO_MASK',
          child: m.children.map((c) => ({ n: c.name, x: +c.position.x.toFixed(1) })),
        };
      }),
    };

    const LB = bg.getChildByName('LeftMask').getChildByName('LeftBackground');
    const RB = bg.getChildByName('RightMask').getChildByName('RightBackground');
    const LBW = LB.getComponent('cc.UITransform').width;
    const RBW = RB.getComponent('cc.UITransform').width;

    // 两侧极限：背景是否还盖得住自己的半屏窗口
    const cover = (tag) => {
      // 世界坐标（Canvas 内，原点在屏幕中心）
      const lbx = LB.worldPosition.x - canvas.worldPosition.x;
      const rbx = RB.worldPosition.x - canvas.worldPosition.x;
      const r = {
        value: +comp.value.toFixed(3),
        leftWindow: [-halfW, 0],
        rightWindow: [0, halfW],
        leftBgCover: [+(lbx - LBW / 2).toFixed(1), +(lbx + LBW / 2).toFixed(1)],
        rightBgCover: [+(rbx - RBW / 2).toFixed(1), +(rbx + RBW / 2).toFixed(1)],
      };
      r.leftNoGap = r.leftBgCover[0] <= -halfW && r.leftBgCover[1] >= 0;
      r.rightNoGap = r.rightBgCover[0] <= 0 && r.rightBgCover[1] >= halfW;
      return r;
    };

    comp.recoverPerSec = 0;
    comp.target = 1;
    await sleep(1200);
    out.atRight = cover('right');
    comp.target = -1;
    await sleep(1200);
    out.atLeft = cover('left');

    // 停 60% 截图
    comp.target = 0.6;
    await sleep(900);
    out.final = cover('final');
    out.centerLineX = +canvas.getChildByName('CenterLine').position.x.toFixed(2);
    out.pass = out.atRight.leftNoGap && out.atRight.rightNoGap && out.atLeft.leftNoGap && out.atLeft.rightNoGap;
  } catch (e) {
    out.err = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
