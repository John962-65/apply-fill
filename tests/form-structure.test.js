const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("../form-structure.js");

const field = (label, extra = {}) => ({ label, control: "input:text", drive: "native-setter", options: [], ...extra });

const resumeField = (key, value) => ({ group: "教育", key, value });
const findSource = (value, resumeFields) => {
  const exact = resumeFields.filter((item) => item.value === value);
  if (exact.length) return { relation: "exact", field: exact[0], keys: exact.map((item) => item.key) };
  return { relation: "none", field: null, keys: [] };
};

test("采集时按值回查简历生成映射，截取和改写不算对应关系", () => {
  const resume = [resumeField("学校", "XX大学"), resumeField("成绩", "排名前20%(绩点3.15)")];
  const page = [
    { label: "学校", value: "XX大学", recordIndex: 1, recordTotal: 2, recordSignature: "学校|专业" },
    { label: "绩点", value: "3.15", recordIndex: 1, recordTotal: 2, recordSignature: "学校|专业" },
    { label: "空字段", value: "" }
  ];

  const entries = fs.buildMappingEntries(page, resume, findSource);

  assert.equal(entries.length, 1, "截取出来的值不该被当成对应关系");
  assert.equal(entries[0].resumeKey, "学校");
  assert.equal(entries[0].recordIndex, 1);
  assert.equal(entries[0].groupSignature, "学校|专业");
});

test("重复采集累加命中，换成另一条简历字段就从 1 重算", () => {
  const snapshot = { platform: "hotjob", fields: [] };
  const entry = { label: "学校", recordIndex: 1, groupSignature: "学校", resumeKey: "学校" };

  let applied = fs.applyMappingEntries(snapshot, [entry]);
  assert.equal(applied.snapshot.fields[0].hits, 1);

  applied = fs.applyMappingEntries(applied.snapshot, [entry]);
  assert.equal(applied.snapshot.fields.length, 1, "同一个位置只该有一条映射");
  assert.equal(applied.snapshot.fields[0].hits, 2);

  applied = fs.applyMappingEntries(applied.snapshot, [{ ...entry, resumeKey: "毕业院校" }]);
  assert.equal(applied.snapshot.fields[0].resumeKey, "毕业院校");
  assert.equal(applied.snapshot.fields[0].hits, 1, "换了目标就重新起算");
});

test("按标签和段号查映射，段号不同或段签名对不上都不返回", () => {
  const snapshot = { platform: "hotjob", fields: [
    { label: "学校", recordIndex: 1, groupSignature: "学校|专业", resumeKey: "学校" }
  ] };

  assert.equal(fs.lookupMapping(snapshot, { label: "学校", recordIndex: 1, groupSignature: "学校|专业" })?.resumeKey, "学校");
  assert.equal(fs.lookupMapping(snapshot, { label: "学校", recordIndex: 2, groupSignature: "学校|专业" }), null, "第二段不该套用第一段的映射");
  assert.equal(fs.lookupMapping(snapshot, { label: "专业", recordIndex: 1 }), null);
  assert.equal(
    fs.lookupMapping(snapshot, { label: "学校", recordIndex: 1, groupSignature: "学校|专业|方向" }), null,
    "这家公司在这一段里加了自定义字段，段签名对不上就该回落 AI"
  );
});

test("读回失败累计满三次把这条映射删掉", () => {
  const snapshot = { platform: "hotjob", fields: [{ label: "学校", recordIndex: 1, resumeKey: "学校", hits: 4, misses: 0 }] };
  const key = fs.fieldIdentity({ label: "学校", recordIndex: 1 });

  assert.equal(fs.recordMappingOutcome(snapshot, key, true).dropped, false);
  assert.equal(snapshot.fields[0].hits, 5);
  assert.equal(snapshot.fields[0].misses, 0);

  assert.equal(fs.recordMappingOutcome(snapshot, key, false).dropped, false);
  assert.equal(fs.recordMappingOutcome(snapshot, key, false).dropped, false);
  const third = fs.recordMappingOutcome(snapshot, key, false);

  assert.equal(third.dropped, true);
  assert.equal(snapshot.fields.length, 0, "连续落空三次就不该再留着它");
});

