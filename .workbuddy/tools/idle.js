(async () => {
  await new Promise((r) => setTimeout(r, 6000));
  return { alive: true, t: Date.now() };
})()
