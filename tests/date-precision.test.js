const test = require("node:test");
const assert = require("node:assert/strict");

const precision = require("../date-precision.js");

const input = (overrides = {}) => ({
  type: "text",
  value: "",
  getAttribute: name => ({ placeholder: "请选择日期", pattern: "", ...overrides })[name] ?? null,
  ...overrides
});

test("页面显示值形态只认完整格式", () => {
  assert.equal(precision.precisionOfValue("2024-09-01"), "day");
  assert.equal(precision.precisionOfValue("2024年9月1日"), "day");
  assert.equal(precision.precisionOfValue("2024-09"), "month");
  assert.equal(precision.precisionOfValue("2024年09"), "month");
  assert.equal(precision.precisionOfValue("2024"), "year");
  assert.equal(precision.precisionOfValue("2024年"), "year");
  assert.equal(precision.precisionOfValue("2024-9-1"), "day");
  assert.equal(precision.precisionOfValue("2024-09-01 12:30"), null);
  assert.equal(precision.precisionOfValue("September 2024"), null);
  assert.equal(precision.precisionOfValue(""), null);
});

test("静态证据：控件类型与占位符写法", () => {
  assert.equal(precision.staticEvidence(input({ type: "date" })).precision, "day");
  assert.equal(precision.staticEvidence(input({ type: "month" })).precision, "month");
  assert.equal(precision.staticEvidence(input({ placeholder: "YYYY-MM-DD" })).precision, "day");
  assert.equal(precision.staticEvidence(input({ placeholder: "YYYY-MM" })).precision, "month");
  assert.equal(precision.staticEvidence(input({ placeholder: "YYYY年MM月" })).precision, "month");
  assert.equal(precision.staticEvidence(input({ placeholder: "YYYY" })).precision, "year");
  assert.equal(precision.staticEvidence(input({ placeholder: "请选择日期" })), null);
});

test("结构证据：网格集合决定精度", () => {
  assert.equal(precision.structuralEvidence({ grids: ["year", "month", "day"] }).precision, "day");
  assert.equal(precision.structuralEvidence({ grids: ["year", "month"] }).precision, "month");
  assert.equal(precision.structuralEvidence({ grids: ["year"] }).precision, "year");
  assert.equal(precision.structuralEvidence({ grids: [] }), null);
});

test("资料值形态绝不参与推断：resolve 不接受 value 参数", () => {
  const resolved = precision.resolve({ element: input({ placeholder: "请选择日期" }), calendar: { grids: [] } });
  assert.equal(resolved.precision, null);
  assert.equal(resolved.confidence, "insufficient");
});

test("当前值形态是弱证据，单独不足", () => {
  const resolved = precision.resolve({ element: input({ placeholder: "请选择日期", value: "2024-09-01" }) });
  assert.equal(resolved.precision, null);
  assert.equal(resolved.evidence.some(item => item.source === "当前值形态" && item.precision === "day"), true);
});

test("强证据一致→高置信；强证据冲突→unresolved(conflict)", () => {
  const agree = precision.resolve({ element: input({ type: "month" }), calendar: { grids: ["year", "month"] } });
  assert.equal(agree.precision, "month");
  assert.equal(agree.confidence, "high");
  const conflict = precision.resolve({ element: input({ type: "month" }), calendar: { grids: ["year", "month", "day"] } });
  assert.equal(conflict.precision, null);
  assert.equal(conflict.confidence, "conflict");
  const structureOnly = precision.resolve({ element: input(), calendar: { grids: ["year", "month", "day"] } });
  assert.equal(structureOnly.precision, "day");
  assert.equal(structureOnly.confidence, "high");
});