test("跨次合并时映射和命中数都要保留", () => {
  const base = [field("学校"), field("专业"), field("学历"), field("起止时间")];
  const first = { platform: "moka", seenAt: "2026-09-21", origins: ["https://a.example"], fields: base };
  const withMapping = fs.applyMappingEntries(first, [{ label: "学校", resumeKey: "学校", hits: 3 }]).snapshot;
  withMapping.fields[0].hits = 3;

  const second = { platform: "moka", seenAt: "2026-09-22", origins: ["https://b.example"], fields: base };
  const merged = fs.mergeSnapshot([withMapping], second).list[0];
  const school = merged.fields.find((item) => item.label === "学校");

  assert.equal(school.resumeKey, "学校", "第二次采集不该把上次建好的映射冲掉");
  assert.ok(school.hits >= 3);
});

test("标签归一化挡掉必填星号、括号说明和「请选择」", () => {
  assert.equal(fs.normalizeLabel("姓名 *"), "姓名");
  assert.equal(fs.normalizeLabel("最高学历（请填写毕业时的层次）"), "最高学历");
  assert.equal(fs.normalizeLabel("请输入手机号"), "手机号");
  assert.equal(fs.normalizeLabel("  专　业  "), "专业");
  assert.equal(fs.normalizeLabel("生源地*?"), "生源地", "真实标签里带问号，不去掉会让同一字段归一成两个键");
});

test("hotjob.cn 不当成北森，按实际看到的域名单独成平台", () => {
  assert.equal(fs.detectPlatform(["wecruit.hotjob.cn"]), "hotjob");
  assert.equal(fs.detectPlatform(["hairobotics.zhiye.com"]), "beisen");
});

test("平台从脚本来源和容器类名判定，认不出就是 unknown", () => {
  assert.equal(fs.detectPlatform(["https://cdn.moka.com/app.js"]), "moka");
  assert.equal(fs.detectPlatform(["DIV italent-portal hotjob-list"]), "beisen");
  assert.equal(fs.detectPlatform(["https://company.example/successfactors/preview"]), "successfactors");
  assert.equal(fs.detectPlatform(["DIV app", "https://cdn.example/vendor.js"]), "unknown");
  assert.equal(fs.detectPlatform(["e10s8ombcbw.jobs.feishu.cn", "BODY arco-btn"]), "feishu", "托管在自有域名上的平台，主机名本身就是强特征");
});

test("结构相似度按字段标签集合算，多出自定义字段仍算同一模板", () => {
  const base = { fields: [field("姓名"), field("邮箱"), field("学校"), field("专业"), field("学历")] };
  const same = { fields: [field("姓名 *"), field("邮箱"), field("学校"), field("专业"), field("学历")] };
  const custom = { fields: [...base.fields, field("籍贯"), field("政治面貌"), field("生源地")] };
  const other = { fields: [field("公司名称"), field("岗位"), field("到岗时间"), field("期望薪资")] };
  const tiny = { fields: [field("姓名"), field("邮箱")] };

  assert.equal(fs.similarity(base, same), 1, "只有星号之差应当完全一致");
  assert.equal(fs.similarity(base, custom), 1, "别家多三个字段不该把它认成另一个平台");
  assert.equal(fs.similarity(base, other), 0);
  assert.equal(fs.similarity(base, tiny), 0, "字段太少不足以判定同一模板");
});

test("同平台按相似度合并成一条，不同平台各存一条", () => {
  const shared = [field("姓名"), field("邮箱"), field("学校"), field("专业")];
  const first = { platform: "moka", seenAt: "2026-09-01", origins: ["https://a.example"], fields: shared };
  const second = { platform: "moka", seenAt: "2026-09-20", origins: ["https://b.example"], fields: [...shared, field("学历")] };
  const rival = { platform: "beisen", seenAt: "2026-09-21", origins: ["https://c.example"], fields: shared };

  let list = fs.mergeSnapshot([], first).list;
  assert.equal(list.length, 1);

  const merged = fs.mergeSnapshot(list, second);
  assert.equal(merged.matched, true);
  assert.equal(merged.list.length, 1);
  assert.equal(merged.list[0].seen, 2);
  assert.deepEqual(merged.list[0].origins, ["https://a.example", "https://b.example"]);
  assert.equal(merged.list[0].fields.length, 5, "字段取并集");

  // 字段一模一样但平台不同，也不该并成一条 —— 驱动方式按平台走。
  const separated = fs.mergeSnapshot(merged.list, rival);
  assert.equal(separated.matched, false);
  assert.equal(separated.list.length, 2);
});

