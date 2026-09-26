const test = require("node:test");
const assert = require("node:assert/strict");

const profile = require("../profile-fields.js");
const ai = require("../ai-helpers.js");

const TEMPLATE_FIELDS = [
  { group: "基本信息", key: "姓名", value: "张三" },
  { group: "基本信息", key: "学历", value: "硕士" },
  { group: "基本信息", key: "邮箱", value: "me@example.com" },
  { group: "教育背景", key: "学校", value: "XX大学" }
];
const TEMPLATE_GROUPS = ["基本信息", "教育背景"];

// content.js 在页面侧传的正是这一对，测试用同一份表，避免两边规则走偏。
function collect(pageFields, options = {}) {
  return profile.pickWritebackEntries(pageFields, {
    knownKeys: options.knownKeys ?? profile.knownFieldKeys(options.profile ?? { values: {}, family: [], custom: [] }, options.resumeFields ?? TEMPLATE_FIELDS),
    templateFields: options.resumeFields ?? TEMPLATE_FIELDS,
    templateGroups: options.templateGroups ?? TEMPLATE_GROUPS,
    entityGroupLabels: ai.ENTITY_LABEL_BY_GROUP,
    isSemanticMatch: (semantic, resumeField, pageField) => ai.isResumeFieldMatch(semantic, resumeField, pageField),
    findSource: options.findSource ?? ((value, fields) => ai.findResumeSource(value, fields))
  });
}

test("站点别名不进模板：值在简历里已有出处的只记 alias", () => {
  const resume = [
    { group: "教育背景", key: "学校", value: "XX大学" },
    { group: "语言能力", key: "英语六级", value: "" }
  ];
  const result = collect([
    { label: "毕业学校", group: "教育经历", value: "XX大学", recordIndex: 1, recordTotal: 2 },
    { label: "六级分数", group: "语言能力", value: "520", recordIndex: 1, recordTotal: 2 }
  ], { resumeFields: resume, templateGroups: ["教育背景", "语言能力"] });

  assert.deepEqual(result.entries.map((entry) => `${entry.key}=${entry.value}`), ["六级分数=520"]);
  const alias = result.skipped.find((item) => item.reason === "alias");
  assert.equal(alias?.key, "毕业学校");
  assert.equal(alias.templateKey, "学校");
});

test("只把模板里没有的字段当新增，已有名字的一律不动", () => {
  const result = collect([
    { label: "姓名", group: "基本信息", value: "李四", inputType: "text", order: 0 },
    { label: "英语六级分数", group: "语言能力", value: "520", inputType: "text", order: 1 }
  ]);

  assert.deepEqual(result.entries.map((entry) => entry.key), ["英语六级分数"]);
  assert.equal(result.entries[0].value, "520");
  assert.deepEqual(result.skipped.map((item) => [item.key, item.reason]), [["姓名", "known"]]);
  // 网页上填错的值不能把模板带错。
  assert.equal(result.skipped[0].templateValue, "张三");
});

test("字段名已经有了但还没有值：报告成 known-empty，不另起一行", () => {
  // 「最高学历」是「我的信息」的预置字段名，档案里没填值时也应该只提示。
  const result = collect([
    { label: "最高学历", group: "基本信息", value: "博士研究生", inputType: "select", order: 0 }
  ]);

  assert.equal(result.entries.length, 0);
  assert.equal(result.skipped[0].reason, "known-empty");
});

test("语义等价的字段不重复加行", () => {
  const result = collect(
    [{ label: "主申请人名字", group: "个人信息", value: "李四", inputType: "text", semantic: "name", order: 0 }],
    { knownKeys: new Set(), resumeFields: [{ group: "基本信息", key: "本人姓名", value: "张三" }] }
  );

  assert.equal(result.entries.length, 0);
  assert.equal(result.skipped[0].reason, "semantic-known");
  assert.equal(result.skipped[0].templateKey, "本人姓名");
});

test("密码验证码不写回模板，密码框连报告都不出", () => {
  const result = collect([
    { label: "网站密码", group: "账号", value: "abc123", inputType: "text", order: 0 },
    { label: "备注", group: "账号", value: "token: deadbeef", inputType: "text", order: 1 },
    { label: "登录口令", group: "账号", value: "x", inputType: "password", order: 2 }
  ]);

  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["secret", "secret"]);
});

test("空值、过长的字段名不算可采集内容", () => {
  const longLabel = "请在下方一栏如实填写您在校期间获得的全部奖励荣誉与学术成果明细说明";
  assert.ok(longLabel.length > 30, "这条测试要打的确实是超长字段名那道门槛");

  const result = collect([
    { label: "身高", group: "基本信息", value: "   ", inputType: "text", order: 0 },
    { label: longLabel, group: "其他", value: "X", order: 1 }
  ]);

  assert.deepEqual({ entries: result.entries, skipped: result.skipped }, { entries: [], skipped: [] });
});

test("多段经历里同组同名分不出第几段，整组跳过", () => {
  const result = collect([
    { label: "学校名称", group: "实习经历", value: "A公司", inputType: "text", order: 0 },
    { label: "学校名称", group: "实习经历", value: "B公司", inputType: "text", order: 1 }
  ]);

  assert.equal(result.entries.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["duplicate-in-group", "duplicate-in-group"]);
});

