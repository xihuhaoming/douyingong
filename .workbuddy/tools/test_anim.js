(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cc = window.cc;
  if (!cc) return { err: 'no cc' };
  // 预览首开很慢，等场景真的起来
  let scene = null;
  for (let i = 0; i < 100; i++) {
    scene = cc.director && cc.director.getScene();
    if (scene && scene.name) break;
    await sleep(300);
  }
  if (!scene || !scene.name) return { err: 'scene not ready' };
  const findAll = (n, name, out) => {
    if (!n) return out;
    if (n.name === name) out.push(n);
    (n.children || []).forEach((c) => findAll(c, name, out));
    return out;
  };
  let comp = null;
  for (let i = 0; i < 100; i++) {
    const canvas = findAll(scene, 'Canvas', [])[0];
    comp = ((canvas && canvas.components) || []).find(
      (c) => c && c.constructor && c.constructor.name === 'TugOfWar',
    );
    if (comp && comp.animL && comp.animR) break;
    await sleep(300);
  }
  if (!comp) return { err: 'TugOfWar not found' };
  if (!comp.animL || !comp.animR) return { err: 'anim not bound', scene: scene.name };

  const frameName = (name) => {
    const n = findAll(scene, name, [])[0];
    if (!n) return null;
    const sp = (n.components || []).find((c) => c.constructor && c.constructor.name === 'Sprite');
    const f = sp && sp.spriteFrame;
    return f ? f.name || f._uuid || '?' : null;
  };

  const snap = () => ({
    progL: +comp.progL.toFixed(4),
    progR: +comp.progR.toFixed(4),
    tL: comp.animL ? +comp.animL.time.toFixed(4) : null,
    tR: comp.animR ? +comp.animR.time.toFixed(4) : null,
    frameL: frameName('Left_Player'),
    frameR: frameName('Right_Player'),
  });

  // 复位到中间帧
  comp.leftPower = 29994;
  comp.rightPower = 26320;
  comp.progL = 0.5;
  comp.progR = 0.5;
  comp.animDirty = true;
  await sleep(300);

  const lenL = +comp.animL.length.toFixed(4);
  const lenR = +comp.animR.length.toFixed(4);
  const rest = snap();

  // 单次点击：往左 → 左角色前进一格、右角色后退一格
  comp.addPower(-1);
  await sleep(150);
  const tapLeft = snap();

  comp.addPower(1);
  await sleep(150);
  const tapRight = snap();

  // 一路点左 → 到末帧/首帧就停
  for (let i = 0; i < 40; i++) comp.addPower(-1);
  await sleep(200);
  const endLeft = snap();
  comp.addPower(-1); // 再多点一次，确认不绕回
  await sleep(150);
  const endLeft2 = snap();

  // 一路点右 → 反向到另一端
  for (let i = 0; i < 80; i++) comp.addPower(1);
  await sleep(200);
  const endRight = snap();

  return {
    lenL,
    lenR,
    framesPerTap: comp.framesPerTap,
    stepL: +comp.stepL.toFixed(4),
    stepR: +comp.stepR.toFixed(4),
    // 一次点击应该正好走 stepL / stepR 这么多进度 = framesPerTap 帧
    framesPerTapL: +(((tapLeft.progL - rest.progL) / comp.stepL) * comp.framesPerTap).toFixed(2),
    framesPerTapR: +(((rest.progR - tapLeft.progR) / comp.stepR) * comp.framesPerTap).toFixed(2),
    rest,
    tapLeft,
    tapRight,
    endLeft,
    endLeft2,
    endRight,
    // 判定
    check: {
      加左侧_左角色前进: tapLeft.progL > rest.progL,
      加左侧_右角色后退: tapLeft.progR < rest.progR,
      加右侧_方向相反: tapRight.progL < tapLeft.progL && tapRight.progR > tapLeft.progR,
      左端点夹住_末帧: endLeft.progL === 1 && endLeft.tL > lenL - 0.01,
      左端点夹住_首帧: endLeft.progR === 0 && endLeft.tR === 0,
      再多点不绕回: JSON.stringify(endLeft) === JSON.stringify(endLeft2),
      右端点夹住_首帧: endRight.progL === 0,
      右端点夹住_末帧: endRight.progR === 1,
      帧名真的变了: tapLeft.frameL !== rest.frameL || tapLeft.frameR !== rest.frameR,
    },
  };
})()