test("同一字段驱动方式不一致时保留更保守的那种，选项留更全的那份", () => {
  const held = { fields: [field("学历", { control: "combobox", drive: "native-setter", options: ["本科"] })] };
  const next = { fields: [field("学历", { control: "combobox", drive: "open-pick", options: ["本科", "硕士", "博士"] })] };

  const merged = fs.mergeFields(held.fields, next.fields);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].drive, "open-pick", "点开选比直接赋值保守，不能被一次侥幸覆盖");
  assert.deepEqual(merged[0].options, ["本科", "硕士", "博士"]);
  assert.equal(merged[0].seen, 2);
});

test("快照只含结构，任何填写内容都不会被序列化出去", () => {
  const snapshot = {
    platform: "moka",
    seen: 1,
    seenAt: "2026-09-20",
    origins: ["https://a.example"],
    fields: [{ label: "姓名", control: "input:text", drive: "native-setter", options: [], value: "张三", resumeKey: "姓名" }]
  };

  const text = fs.serialize([snapshot]);
  const parsed = JSON.parse(text);

  assert.equal(text.includes("张三"), false, "简历值不该出现在快照里");
  assert.equal(parsed.snapshots[0].fields[0].value, undefined, "字段值这一列根本不该被序列化");
  assert.equal(parsed.snapshots[0].fields[0].label, "姓名");
  // 映射目标是「字段名」不是值，导出它是为了核对对应关系对不对。
  assert.equal(parsed.snapshots[0].fields[0].resumeKey, "姓名");
  assert.equal(parsed.kind, "resume-pro/form-structure");
});

test("当前控件家族更新并随结构导出；未识别时清掉旧家族，映射身份保持不变", () => {
  const original=field("开始时间",{control:"date-picker",drive:"click-focus-type-enter",controlFamily:"element",controlEvidence:"published-source",resumeKey:"开始时间"});
  const current=field("开始时间",{control:"date-picker",drive:"open-calendar-pick",controlFamily:"iview",controlEvidence:"published-source"});
  const merged=fs.mergeFields([original],[current]);
  assert.equal(merged[0].controlFamily,"iview");assert.equal(merged[0].drive,"open-calendar-pick");assert.equal(merged[0].resumeKey,"开始时间");
  const exported=JSON.parse(fs.serialize([{fields:merged}])).snapshots[0].fields[0];
  assert.equal(exported.controlEvidence,"published-source");assert.equal(exported.controlFamily,"iview");
  assert.equal(fs.fieldIdentity(original),fs.fieldIdentity(current));
  const unknown=fs.mergeFields(merged,[{...current,controlFamily:"",controlEvidence:""}]);
  assert.equal(unknown[0].controlFamily,"");assert.equal(unknown[0].controlEvidence,"");
});

test("控件 id 里的数字打码，候选人编号不会进快照", () => {
  assert.equal(fs.maskIdentifier("candidate_20260921_field12"), "candidate_#_field#");
  assert.equal(fs.maskIdentifier(undefined), "");
});

test("标签被清空时，字段身份和指纹退到 name / id / placeholder", () => {
  assert.equal(fs.fieldKey({ label: "姓名", name: "user_name" }), "姓名");
  assert.equal(fs.fieldKey({ label: "", name: "user_name" }), "user_name");
  assert.equal(fs.fieldKey({ label: "", name: "", id: "field_#" }), "field_#");
  assert.equal(fs.fieldKey({ label: "", name: "", id: "", placeholder: "请选择" }), "", "占位语没有信息量，不该当字段身份");
  assert.equal(fs.fieldKey({ label: "", name: "", id: "", placeholder: "work_city" }), "work_city");

  // 标签全空但结构名一致的两份快照，仍然要能合并成一条，不能每次跑都新增。
  const named = (name) => ({ fields: [
    { label: "", name, control: "input:text", drive: "native-setter" },
    { label: "", name: `${name}_b`, control: "input:text", drive: "native-setter" },
    { label: "", name: `${name}_c`, control: "input:text", drive: "native-setter" },
    { label: "", name: `${name}_d`, control: "input:text", drive: "native-setter" }
  ] });
  const first = { platform: "moka", seenAt: "2026-09-21", origins: ["https://a.example"], ...named("work_exp") };
  const again = { platform: "moka", seenAt: "2026-09-22", origins: ["https://b.example"], ...named("work_exp") };

  const merged = fs.mergeSnapshot(fs.mergeSnapshot([], first).list, again);
  assert.equal(merged.matched, true, "没有中文标签也要认得出是同一个模板");
  assert.equal(merged.list.length, 1);
});

