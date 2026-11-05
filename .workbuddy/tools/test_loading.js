(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 等引擎引导起来
  for (let i = 0; i < 120 && !window.cc; i++) await sleep(100);
  const cc = window.cc;
  if (!cc) return { err: 'cc not ready' };

  const t0 = performance.now();
  const log = [];
  let sawLoading = false;
  let loadingComp = false;
  let firstProg = null;
  let lastProg = null;

  const getComp = (scene, cls) => {
    const canvas = scene.getChildByName('Canvas');
    if (!canvas) return null;
    const list = canvas.components || [];
    return list.find((x) => x && x.constructor && x.constructor.name === cls) || null;
  };

  for (let i = 0; i < 120; i++) {
    const s = cc.director.getScene();
    const name = s ? s.name : null;
    let prog = null;
    let hasComp = false;
    if (s && name === 'loading') {
      sawLoading = true;
      const c = getComp(s, 'LoadingScene');
      if (c) {
        hasComp = true;
        loadingComp = true;
        prog = c.bar ? +c.bar.progress.toFixed(2) : null;
        if (firstProg === null) firstProg = prog;
        lastProg = prog;
      }
    }
    log.push({ ms: Math.round(performance.now() - t0), scene: name, prog, hasComp });
    if (name === 'game') break;
    await sleep(100);
  }

  await sleep(600);
  const fin = cc.director.getScene();
  const tug = fin ? getComp(fin, 'TugOfWar') : null;

  // 采样做压缩：连续相同的 scene/prog 只留一条
  const slim = [];
  for (const r of log) {
    const prev = slim[slim.length - 1];
    if (!prev || prev.scene !== r.scene || prev.prog !== r.prog) slim.push(r);
  }

  return {
    sawLoading,
    loadingComp,
    firstProg,
    lastProg,
    finalScene: fin ? fin.name : null,
    hasTugOfWar: !!tug,
    timeline: slim.slice(0, 40),
  };
})()
