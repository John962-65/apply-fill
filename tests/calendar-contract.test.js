const test = require("node:test");
const assert = require("node:assert/strict");

require("../control-catalog.js");
const calendar = require("../calendar-agent.js");
const validateContract = calendar.validateContract;

const fullContract = {
  name: "测试合成契约",
  yearGrid: () => [], yearCells: () => [],
  monthGrid: () => [], monthCells: () => [],
  dayGrid: () => [], dayCells: () => [],
  yearButton: () => [], monthButton: () => [],
  prevDecade: () => [], nextDecade: () => [],
  header: () => [], confirmButton: () => []
};

test("完整动态契约通过校验", () => {
  assert.equal(validateContract(fullContract), fullContract);
});

test("缺网格或格子字段的契约无效", () => {
  assert.equal(validateContract(null), null);
  assert.equal(validateContract({}), null);
  const noCells = { ...fullContract }; delete noCells.dayCells;
  assert.equal(validateContract(noCells), null);
  const noGrid = { ...fullContract }; delete noGrid.yearGrid;
  assert.equal(validateContract(noGrid), null);
});

test("月/日网格缺导航链无效", () => {
  const noYearButton = { ...fullContract, yearButton: undefined };
  assert.equal(validateContract(noYearButton), null);
  const noMonthButton = { ...fullContract, monthButton: undefined };
  assert.equal(validateContract(noMonthButton), null);
  const monthWithoutYearGrid = { ...fullContract }; delete monthWithoutYearGrid.yearGrid;
  assert.equal(validateContract(monthWithoutYearGrid), null);
});

test("年网格缺十年翻页按钮无效", () => {
  const noPaging = { ...fullContract, prevDecade: undefined };
  assert.equal(validateContract(noPaging), null);
});

test("仅年份网格的最小契约有效", () => {
  const yearOnly = { yearGrid: ".y", yearCells: ".c", prevDecade: ".p", nextDecade: ".n" };
  assert.equal(validateContract(yearOnly), yearOnly);
});

test("fill 收到无效契约返回 null（转入 AI 接管），不触页面", async () => {
  const agent = calendar.create({ visible: () => true, click: async () => true });
  const result = await agent.fill({ entry: {}, value: "2024-09", panel: () => null, trace: () => {}, contract: {} });
  assert.equal(result, null);
});

test("fill 收到有效契约但面板未绑定，报告失败原因", async () => {
  const agent = calendar.create({ visible: () => true, click: async () => true });
  const entry = {};
  const result = await agent.fill({ entry, value: "2024-09", panel: () => null, trace: () => {}, contract: fullContract });
  assert.equal(result.ok, false);
  assert.ok(entry.fillNote);
});

test("未提供契约时保持原行为：面板为空返回 null", async () => {
  const agent = calendar.create({ visible: () => true, click: async () => true });
  const result = await agent.fill({ entry: {}, value: "2024-09", panel: () => null, trace: () => {} });
  assert.equal(result, null);
});