test("快照数量有上限，超出的淘汰最旧的", () => {
  let list = [];
  for (let index = 0; index < fs.SNAPSHOT_LIMIT + 5; index += 1) {
    const snapshot = {
      platform: "unknown",
      seenAt: `2026-01-${String(index % 28 + 1).padStart(2, "0")}`,
      origins: [`https://site${index}.example`],
      // 每个都造一组互不相似的字段，保证不会被合并成一条。
      fields: [field(`只有站点${index}有的字段`), field(`字段甲${index}`), field(`字段乙${index}`)]
    };
    list = fs.mergeSnapshot(list, snapshot).list;
  }

  assert.equal(list.length, fs.SNAPSHOT_LIMIT);
});

test("认不出来的控件线索随快照导出，合并时按最新一次刷新", () => {
  const base = {
    platform: "feishu",
    seenAt: "2026-09-21",
    origins: ["https://a.jobs.feishu.cn"],
    fields: [field("姓名"), field("邮箱"), field("学校名称"), field("专业")]
  };

  const first = fs.mergeSnapshot([], {
    ...base,
    unrecognized: [{ reason: "no-label", hint: "ud__input < ud__form-item" }],
    unrecognizedTotal: 1
  }).list[0];

  assert.equal(first.unrecognizedTotal, 1);

  // 这次一个都没漏：旧线索必须清掉，否则导出文件里一直是上次的账。
  const cleared = fs.mergeSnapshot([first], { ...base, seenAt: "2026-09-24", unrecognized: [], unrecognizedTotal: 0 });
  assert.deepEqual(cleared.list[0].unrecognized, []);
  assert.equal(cleared.list[0].unrecognizedTotal, 0);

  // 这次没带这个键（旧版本存的快照）时，保留原来的线索。
  const kept = fs.mergeSnapshot([first], { ...base, seenAt: "2026-09-24" });
  assert.equal(kept.list[0].unrecognized.length, 1);

  const text = fs.serialize([{ ...base, unrecognized: [{ reason: "combo-no-label", hint: "ud__select" }], unrecognizedTotal: 3,
    fields: [field("学历", { result: "failed" })] }]);
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.snapshots[0].unrecognized, [{ reason: "combo-no-label", hint: "ud__select" }]);
  assert.equal(parsed.snapshots[0].unrecognizedTotal, 3);
  assert.equal(parsed.snapshots[0].fields[0].result, "failed", "写入结果要能导出来核对，它不含任何填写内容");
});

test("旧规则学出来的映射按版本号一次性作废，结构和选项留着", () => {
  const poisoned = {
    platform: "feishu",
    seenAt: "2026-09-24",
    origins: ["https://x.jobs.feishu.cn"],
    fields: [
      { label: "项目名称", recordIndex: 1, control: "input:text", drive: "native-setter", options: [],
        resumeKey: "姓名", resumeGroup: "基本信息", hits: 1, misses: 0, groupSignature: "项目名称|描述" },
      { label: "学历", control: "combobox", drive: "open-pick", options: ["硕士", "本科"], resumeKey: "", hits: 0, misses: 0 }
    ]
  };

  const upgraded = fs.upgradeMappings(poisoned);

  assert.equal(upgraded.mappingSchema, fs.MAPPING_SCHEMA);
  assert.equal(upgraded.fields[0].resumeKey, "", "姓名不该再被照映射写进项目名称");
  assert.equal(upgraded.fields[0].hits, 0);
  assert.equal(upgraded.fields[0].groupSignature, "");
  assert.deepEqual(upgraded.fields[1].options, ["硕士", "本科"], "结构和选项要留着，下次不必重新点开");
  assert.equal(fs.lookupMapping(upgraded, { label: "项目名称", recordIndex: 1 }), null);
  assert.deepEqual(fs.upgradeMappings(upgraded), upgraded, "已经是新版本的原样返回");
});