test("分得出第几段时按段号收下，采过的不再重复加", () => {
  const pageFields = [
    { label: "项目名称", group: "项目经历", value: "机械臂规划", inputType: "text", recordIndex: 1, order: 0 },
    { label: "项目名称", group: "项目经历", value: "评审工作台", inputType: "text", recordIndex: 2, order: 1 },
    { label: "描述", group: "项目经历", value: "面向多机械臂", inputType: "textarea", recordIndex: 1, order: 2 },
    { label: "描述", group: "项目经历", value: "将研究假设", inputType: "textarea", recordIndex: 2, order: 3 }
  ];
  const first = collect(pageFields);
  assert.deepEqual(first.entries.map((entry) => `${entry.group}/${entry.key}=${entry.value}`), [
    "项目经历/项目名称1=机械臂规划",
    "项目经历/项目名称2=评审工作台",
    "项目经历/描述1=面向多机械臂",
    "项目经历/描述2=将研究假设"
  ]);

  // 把这一批写进模板之后再采集一次，不该重复加行。
  const stored = first.entries.map((entry) => ({ group: entry.group, key: entry.key, value: entry.value }));
  const again = collect(pageFields, {
    knownKeys: profile.knownFieldKeys({ values: {}, family: [], custom: [] }, stored),
    resumeFields: stored
  });

  assert.equal(again.entries.length, 0);
  assert.deepEqual([...new Set(again.skipped.map((item) => item.reason))], ["known"]);
});

test("不同分组里的同名字段各自新增", () => {
  const result = collect([
    { label: "开始时间", group: "教育", value: "2019-09", inputType: "text", order: 0 },
    { label: "开始时间", group: "实习", value: "2023-07", inputType: "text", order: 1 }
  ]);

  assert.deepEqual(result.entries.map((entry) => `${entry.group}/${entry.key}`), ["教育背景/开始时间", "实习/开始时间"]);
});

test("分组归属优先落到模板里已有的分组名", () => {
  assert.equal(
    profile.resolveWritebackGroup("教育经历", TEMPLATE_GROUPS, ai.ENTITY_LABEL_BY_GROUP),
    "教育背景",
    "网页写「教育经历」、模板写「教育背景」，不该新开一个同义分组"
  );
  assert.equal(
    profile.resolveWritebackGroup("语言与技能", TEMPLATE_GROUPS, ai.ENTITY_LABEL_BY_GROUP),
    "语言与技能",
    "模板里没有的分组沿用网页标题"
  );
  assert.equal(
    profile.resolveWritebackGroup("请填写您的个人基本信息与联系方式", TEMPLATE_GROUPS, ai.ENTITY_LABEL_BY_GROUP),
    "基本信息",
    "网页标题太长不配当一级分类"
  );
  assert.equal(profile.resolveWritebackGroup("", TEMPLATE_GROUPS, ai.ENTITY_LABEL_BY_GROUP), "基本信息");
});

test("一次最多采集 30 项，超出的分批处理", () => {
  const pageFields = Array.from({ length: 34 }, (_, index) => ({
    label: `自定义字段${index}`,
    group: "其他",
    value: `值${index}`,
    inputType: "text",
    order: index
  }));

  const result = collect(pageFields);
  assert.equal(result.entries.length, profile.MAX_WRITEBACK_ENTRIES);
  assert.equal(result.truncated, true);
});

test("写入只追加，同组已有同名（含空格差异）时跳过，且不动任何已有值", () => {
  const template = {
    id: "t1",
    name: "研发岗",
    groups: [
      { name: "基本信息", fields: [{ key: "姓名", value: "张三" }, { key: "邮 箱", value: "me@example.com" }] },
      { name: "教育背景", fields: [] }
    ]
  };

  const added = profile.addFieldsToTemplate(template, [
    { group: "基本信息", key: "姓名", value: "李四" },
    { group: "基本信息", key: "邮箱", value: "new@example.com" },
    { group: "基本信息", key: "血型", value: "O" },
    { group: "项目经历", key: "项目名称", value: "机械臂抓取" },
    { group: "", key: "无分组字段", value: "V" },
    { group: "项目经历", key: "", value: "忽略" }
  ]);

  assert.deepEqual(added.map((item) => `${item.group}/${item.key}`), ["基本信息/血型", "项目经历/项目名称", "基本信息/无分组字段"]);
  assert.deepEqual(
    template.groups.map((group) => [group.name, group.fields.map((field) => `${field.key}=${field.value}`)]),
    [
      ["基本信息", ["姓名=张三", "邮 箱=me@example.com", "血型=O", "无分组字段=V"]],
      ["教育背景", []],
      ["项目经历", ["项目名称=机械臂抓取"]]
    ],
    "已有字段原样保留，空分组不删，新分组排在最后"
  );
});

test("写入的是普通 {一级分类,字段名,值} 结构，导出的 Excel 能原样再导回来", () => {
  const template = { id: "t1", name: "T", groups: [] };
  profile.addFieldsToTemplate(template, [{ group: "实习经历", key: "公司", value: "XX公司" }]);

  const [group] = template.groups;
  const [field] = group.fields;
  assert.deepEqual(Object.keys(group).sort(), ["fields", "name"]);
  assert.deepEqual(Object.keys(field).sort(), ["key", "value"]);
});
