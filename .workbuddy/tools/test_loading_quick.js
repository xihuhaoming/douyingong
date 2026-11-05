(() => {
  const cc = window.cc;
  if (!cc || !cc.director) return { ready: false, reason: 'no cc' };
  const s = cc.director.getScene();
  if (!s) return { ready: false, reason: 'no scene' };
  const canvas = s.getChildByName ? s.getChildByName('Canvas') : null;
  const list = canvas ? (canvas.components || []) : [];
  const names = list.map((x) => (x && x.constructor && x.constructor.name) || '?');
  const ls = list.find((x) => x && x.constructor && x.constructor.name === 'LoadingScene');
  return {
    ready: true,
    scene: s.name,
    canvasComps: names,
    hasLoadingScene: !!ls,
    progress: ls && ls.bar ? +ls.bar.progress.toFixed(2) : null,
    elapsed: ls ? +ls.elapsed.toFixed(2) : null,
    launched: ls ? !!ls.launched : null,
    loadDone: ls ? !!ls.loadDone : null,
    loadFailed: ls ? !!ls.loadFailed : null,
    target: ls ? +ls.target.toFixed(2) : null,
    shown: ls ? +ls.shown.toFixed(2) : null,
    hasTugOfWar: names.includes('TugOfWar'),
  };
})()
