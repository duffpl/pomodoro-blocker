// Pure schedule computation. Global function (loaded via importScripts in the
// service worker); the module.exports guard exists only for Node tests.
function buildSchedule(startMs, { sessionMin, workMin, breakMin }) {
  const phases = [];
  let t = startMs;
  let workLeft = sessionMin;
  while (workLeft > 0) {
    const work = Math.min(workMin, workLeft);
    t += work * 60000;
    phases.push({ phase: "working", endsAt: t });
    workLeft -= work;
    if (workLeft > 0) {
      t += breakMin * 60000;
      phases.push({ phase: "break", endsAt: t });
    }
  }
  return phases;
}

if (typeof module !== "undefined") module.exports = { buildSchedule };
