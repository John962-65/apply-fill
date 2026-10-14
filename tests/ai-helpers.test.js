const test = require("node:test");
const assert = require("node:assert/strict");

const ai = require("../ai-helpers.js");

const field = (key, value) => ({ key, value });

test('枚举只做用途内的等价转换，保留预备党员、考试类别与院校限定',()=>{
  const match=(label,value,options)=>ai.findSelectOptionIndex(options,value,{label});
  assert.equal(match('政治面貌','中共党员',['中国共产党预备党员','中国共产党党员']),1);
  assert.equal(match('政治面貌','中共预备党员',['中国共产党党员']),-1);
  assert.equal(match('英语等级','CET-4',['英语专业四级','大学英语四级']),1);
  assert.equal(match('英语等级','TEM4',['大学英语四级']),-1);
  assert.equal(match('院校层次','985',['211工程高校','985工程高校']),1);
  assert.equal(match('院校层次','985',['双一流建设高校']),-1);
  assert.equal(match('院校性质','公办',['民办院校','公办学校']),1);
  assert.equal(match('学历','本科',['全日制本科']),-1);
  assert.equal(match('学位','学士',['本科']),-1);
  assert.equal(ai.findResumeSource('大学英语四级',[{key:'英语等级',value:'CET4'}],{label:'英语等级'}).relation,'equivalent');
  assert.equal(ai.findResumeSource('中国共产党党员',[{key:'政治面貌',value:'中共党员'}],{label:'政治面貌'}).relation,'equivalent');
  assert.equal(ai.findResumeSource('中国共产党党员',[{key:'家庭成员政治面貌备注',value:'中共党员'}],{label:'政治面貌'}).relation,'none');
});

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

test("区间时间拆成开始/结束，奖项名补成可引用字段", () => {
  const fields = [
    { group: "教育背景", key: "硕士时间", value: "2024.9.1-2027.6.1", fieldId: "t1" },
    { group: "项目经历", recordId: "r0", recordName: "甲项目", key: "甲项目-开始时间", value: "2026-1-1", fieldId: "t3" },
    { group: "奖励", recordId: "r1", recordName: "研究生学业奖学金一等奖", key: "研究生学业奖学金一等奖-获奖时间", value: "2024-9-1", fieldId: "a1" },
    { group: "奖励", recordId: "r1", recordName: "研究生学业奖学金一等奖", key: "研究生学业奖学金一等奖-获奖时间 (2)", value: "2025-9-1", fieldId: "a2" }
  ];

  const expanded = ai.expandResumeFields(fields);
  const added = expanded.slice(fields.length);
  assert.deepEqual(added.map((item) => [item.key, item.value]), [
    ["硕士时间-开始时间", "2024-9"],
    ["硕士时间-结束时间", "2027-6"],
    ["研究生学业奖学金一等奖-获奖名称", "研究生学业奖学金一等奖"]
  ]);
  assert.equal(added[2].recordId, "r1", "合成的获奖名称要带记录 id，guard 的锚点才建得起来");
  assert.ok(added.every((item) => item.synthetic === true));
  assert.equal(ai.expandResumeFields([{ key: "姓名", value: "张三" }]).length, 1, "没有可合成的就原样返回");

  // 单日期、缺分隔符、解析不出的都不拆。
  assert.deepEqual(ai.splitDateRange("2026-1-1"), null);
  assert.deepEqual(ai.splitDateRange("2024.9.1-2027.6.1"), ["2024-9", "2027-6"]);
  assert.deepEqual(ai.splitDateRange("2024-2027"), null);
  assert.deepEqual(ai.splitDateRange("至今"), null);
});

test("描述由同一条经历的多段原文拼成时算可验证，夹一句编造或跨经历拼贴仍算无出处", () => {
  const resume = [
    { key: "甲项目-内容概述", value: "面向多机械臂共享空间协同操作及机械臂连续重复任务，研究几何路径多样化。", recordId: "r1", fieldId: "c1" },
    { key: "甲项目-主要工作", value: "设计基于优先顺序与端点预留的多策略并行规划框架，结合按需修复生成互补多臂路径。", recordId: "r1", fieldId: "c2" },
    { key: "乙项目-内容概述", value: "面向灵巧手接触崩塌与掉落问题，构建动作后果预测与风险预警闭环。", recordId: "r2", fieldId: "c3" }
  ];
  // 连接词单独成句（不足 8 字会被过滤）：逐句回查要求每一句都是某字段值的子句。
  // 也不能让目标以某字段值的前 24 字起头，否则先被 rewritten 接住，测不到逐句回查。
  const composed = "在该项目中。设计基于优先顺序与端点预留的多策略并行规划框架，结合按需修复生成互补多臂路径。面向多机械臂共享空间协同操作及机械臂连续重复任务，研究几何路径多样化。";

  const source = ai.findResumeSource(composed, resume);
  assert.equal(source.relation, "composed");
  assert.deepEqual(source.keys, ["甲项目-主要工作", "甲项目-内容概述"]);

  assert.equal(ai.findResumeSource(`${composed}并获得国际大奖。`, resume).relation, "none", "夹一句编造的不能算可验证");
  const cross = "在该项目中。设计基于优先顺序与端点预留的多策略并行规划框架，结合按需修复生成互补多臂路径。面向灵巧手接触崩塌与掉落问题，构建动作后果预测与风险预警闭环。";
  assert.equal(ai.findResumeSource(cross, resume).relation, "none", "跨经历拼贴不算可验证");
});


test("显式奖项名称优先，资料树占位记录名不能生成获奖事实", () => {
  const H = require('../ai-helpers.js');
  const fields = [{group:'获奖经历',key:'获奖 1-获奖名称',value:'示例奖项',recordId:'r',recordName:'获奖 1'},
    {group:'获奖经历',key:'获奖 1-获奖时间',value:'2024',recordId:'r',recordName:'获奖 1'}];
  assert.deepEqual(H.expandResumeFields(fields),fields);
  assert.deepEqual(H.expandResumeFields(fields.slice(1)),fields.slice(1));
});
