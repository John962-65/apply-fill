const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const ctx = { setTimeout, clearTimeout };
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve("../capture-autoclick.js"), "utf8"), ctx);
const autoclick = ctx.ResumeProCaptureAutoclick;

test("危险动作文案认得出提交/跳转/删除这一类", () => {
  for (const text of ["提交", "保存草稿", "下一步", "投递申请", "确认提交", "删除本条", "清空", "重置", "取消", "退出登录", "Submit", "SAVE", "Next", "Delete", "Apply Now"]) {
    assert.equal(autoclick.dangerousText(text), true, text);
  }
});

test("词表是前缀匹配，所以只允许拿去判可执行动作，不能拿去判字段名", () => {
  // 「提交日期」是正经字段名，但前缀命中「提交」。denyReason 只对 button/a/[role=button]
  // 调用 dangerousText，字段名与 placeholder 走的是另一条路，不受这个词表影响。
  assert.equal(autoclick.dangerousText("提交日期"), true);
  assert.equal(autoclick.dangerousText("学历"), false);
  assert.equal(autoclick.dangerousText("请选择"), false);
  assert.equal(autoclick.dangerousText("2020-10"), false);
  assert.equal(autoclick.dangerousText(""), false);
});

test("数量与时间预算和 recorder 的快照配额对得上", () => {
  assert.equal(typeof autoclick.create, "function");
  assert.equal(typeof autoclick.denyReason, "function");
  // 每个控件三张快照（点击前、350ms、1300ms），24 是 recorder 的硬上限，得留出「导出前」那一格。
  assert.equal(autoclick.MAX_TARGETS * 3, 21);
  assert.ok(autoclick.MAX_TARGETS * 3 < 24);
  // 循环预算要先于会话死线到点，剩下的目标才记得到 budget 而不是 session-ended。
  assert.ok(autoclick.BUDGET_MS < autoclick.SESSION_MS);
});
