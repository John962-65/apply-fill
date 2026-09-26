const test = require("node:test");
const assert = require("node:assert/strict");

const ai = require("../ai-helpers.js");

const field = (key, value) => ({ key, value });

test("电话只认来源字段自己写着手机/电话的那条，账号类号码不再顶替", () => {
  assert.equal(ai.isResumeFieldMatch("phone", field("QQ", "987654321"), {}), false);
  assert.equal(ai.isResumeFieldMatch("phone", field("微信号", "wxid_123456"), {}), false);
  assert.equal(ai.isResumeFieldMatch("phone", field("学号", "20230101"), {}), false);
  assert.equal(ai.isResumeFieldMatch("phone", field("手机号码", "13800000000"), {}), true);
  assert.equal(ai.isResumeFieldMatch("phone", field("联系电话", "13800000000"), {}), true);
  assert.equal(ai.isResumeFieldMatch("phone", field("联系方式", "13800000000"), {}), true);
});

test("身份证只认证件字段或标准 18 位形状", () => {
  assert.equal(ai.isResumeFieldMatch("id_number", field("学号", "20230101"), {}), false);
  assert.equal(ai.isResumeFieldMatch("id_number", field("QQ", "987654321"), {}), false);
  assert.equal(ai.isResumeFieldMatch("id_number", field("身份证号码", "11010120000101001X"), {}), true);
  assert.equal(ai.isResumeFieldMatch("id_number", field("证件号码", "11010120000101001X"), {}), true);
});

test("分组名混着账号字样时按更严的一方判", () => {
  assert.equal(ai.isResumeFieldMatch("phone", { group: "联系方式", key: "QQ", value: "987654321" }, {}), false);
  assert.equal(ai.isResumeFieldMatch("phone", { group: "联系方式", key: "手机", value: "13800000000" }, {}), true);
});

test("本地规则不再把 QQ 当成本人电话", () => {
  const formFields = [{ fieldId: "field-0", label: "联系电话", inputType: "text", options: [] }];
  const resumeFields = [
    { group: "个人信息", key: "姓名", value: "张三" },
    { group: "个人信息", key: "QQ", value: "987654321" },
    { group: "联系方式", key: "手机号码", value: "13800000000" }
  ];

  const matches = ai.buildRuleBasedMatches(formFields, resumeFields);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].value, "13800000000");
  assert.equal(matches[0].resumeKey, "手机号码");
  assert.equal(matches[0].source, "local");
});

test("值原样出现在简历里算 exact，多条同值要标出来", () => {
  const resume = [field("学校", "XX大学"), field("学校", "XX大学")];
  const found = ai.findResumeSource("XX大学", resume);

  assert.equal(found.relation, "exact");
  assert.equal(found.ambiguous, true);
  assert.deepEqual(found.keys, ["学校", "学校"]);
});

test("只差写法的日子算 date，不算编造", () => {
  const resume = [field("毕业时间", "2027-06"), field("出生日期", "2000年1月1日")];

  assert.equal(ai.findResumeSource("2027-06-01", resume).relation, "date");
  assert.equal(ai.findResumeSource("2000-01-01", resume).relation, "date");
  assert.equal(ai.findResumeSource("2027-06-01", resume).field.key, "毕业时间");
  // 年份或月份不同就不是同一个日子，不能放过去。
  assert.equal(ai.findResumeSource("2027-07-01", resume).relation, "none");
});

test("从一句简历里截出来的值算 partial", () => {
  const resume = [field("成绩", "排名前20%(绩点3.15)")];
  const found = ai.findResumeSource("3.15", resume);

  assert.equal(found.relation, "partial");
  assert.equal(found.field.key, "成绩");
});

test("单字符不做截取匹配，简历里完全没有的才算无出处", () => {
  const resume = [field("性别", "男"), field("爱好", "篮球、健身")];

  assert.equal(ai.findResumeSource("男", resume).relation, "exact");
  assert.equal(ai.findResumeSource("球", resume).relation, "none");
  assert.equal(ai.findResumeSource("健身", resume).relation, "partial");
  assert.equal(ai.findResumeSource("中共党员", resume).relation, "none");
  assert.equal(ai.findResumeSource("", resume).relation, "none");
});

test("长文本被改写过算改写，只重合几个字的仍算无出处", () => {
  const resume = [field("内容概述", "面向多机械臂共享空间协同操作及机械臂连续重复任务，研究几何路径多样化与历史经验复用机制")];

  assert.equal(
    ai.findResumeSource("面向多机械臂共享空间协同操作及机械臂连续重复任务，研究路径多样化", resume).relation,
    "rewritten",
    "开头一大段对得上、后面被改写的，不该算编造"
  );
  assert.equal(ai.findResumeSource("基于某种方法", resume).relation, "none", "只重合几个字不能认成一回事");
});

test("按页面精度归一日历值：缺日补 1 号并标记，要月就截日", () => {
  assert.deepEqual(ai.normalizeDateForPrecision("2024-09", "day"), {
    value: "2024-09-01", precision: "day", padded: true
  });
  assert.deepEqual(ai.normalizeDateForPrecision("2000年1月1日", "day"), {
    value: "2000-01-01", precision: "day", padded: false
  });
  assert.deepEqual(ai.normalizeDateForPrecision("2027-06-30", "month"), {
    value: "2027-06", precision: "month", padded: false
  });
  assert.deepEqual(ai.normalizeDateForPrecision("2024", "day"), {
    value: "2024", precision: "auto", padded: false
  }, "只写了年份的解析不出年月，原样写");
  assert.deepEqual(ai.normalizeDateForPrecision("2024-09-01", "auto"), {
    value: "2024-09-01", precision: "auto", padded: false
  });
  assert.deepEqual(ai.normalizeDateForPrecision("至今", "day"), {
    value: "至今", precision: "auto", padded: false
  }, "解析不出来的原样写，不能把「至今」改成日期");
});

test("本地规则不把姓名填进「项目名称」——id 里带 name 不算人名字段", () => {
  const resumeFields = [{ group: "基本信息", key: "姓名", value: "张三" }];
  const thingNames = [
    { fieldId: "f0", label: "项目名称", idAttr: "project-name", inputType: "text", options: [] },
    { fieldId: "f1", label: "公司名称", name: "companyName", inputType: "text", options: [] },
    { fieldId: "f2", label: "获奖名称", inputType: "text", options: [] }
  ];

  // 真发生过：id 里的 name 命中了宽松关键词，姓名被填进三个项目名称，还被学成平台映射。
  assert.deepEqual(ai.buildRuleBasedMatches(thingNames, resumeFields), [], "东西的名字不是人名，本地规则不该动手");

  const matched = ai.buildRuleBasedMatches(
    [{ fieldId: "f3", label: "姓名", inputType: "text", options: [] }],
    resumeFields
  );
  assert.equal(matched.length, 1, "真·姓名字段照常走本地规则");
  assert.equal(matched[0].value, "张三");
});
