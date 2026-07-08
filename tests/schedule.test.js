const { test } = require("node:test");
const assert = require("node:assert");
const { buildSchedule } = require("../schedule.js");

test("60min session, break every 30min, 5min break — ends at exactly 60", () => {
  const s = buildSchedule(0, { sessionMin: 60, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [
    { phase: "working", endsAt: 25 * 60000 },
    { phase: "break", endsAt: 30 * 60000 },
    { phase: "working", endsAt: 60 * 60000 }
  ]);
});

test("session no longer than one interval is a single work block, no break", () => {
  const s = buildSchedule(0, { sessionMin: 30, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [{ phase: "working", endsAt: 30 * 60000 }]);
});

test("final remainder is all work when session is not a clean multiple", () => {
  const s = buildSchedule(0, { sessionMin: 50, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [
    { phase: "working", endsAt: 25 * 60000 },
    { phase: "break", endsAt: 30 * 60000 },
    { phase: "working", endsAt: 50 * 60000 }
  ]);
});

test("non-zero start offsets all timestamps", () => {
  const s = buildSchedule(1000, { sessionMin: 30, workMin: 30, breakMin: 5 });
  assert.deepStrictEqual(s, [{ phase: "working", endsAt: 1000 + 30 * 60000 }]);
});
