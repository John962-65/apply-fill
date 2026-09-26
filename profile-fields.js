// 「我的信息」：网申表常问、简历里通常没有的字段。设置页、侧边栏和测试共用这一份定义。
(function attachResumeProProfile(globalScope) {
  const YES_NO = ["是", "否"];

  // id 是存储用的键，改了会丢用户数据；key 是交给匹配规则和 AI 的字段名，也是侧边栏芯片上的字。
  // 地区字段的 key 按「归属 + 层级」命名（籍贯省、户口所在地区县），ai-helpers 靠它分清省市县。
  // aliases 只用来判断「网页上这个字段我们已经有了」，不会作为字段名交出去。
  const PROFILE_SCHEMA = [
    {
      name: "基本信息",
      fields: [
        { id: "name", key: "姓名", aliases: ["真实姓名"] },
        { id: "namePinyin", key: "姓名拼音", placeholder: "ZHANG SAN", aliases: ["拼音"] },
        { id: "usedName", key: "曾用名" },
        { id: "gender", key: "性别", type: "select", options: ["男", "女"] },
        { id: "birth", key: "出生年月", type: "month", aliases: ["出生日期", "生日"] },
        { id: "ethnicity", key: "民族", placeholder: "汉族" },
        { id: "political", key: "政治面貌", type: "select", options: ["中共党员", "中共预备党员", "共青团员", "民主党派", "群众"] },
        { id: "marital", key: "婚姻状况", type: "select", options: ["未婚", "已婚", "离异", "丧偶"] },
        { id: "idType", key: "证件类型", type: "select", options: ["居民身份证", "护照", "港澳居民来往内地通行证", "台湾居民来往大陆通行证", "其他"] },
        { id: "idNumber", key: "证件号码", aliases: ["证件号", "身份证号", "身份证号码"] },
        { id: "height", key: "身高", label: "身高（厘米）" },
        { id: "weight", key: "体重", label: "体重（公斤）" },
        { id: "health", key: "健康状况", type: "select", options: ["健康", "良好", "一般"] },
        { id: "seriousDisease", key: "有无重大疾病史", type: "select", options: ["无", "有"] }
      ]
    },
    {
      name: "户籍与地区",
      fields: [
        { id: "nativeProvince", key: "籍贯省", label: "籍贯（省）" },
        { id: "nativeCity", key: "籍贯市", label: "籍贯（市）" },
        { id: "nativeCounty", key: "籍贯县", label: "籍贯（区县）" },
        { id: "hukouProvince", key: "户口所在地省", label: "户口所在地（省）" },
        { id: "hukouCity", key: "户口所在地市", label: "户口所在地（市）" },
        { id: "hukouCounty", key: "户口所在地区县", label: "户口所在地（区县）" },
        { id: "hukouType", key: "户口性质", type: "select", options: ["城镇", "农村"] },
        { id: "examProvince", key: "高考生源地省", label: "高考生源地（省）" },
        { id: "examCity", key: "高考生源地市", label: "高考生源地（市）" },
        { id: "homeAddress", key: "家庭住址", type: "textarea", aliases: ["家庭地址"] },
        { id: "currentAddress", key: "现居住地", type: "textarea", aliases: ["现住址", "居住地址", "通讯地址"] }
      ]
    },
    {
      name: "联系方式",
      fields: [
        { id: "phone", key: "手机号码", aliases: ["手机", "手机号", "移动电话", "联系电话"] },
        { id: "email", key: "常用邮箱", aliases: ["邮箱", "电子邮箱", "电子邮件"] },
        { id: "emergencyName", key: "紧急联系人姓名", aliases: ["紧急联系人"] },
        { id: "emergencyRelation", key: "紧急联系人关系", placeholder: "父亲" },
        { id: "emergencyPhone", key: "紧急联系人电话", aliases: ["紧急联系电话", "紧急联系人手机"] }
      ]
    },
    {
      name: "教育补充",
      fields: [
        { id: "highestEducation", key: "最高学历", type: "select", options: ["博士研究生", "硕士研究生", "大学本科", "大学专科", "高中及以下"], aliases: ["学历"] },
        { id: "highestDegree", key: "最高学位", type: "select", options: ["博士", "硕士", "学士", "无"], aliases: ["学位"] },
        { id: "studyMode", key: "学习形式", type: "select", options: ["全日制", "非全日制"] },
        { id: "graduation", key: "毕业时间", type: "month", aliases: ["毕业日期"] },
        { id: "classRank", key: "专业排名", placeholder: "前 10%" },
        { id: "studentCadre", key: "是否学生干部", type: "select", options: YES_NO },
        { id: "doubleDegree", key: "是否双学位", type: "select", options: YES_NO },
        { id: "upgrade", key: "是否专升本", type: "select", options: YES_NO },
        { id: "highSchool", key: "高中毕业学校" }
      ]
    },
    {
      name: "语言与技能",
      fields: [
        { id: "language", key: "外语语种", placeholder: "英语", aliases: ["外语"] },
        { id: "languageLevel", key: "外语等级", placeholder: "CET-6" },
        { id: "languageScore", key: "外语成绩" },
        { id: "computerLevel", key: "计算机水平" },
        { id: "skills", key: "技能特长", type: "textarea" }
      ]
    },
    {
      name: "求职补充",
      fields: [
        { id: "expectedCity", key: "期望工作地点" },
        { id: "availableDate", key: "可到岗时间" },
        { id: "acceptAdjustment", key: "是否服从调剂", type: "select", options: YES_NO },
        { id: "specialCategory", key: "专项招聘类别" },
        { id: "awards", key: "奖励荣誉", type: "textarea" }
      ]
    }
  ];

  const FAMILY_GROUP = "家庭主要成员";
  const FAMILY_RELATIONS = ["父亲", "母亲", "配偶", "兄弟姐妹", "子女", "其他亲属"];
  // 这几种关系只会有一个人，备份追加时按关系对上；其他关系按姓名对上。
  const SINGLE_RELATIONS = new Set(["父亲", "母亲", "配偶"]);
  const FAMILY_FIELDS = [
    { id: "name", key: "姓名" },
    { id: "birth", key: "出生年月", type: "month" },
    { id: "political", key: "政治面貌" },
    { id: "company", key: "工作单位" },
    { id: "job", key: "职务" },
    { id: "phone", key: "联系电话" }
  ];

  const CUSTOM_GROUP = "补充字段";
  const MAX_CUSTOM_FIELDS = 200;
  const MAX_OFFERED_LABELS = 20;

  const SKIPPED_INPUT_TYPES = new Set(["password", "file", "checkbox", "hidden", "submit", "button", "reset", "image"]);
  // 补充字段是用户自己起的名，拦不住一行叫「网银密码」：这种字段不推荐、不交给 AI。
  const SECRET_LABEL = /密码|口令|验证码|校验码|授权码|密钥|私钥|令牌|password|passwd|captcha|token|secret/i;
  // 名字普通、内容却是「密码：xxx」这种写法的，同样不交给 AI。
  const SECRET_VALUE = /(密码|口令|验证码|校验码|授权码|密钥|令牌|password|passwd|pwd|token|secret)\s*[:=：]\s*\S/i;

  function text(value) {
    return String(value ?? "").trim();
  }

  function normalizeKey(value) {
    return text(value).toLowerCase().replace(/[\s:：*（）()【】[\]\-_/.·]+/g, "");
  }

  function emptyProfile() {
    return { values: {}, family: [], custom: [] };
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const profile = emptyProfile();

    if (source.values && typeof source.values === "object") {
      for (const [id, value] of Object.entries(source.values)) {
        const clean = text(value);
        if (clean) profile.values[id] = clean;
      }
    }

    for (const member of Array.isArray(source.family) ? source.family : []) {
      if (!member || typeof member !== "object") continue;

      const relation = text(member.relation);
      const next = { relation: FAMILY_RELATIONS.includes(relation) ? relation : "其他亲属" };
      FAMILY_FIELDS.forEach((field) => {
        next[field.id] = text(member[field.id]);
      });

      if (FAMILY_FIELDS.some((field) => next[field.id])) {
        profile.family.push(next);
      }
    }

    // 值为空的补充字段也留着：那是从网页上加进来、等用户补内容的。
    // 同名的只留一条，优先留有内容的，免得先加的空行把后填的内容挤掉。
    const byKey = new Map();
    for (const item of Array.isArray(source.custom) ? source.custom : []) {
      const key = text(item?.key);
      const normalized = normalizeKey(key);
      if (!normalized) continue;

      const value = text(item?.value);
      const existing = byKey.get(normalized);
      if (existing) {
        if (!existing.value && value) existing.value = value;
        continue;
      }
      if (byKey.size >= MAX_CUSTOM_FIELDS) continue;
      byKey.set(normalized, { key, value });
    }
    profile.custom = [...byKey.values()];

    return profile;
  }

  // 同一关系有多人时加序号（兄弟姐妹1、兄弟姐妹2），只有一人时不加。
  function familyPrefixes(family) {
    const totals = {};
    family.forEach((member) => {
      totals[member.relation] = (totals[member.relation] || 0) + 1;
    });
    const seen = {};
    return family.map((member) => {
      seen[member.relation] = (seen[member.relation] || 0) + 1;
      return totals[member.relation] > 1 ? `${member.relation}${seen[member.relation]}` : member.relation;
    });
  }

  function profileToResumeFields(rawProfile) {
    const profile = normalizeProfile(rawProfile);
    const fields = [];

    PROFILE_SCHEMA.forEach((group) => {
      group.fields.forEach((field) => {
        const value = profile.values[field.id];
        if (value) fields.push({ group: group.name, key: field.key, value });
      });
    });

    const prefixes = familyPrefixes(profile.family);
    profile.family.forEach((member, index) => {
      // 家庭成员表格里常有一列「关系 / 称谓」下拉框。
      fields.push({ group: FAMILY_GROUP, key: `${prefixes[index]}关系`, value: member.relation });
      FAMILY_FIELDS.forEach((field) => {
        if (member[field.id]) fields.push({ group: FAMILY_GROUP, key: `${prefixes[index]}${field.key}`, value: member[field.id] });
      });
    });

    const emitted = new Set(fields.map((field) => normalizeKey(field.key)));
    profile.custom.forEach((item) => {
      const normalized = normalizeKey(item.key);
      if (!item.value || SECRET_LABEL.test(item.key) || SECRET_VALUE.test(item.value) || emitted.has(normalized)) return;
      emitted.add(normalized);
      fields.push({ group: CUSTOM_GROUP, key: item.key, value: item.value });
    });

    return fields;
  }

  function countProfileValues(profile) {
    return profileToResumeFields(profile).length;
  }

  function countPendingFields(profile) {
    return normalizeProfile(profile).custom.filter((item) => !item.value).length;
  }

  function hasProfileContent(profile) {
    const normalized = normalizeProfile(profile);
    return Boolean(Object.keys(normalized.values).length || normalized.family.length || normalized.custom.length);
  }

  // 模板优先：模板里已有的字段名，档案里的同名字段不再加入。
  function mergeResumeFields(templateFields, profileFields) {
    const template = Array.isArray(templateFields) ? templateFields : [];
    const taken = new Set(template.map((field) => normalizeKey(field?.key)));

    return [
      ...template,
      ...(Array.isArray(profileFields) ? profileFields : []).filter((field) => !taken.has(normalizeKey(field.key)))
    ];
  }

  // 已经有着落的字段名：预置字段（字段名、界面标签、别名）、已有家庭成员的全部字段、补充字段、模板字段。
  function knownFieldKeys(rawProfile, resumeFields) {
    const profile = normalizeProfile(rawProfile);
    const keys = new Set();
    const add = (value) => {
      const normalized = normalizeKey(value);
      if (normalized) keys.add(normalized);
    };

    PROFILE_SCHEMA.forEach((group) => group.fields.forEach((field) => {
      add(field.key);
      add(field.label);
      (field.aliases || []).forEach(add);
    }));
    // 成员已经在档案里、只是某一项没填：这一项该去成员那里补，不该另起一个补充字段。
    familyPrefixes(profile.family).forEach((prefix) => {
      add(`${prefix}关系`);
      FAMILY_FIELDS.forEach((field) => add(`${prefix}${field.key}`));
    });
    profile.custom.forEach((item) => add(item.key));
    (Array.isArray(resumeFields) ? resumeFields : []).forEach((field) => add(field?.key));

    return keys;
  }

  // 一次填写之后，网页上既没匹配上、也还空着的字段。密码验证码、文件、勾选框不算。
  function pickUnansweredLabels(candidates, knownKeys, limit = MAX_OFFERED_LABELS) {
    const picked = [];
    const seen = new Set();

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const label = text(candidate?.label);
      const normalized = normalizeKey(label);

      if (candidate?.matched || candidate?.hasValue) continue;
      if (normalized.length < 2 || label.length > 30) continue;
      if (SKIPPED_INPUT_TYPES.has(candidate?.inputType) || SECRET_LABEL.test(label)) continue;
      if (knownKeys?.has(normalized) || seen.has(normalized)) continue;

      seen.add(normalized);
      picked.push(label);
      if (picked.length >= limit) break;
    }

    return picked;
  }

  function addPendingFields(rawProfile, labels, resumeFields = []) {
    const profile = normalizeProfile(rawProfile);
    const known = knownFieldKeys(profile, resumeFields);
    let added = 0;
    let full = false;

    for (const label of Array.isArray(labels) ? labels : []) {
      const key = text(label);
      const normalized = normalizeKey(key);
      if (!normalized || known.has(normalized) || SECRET_LABEL.test(key)) continue;
      if (profile.custom.length >= MAX_CUSTOM_FIELDS) {
        full = true;
        break;
      }
      known.add(normalized);
      profile.custom.push({ key, value: "" });
      added += 1;
    }

    return { profile, added, full };
  }

  const MAX_WRITEBACK_ENTRIES = 30;
  const MAX_WRITEBACK_KEY_LENGTH = 30;
  const MAX_WRITEBACK_GROUP_LENGTH = 12;
  const FALLBACK_GROUP = "基本信息";

  // 反向采集：从网页上已经填好的内容里，挑出模板还没有的字段。
  // 只挑「新增」。模板里已经有同名 key、或者语义上等价（网页「最高学历」对模板「学历」）的，
  // 只进 skipped 报告，绝不改模板原值 —— 网页上填错了不该把模板一起带错。
  // pageFields 的 value / semantic / order 由页面侧读好传进来；isSemanticMatch 和
  // entityGroupLabels 也从外面传，语义表和分组表只有 ai-helpers 那份，这里不再抄一遍。
  function pickWritebackEntries(pageFields, options = {}) {
    const knownKeys = options.knownKeys instanceof Set
      ? options.knownKeys
      : new Set(Array.isArray(options.knownKeys) ? options.knownKeys : []);
    const templateFields = Array.isArray(options.templateFields) ? options.templateFields : [];
    const templateGroups = Array.isArray(options.templateGroups) ? options.templateGroups : [];
    const entityGroupLabels = Array.isArray(options.entityGroupLabels) ? options.entityGroupLabels : [];
    const isSemanticMatch = typeof options.isSemanticMatch === "function" ? options.isSemanticMatch : null;
    const findSource = typeof options.findSource === "function" ? options.findSource : null;
    const entries = [];
    const skipped = [];
    let truncated = false;

    const usable = (Array.isArray(pageFields) ? pageFields : []).filter((field) => {
      const key = text(field?.label);
      return Boolean(normalizeKey(key)) && normalizeKey(key).length >= 2
        && key.length <= MAX_WRITEBACK_KEY_LENGTH && Boolean(text(field?.value));
    });

    // 多段经历里同组同名（三个「学校」）分不出第几段，整组都不写：写错比不写更糟。
    const sameNameCount = new Map();
    usable.forEach((field) => {
      const id = duplicateId(field.group, field.label);
      sameNameCount.set(id, (sameNameCount.get(id) || 0) + 1);
    });

    const resolved = new Set();

    for (const field of usable) {
      const key = text(field.label);
      const value = text(field.value);
      const group = text(field.group);
      const inputType = String(field.inputType ?? "").toLowerCase();

      if (SKIPPED_INPUT_TYPES.has(inputType) || inputType === "password") continue;
      if (SECRET_LABEL.test(key) || SECRET_VALUE.test(value)) {
        skipped.push({ key, group, reason: "secret" });
        continue;
      }
      let entryKey = key;
      if (sameNameCount.get(duplicateId(group, key)) > 1) {
        // 分得清是第几段就编号收下；分不清仍然整组跳过 —— 把第三段的名字写成第一段，
        // 比这一项空着更糟。
        if (!Number.isInteger(field.recordIndex)) {
          skipped.push({ key, group, reason: "duplicate-in-group" });
          continue;
        }
        entryKey = `${key}${field.recordIndex}`;
      }
      const entryNormalized = normalizeKey(entryKey);

      if (knownKeys.has(entryNormalized)) {
        // 「我的信息」的预置字段名一律算 known，但预置项可能还是空的 —— 那种情况要标出来，
        // 否则用户在网页上手填的值两边都留不下。
        const templateValue = findTemplateValue(templateFields, entryNormalized);
        skipped.push({ key: entryKey, group, reason: templateValue ? "known" : "known-empty", templateValue });
        continue;
      }

      const semantic = text(field.semantic);
      const twin = semantic && isSemanticMatch
        ? templateFields.find((item) => isSemanticMatch(semantic, item, field))
        : null;
      if (twin) {
        skipped.push({
          key: entryKey, group, reason: "semantic-known",
          templateKey: text(twin.key), templateValue: text(twin.value)
        });
        continue;
      }

      // 值在简历里已经有出处 = 已有事实的站点别名（歌尔叫「毕业学校」、飞书叫「学校名称」）。
      // 进模板只会越写越乱；别名知识归平台映射管，模板只收简历里根本没有的新事实。
      if (findSource) {
        const source = findSource(value, templateFields);
        if (source && source.relation !== "none") {
          skipped.push({
            key: entryKey, group, reason: "alias",
            templateKey: text(source.field?.key), templateValue: text(source.field?.value)
          });
          continue;
        }
      }

      const targetGroup = resolveWritebackGroup(group, templateGroups, entityGroupLabels);
      if (resolved.has(duplicateId(targetGroup, entryKey))) {
        skipped.push({ key: entryKey, group, reason: "duplicate-in-group" });
        continue;
      }

      if (entries.length >= MAX_WRITEBACK_ENTRIES) {
        truncated = true;
        continue;
      }

      resolved.add(duplicateId(targetGroup, entryKey));
      entries.push({
        key: entryKey,
        group: targetGroup,
        value,
        order: Number.isFinite(field.order) ? field.order : entries.length
      });
    }

    return { entries, skipped, truncated };
  }

  function duplicateId(group, key) {
    return `${normalizeKey(text(group))}::${normalizeKey(text(key))}`;
  }

  // 就地往模板对象里追加字段，返回真正加进去的那几项。同组已有同名字段就跳过：
  // 预览到点击之间模板可能又被改过，这里只补还缺的，不覆盖任何已有值。
  function addFieldsToTemplate(template, entries) {
    const groups = Array.isArray(template?.groups) ? template.groups : [];
    const taken = new Map();
    groups.forEach((group) => {
      const bucket = taken.get(normalizeKey(text(group?.name))) || new Set();
      (Array.isArray(group?.fields) ? group.fields : []).forEach((field) => bucket.add(normalizeKey(text(field?.key))));
      taken.set(normalizeKey(text(group?.name)), bucket);
    });

    const added = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      const key = text(entry?.key);
      const groupName = text(entry?.group) || FALLBACK_GROUP;
      if (!key) continue;

      let group = groups.find((item) => normalizeKey(text(item?.name)) === normalizeKey(groupName));
      if (!group) {
        group = { name: groupName, fields: [] };
        groups.push(group);
        taken.set(normalizeKey(groupName), new Set());
      }
      if (!Array.isArray(group.fields)) {
        group.fields = [];
      }

      const bucket = taken.get(normalizeKey(text(group.name))) || new Set();
      taken.set(normalizeKey(text(group.name)), bucket);
      if (bucket.has(normalizeKey(key))) {
        continue;
      }

      group.fields.push({ key, value: text(entry?.value) });
      bucket.add(normalizeKey(key));
      added.push({ group: text(group.name), key, value: text(entry?.value) });
    }

    return added;
  }

  function findTemplateValue(templateFields, normalizedKey) {
    const hit = templateFields.find((field) => normalizeKey(text(field?.key)) === normalizedKey);
    return hit ? text(hit.value) : "";
  }

  // 「教育经历」和「教育背景」归一化之后互相不包含，但按 ai-helpers 的实体表都算教育，
  // 所以先过一遍实体表，让模板里已有的分组名能被认出来，不另外开一个同义分组。
  function canonicalGroupName(name, entityGroupLabels) {
    const raw = text(name);
    if (!raw) return "";
    const hit = entityGroupLabels.find((item) => item?.pattern instanceof RegExp && item.pattern.test(raw));
    return hit ? hit.label : normalizeKey(raw);
  }

  function resolveWritebackGroup(pageGroup, templateGroups, entityGroupLabels) {
    const raw = text(pageGroup);
    if (!raw) return FALLBACK_GROUP;

    const canonical = canonicalGroupName(raw, entityGroupLabels);
    const sameEntity = (templateGroups || []).find((name) => canonicalGroupName(name, entityGroupLabels) === canonical);
    if (sameEntity) return sameEntity;

    const normalizedPage = normalizeKey(raw);
    const contains = (templateGroups || []).find((name) => {
      const normalizedTemplate = normalizeKey(text(name));
      return normalizedTemplate.length >= 2
        && (normalizedPage.includes(normalizedTemplate) || normalizedTemplate.includes(normalizedPage));
    });
    if (contains) return contains;

    return raw.length <= MAX_WRITEBACK_GROUP_LENGTH ? raw : FALLBACK_GROUP;
  }

  // 设置页表单读出来的一组 { kind, row, field, value }，还原成档案。
  function profileFromEntries(entries) {
    const values = {};
    const family = new Map();
    const custom = new Map();

    for (const entry of Array.isArray(entries) ? entries : []) {
      const value = String(entry?.value ?? "");

      if (entry?.kind === "value") {
        values[entry.field] = value;
      } else if (entry?.kind === "family") {
        if (!family.has(entry.row)) family.set(entry.row, {});
        family.get(entry.row)[entry.field] = value;
      } else if (entry?.kind === "custom") {
        if (!custom.has(entry.row)) custom.set(entry.row, {});
        custom.get(entry.row)[entry.field] = value;
      }
    }

    return normalizeProfile({ values, family: [...family.values()], custom: [...custom.values()] });
  }

  function isSameMember(left, right) {
    if (left.relation !== right.relation) return false;
    if (SINGLE_RELATIONS.has(left.relation)) return true;
    return Boolean(left.name) && normalizeKey(left.name) === normalizeKey(right.name);
  }

  // 备份追加时用：本机已经填了的不动，只补本机空着的。
  function mergeProfiles(localProfile, incomingProfile) {
    const local = normalizeProfile(localProfile);
    const incoming = normalizeProfile(incomingProfile);

    const values = { ...incoming.values, ...local.values };

    const family = local.family.map((member) => ({ ...member }));
    incoming.family.forEach((member) => {
      const match = family.find((existing) => isSameMember(existing, member));
      if (!match) {
        family.push({ ...member });
        return;
      }
      FAMILY_FIELDS.forEach((field) => {
        if (!match[field.id] && member[field.id]) match[field.id] = member[field.id];
      });
    });

    const custom = local.custom.map((item) => {
      if (item.value) return item;
      const match = incoming.custom.find((other) => normalizeKey(other.key) === normalizeKey(item.key));
      return match?.value ? { key: item.key, value: match.value } : item;
    });
    const localKeys = new Set(local.custom.map((item) => normalizeKey(item.key)));
    incoming.custom.forEach((item) => {
      if (!localKeys.has(normalizeKey(item.key))) custom.push(item);
    });

    return normalizeProfile({ values, family, custom });
  }

  const api = {
    CUSTOM_GROUP,
    FAMILY_FIELDS,
    FAMILY_GROUP,
    FAMILY_RELATIONS,
    FALLBACK_GROUP,
    MAX_WRITEBACK_ENTRIES,
    PROFILE_SCHEMA,
    addFieldsToTemplate,
    addPendingFields,
    canonicalGroupName,
    countPendingFields,
    countProfileValues,
    emptyProfile,
    hasProfileContent,
    knownFieldKeys,
    mergeProfiles,
    mergeResumeFields,
    normalizeKey,
    normalizeProfile,
    pickUnansweredLabels,
    pickWritebackEntries,
    profileFromEntries,
    profileToResumeFields,
    resolveWritebackGroup
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.ResumeProProfile = api;
})(typeof self !== "undefined" ? self : globalThis);
