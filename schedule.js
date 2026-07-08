// Pure schedule computation. Global function (loaded via importScripts in the
// service worker); the module.exports guard exists only for Node tests.
// workMin is the cycle length INCLUDING the break: "break every 30 min"
// means 25 min work + 5 min break per cycle. The session lasts exactly
// sessionMin wall-clock minutes; the final segment is all work (no
// trailing break — the session ending unblocks everything anyway).
function buildSchedule(startMs, { sessionMin, workMin, breakMin }) {
  const phases = [];
  let t = startMs;
  let left = sessionMin;
  while (left > workMin) {
    t += (workMin - breakMin) * 60000;
    phases.push({ phase: "working", endsAt: t });
    t += breakMin * 60000;
    phases.push({ phase: "break", endsAt: t });
    left -= workMin;
  }
  t += left * 60000;
  phases.push({ phase: "working", endsAt: t });
  return phases;
}

if (typeof module !== "undefined") module.exports = { buildSchedule };
