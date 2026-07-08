const { test } = require("node:test");
const assert = require("node:assert");
const { buildSchedule } = require("../schedule.js");

test("60min session, 30min work, 5min break", () => {
  const s = buildSchedule(0, { sessionMin: 60, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [
    { phase: "working", endsAt: 30 * 60000 },
    { phase: "break", endsAt: 35 * 60000 },
    { phase: "working", endsAt: 65 * 60000 }
  ]);
});

test("no trailing break after the final work interval", () => {
  const s = buildSchedule(0, { sessionMin: 30, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [{ phase: "working", endsAt: 30 * 60000 }]);
});

test("last work interval shorter when session is not a clean multiple", () => {
  const s = buildSchedule(0, { sessionMin: 50, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [
    { phase: "working", endsAt: 30 * 60000 },
    { phase: "break", endsAt: 35 * 60000 },
    { phase: "working", endsAt: 55 * 60000 }
  ]);
});

test("non-zero start offsets all timestamps", () => {
  const s = buildSchedule(1000, { sessionMin: 30, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [{ phase: "working", endsAt: 1000 + 30 * 60000 }]);
});
