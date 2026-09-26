(function attachResumeProFormStructure(root) {
  // 平台结构快照：只存「这个平台的表单长什么样、控件要怎么驱动、下拉里有哪些选项」，
  // 绝不存用户填进去的任何内容。选项和标签是平台定义的，跨公司稳定，也不含个人信息。

  const SNAPSHOT_LIMIT = 30;
  const FIELD_LIMIT = 120;
  const OPTIONS_LIMIT = 60;
  const SIMILARITY_THRESHOLD = 0.75;

  // 认平台的线索来自页面本身：脚本来源、容器类名、根节点特征，以及托管域名。
  // 两类都要 —— 飞书招聘、Moka、北森这类平台常用自有域名挂候选人表单，域名本身就是强特征；
  // 而另一些平台会嵌在企业自己的域名下，那种只能靠类名和脚本来源认。
  const PLATFORM_MARKERS = [
    { id: "feishu", hints: [/feishu|larksuite|lark\.office/i] },
    { id: "moka", hints: [/moka|mokahr/i] },
    { id: "beisen", hints: [/beisen|italent|zhiye/i] },
    { id: "hotjob", hints: [/hotjob|wecruit/i] },
    { id: "dayi", hints: [/dayi|deye|大易/i] },
    { id: "successfactors", hints: [/sapsf|successfactors/i] },
    { id: "workday", hints: [/workday|myworkday/i] },
    { id: "nowcoder", hints: [/nowcoder|nowcp|nowjob/i] },
    { id: "kincere", hints: [/kincere|才匠/i] },
    { id: "yonyou", hints: [/yonyou|hrcloud|用友/i] },
    { id: "sinostrong", hints: [/sinostrong|微聘/i] },
    { id: "jinyou", hints: [/jinyou|金柚/i] }
  ];

  function normalizeLabel(value) {
    return String(value ?? "")
      .replace(/[*＊?？:：\s]+/g, "")
      .replace(/[（(].*?[)）]/g, "")
      .replace(/请(输入|选择)/g, "")
      .trim()
      .toLowerCase();
  }

  function detectPlatform(signals) {
    const haystack = (Array.isArray(signals) ? signals : []).join(" ").toLowerCase();
    return PLATFORM_MARKERS.find((marker) => marker.hints.some((hint) => hint.test(haystack)))?.id || "unknown";
  }

  // 一个字段在模板里叫什么：优先标签，标签不可信被清空后退到 name / 打码 id / placeholder。
  // 结构指纹也用它 —— 否则标签全空的快照指纹是空的，永远合并不上，每跑一次多存一条。
  function fieldKey(field) {
    return normalizeLabel(field?.label) || normalizeLabel(field?.name)
      || normalizeLabel(field?.id) || normalizeLabel(field?.placeholder);
  }

  function labelSet(snapshot) {
    return new Set((Array.isArray(snapshot?.fields) ? snapshot.fields : []).map(fieldKey).filter(Boolean));
  }

  // 按较小的集合归一（而不是 Jaccard）：一家公司多出一倍自定义字段时，
  // Jaccard 会掉到阈值以下，把同一个平台的模板拆成两条互不复用的记录。
  const MIN_LABELS_TO_MATCH = 4;

  function similarity(left, right) {
    const a = labelSet(left);
    const b = labelSet(right);
    const smaller = Math.min(a.size, b.size);
    if (!smaller || smaller < MIN_LABELS_TO_MATCH) {
      return 0;
    }

    let shared = 0;
    a.forEach((label) => {
      if (b.has(label)) {
        shared += 1;
      }
    });

    return shared / smaller;
  }

  // 控件 id 常带候选人编号或时间戳（candidate_12345、form_1699...），数字换成 # 再存：
  // 结构特征本身不需要数字，留着的唯一效果是把人认出来。
  function maskIdentifier(value) {
    return String(value ?? "").replace(/\d+/g, "#").slice(0, 40);
  }

  // 身份键含段号（第一段和第五段的「项目名称」是两个字段），不含控件类型
  // （同一家公司把下拉换成组合框很常见，不该因此变成两个字段）—— 这样映射条目
  // 能直接挂在已有的结构行上，而不是另起一条。
  function fieldIdentity(field) {
    return `${fieldKey(field)}|${field?.recordIndex || 0}`;
  }

  // 同一字段在不同公司可能用不同驱动方式（有的日期框能直接赋值，有的必须聚焦回车）；
  // 这种情况保留更保守的那一种，别让一次侥幸成功把该聚焦的结论覆盖掉。
  const DRIVE_RANK = {
    "open-search-pick": 7,
    "open-pick": 6,
    "cascade-select": 5,
    "click-focus-type-enter": 4,
    "focus-type-enter": 3,
    "native-keyboard": 2,
    "native-option": 1,
    "native-radio": 1,
    "native-checkbox": 1,
    "native-setter": 1,
    unknown: 0
  };

  function mergeFields(existing, incoming) {
    const byId = new Map((existing || []).map((field) => [fieldIdentity(field), { ...field }]));

    (incoming || []).forEach((field) => {
      const id = fieldIdentity(field);
      const held = byId.get(id);
      if (!held) {
        byId.set(id, { ...field, seen: 1 });
        return;
      }

      const safer = (DRIVE_RANK[field.drive] || 0) >= (DRIVE_RANK[held.drive] || 0) ? field.drive : held.drive;
      const options = (field.options || []).length >= (held.options || []).length ? field.options : held.options;
      byId.set(id, {
        ...held,
        drive: safer,
        options: (options || []).slice(0, OPTIONS_LIMIT),
        // 本次采集没带映射，不代表要删掉上次建好的那条。
        resumeKey: field.resumeKey || held.resumeKey,
        resumeGroup: field.resumeGroup || held.resumeGroup,
        groupSignature: field.groupSignature || held.groupSignature,
        hits: Math.max(held.hits || 0, field.hits || 0),
        misses: held.misses || 0,
        seen: (held.seen || 1) + 1,
        lastOk: field.result === "ok" ? true : held.lastOk
      });
    });

    return [...byId.values()].slice(0, FIELD_LIMIT);
  }

  // 映射的学习规则修过两次：本地规则的宽松匹配（id 里带 name 就当成人名）和
  // 模型的截取/改写都会被学下来，然后照映射一遍遍复现同一个错 ——
  // 真实后果是「张三」被写进三个项目名称、整段英语水平被写进「语言」格。
  // 这些映射还都"写成功"，落空计数永远不涨，自动删除机制救不了。
  // 所以按版本号一次性作废旧映射：结构和选项留着，映射下次填写按新规则重新学。
  const MAPPING_SCHEMA = 2;

  function upgradeMappings(snapshot) {
    if (!snapshot || snapshot.mappingSchema === MAPPING_SCHEMA) {
      return snapshot;
    }

    return {
      ...snapshot,
      mappingSchema: MAPPING_SCHEMA,
      fields: (Array.isArray(snapshot.fields) ? snapshot.fields : []).map((field) => (
        field?.resumeKey
          ? { ...field, resumeKey: "", resumeGroup: "", hits: 0, misses: 0, groupSignature: "" }
          : field
      ))
    };
  }

  function mergeSnapshot(list, next, threshold = SIMILARITY_THRESHOLD) {
    const snapshots = Array.isArray(list) ? list.slice() : [];
    const index = snapshots.findIndex((held) => held.platform === next.platform && similarity(held, next) >= threshold);

    if (index < 0) {
      return { list: [{ ...next, firstSeen: next.seenAt, seen: 1 }, ...snapshots].slice(0, SNAPSHOT_LIMIT), matched: false };
    }

    const held = snapshots[index];
    snapshots[index] = {
      ...held,
      fields: mergeFields(held.fields, next.fields),
      seen: (held.seen || 1) + 1,
      seenAt: next.seenAt,
      // 认不出来的控件按最新一次刷新：留着旧线索会看不出这次还剩哪些没识别。
      unrecognized: next.unrecognized?.length ? next.unrecognized : (next.unrecognized ? [] : held.unrecognized || []),
      unrecognizedTotal: next.unrecognizedTotal ?? held.unrecognizedTotal ?? 0,
      origins: [...new Set([...(held.origins || []), ...(next.origins || [])])].slice(0, 10)
    };

    return { list: snapshots, matched: true, platform: held.platform };
  }

  // 映射条目直接住在快照的字段上（resumeKey / hits / misses / groupSignature），
  // 不另开一个存储键：快照本来就按平台合并、带版本、能导出，再开一份只会两边跑偏。
  const MAPPING_MISS_LIMIT = 3;

  // 采集到的值回查简历，解析出「这个位置对应哪条简历字段」。
  // 只认原样相等和写法不同两档 —— 截取、改写说明模型动过内容，那是值的问题，不是对应关系。
  // groupSignature 由扫描侧算好传进来：哪个 DOM 容器属于哪一段，只有那边知道。
  function buildMappingEntries(pageFields, resumeFields, findSource) {
    if (typeof findSource !== "function") {
      return [];
    }

    const entries = [];
    (Array.isArray(pageFields) ? pageFields : []).forEach((item) => {
      const label = normalizeLabel(item.label);
      if (!label || !item.value) {
        return;
      }

      const source = findSource(item.value, resumeFields);
      if (!source || (source.relation !== "exact" && source.relation !== "date") || !source.field?.key) {
        return;
      }

      entries.push({
        label: item.label,
        recordIndex: Number.isInteger(item.recordIndex) ? item.recordIndex : 0,
        recordTotal: item.recordTotal || 0,
        groupSignature: item.recordSignature || "",
        resumeKey: source.field.key,
        resumeGroup: source.field.group || ""
      });
    });

    return entries;
  }

  function applyMappingEntries(snapshot, entries) {
    const fields = Array.isArray(snapshot.fields) ? snapshot.fields.slice() : [];
    const index = new Map(fields.map((field, position) => [fieldIdentity(field), position]));
    let changed = 0;

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const id = fieldIdentity(entry);
      const position = index.get(id);

      if (position === undefined) {
        fields.push({
          label: entry.label, control: "mapped", drive: "mapping", options: [],
          recordIndex: entry.recordIndex || undefined, recordTotal: entry.recordTotal || undefined,
          resumeKey: entry.resumeKey, resumeGroup: entry.resumeGroup,
          groupSignature: entry.groupSignature, hits: 1, misses: 0
        });
        index.set(id, fields.length - 1);
        changed += 1;
        return;
      }

      const held = fields[position];
      if (held.resumeKey === entry.resumeKey) {
        held.hits = (held.hits || 0) + 1;
        held.misses = 0;
      } else {
        // 你手工把这一格改成了另一条简历字段 —— 以最后一次为准，命中数重新起算。
        held.resumeKey = entry.resumeKey;
        held.resumeGroup = entry.resumeGroup;
        held.hits = 1;
        held.misses = 0;
      }
      if (entry.groupSignature) {
        held.groupSignature = entry.groupSignature;
      }
      changed += 1;
    });

    return { snapshot: { ...snapshot, fields }, changed };
  }

  function lookupMapping(snapshot, field) {
    if (!fieldKey(field)) {
      return null;
    }

    const key = fieldIdentity(field);
    const hit = (Array.isArray(snapshot?.fields) ? snapshot.fields : [])
      .find((mapped) => mapped.resumeKey && fieldIdentity(mapped) === key);

    if (!hit) {
      return null;
    }
    // 段号相同但块里的字段对不上，说明这家公司加了自定义字段 —— 整段回落 AI，别硬填。
    if (hit.groupSignature && field.recordIndex && hit.groupSignature !== field.groupSignature) {
      return null;
    }

    return hit;
  }

  function recordMappingOutcome(snapshot, key, ok) {
    const field = (Array.isArray(snapshot?.fields) ? snapshot.fields : []).find((item) => item.resumeKey && fieldIdentity(item) === key);
    if (!field) {
      return { dropped: false };
    }

    if (ok) {
      field.hits = (field.hits || 0) + 1;
      field.misses = 0;
      return { dropped: false };
    }

    field.misses = (field.misses || 0) + 1;
    if (field.misses < MAPPING_MISS_LIMIT) {
      return { dropped: false };
    }

    snapshot.fields = snapshot.fields.filter((item) => item !== field);
    return { dropped: true, label: field.label, resumeKey: field.resumeKey };
  }

  function serialize(snapshots) {
    return JSON.stringify({
      kind: "resume-pro/form-structure",
      version: 1,
      // 只有结构：平台、字段标识、控件类型、驱动方式、选项原文、分段数。
      // 值冒充标签的（无 label 关联的站点）在扫描侧就被丢弃；自动完成框里的历史记录
      // 按「等于某个已填值」过滤掉。见 content.js 的 markUnreliableLabels 和 captureFormStructure。
      snapshots: (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => ({
        version: snapshot.version || 1,
        platform: snapshot.platform,
        seen: snapshot.seen,
        seenAt: snapshot.seenAt,
        unlabeledCombos: snapshot.unlabeledCombos || 0,
        mappingSchema: snapshot.mappingSchema || 0,
        unrecognized: snapshot.unrecognized || [],
        unrecognizedTotal: snapshot.unrecognizedTotal || 0,
        origins: snapshot.origins || [],
        fields: (snapshot.fields || []).map((field) => ({
          label: field.label,
          name: field.name || "",
          id: field.id || "",
          placeholder: field.placeholder || "",
          control: field.control,
          drive: field.drive,
          options: field.options || [],
          recordIndex: field.recordIndex,
          recordTotal: field.recordTotal,
          result: field.result || "untested",
          resumeKey: field.resumeKey || "",
          resumeGroup: field.resumeGroup || "",
          hits: field.hits || 0,
          misses: field.misses || 0,
          groupSignature: field.groupSignature || "",
          seen: field.seen
        }))
      }))
    }, null, 1);
  }

  const api = {
    FIELD_LIMIT,
    MAPPING_MISS_LIMIT,
    MAPPING_SCHEMA,
    OPTIONS_LIMIT,
    PLATFORM_MARKERS,
    SIMILARITY_THRESHOLD,
    SNAPSHOT_LIMIT,
    applyMappingEntries,
    buildMappingEntries,
    detectPlatform,
    fieldIdentity,
    fieldKey,
    labelSet,
    lookupMapping,
    maskIdentifier,
    mergeFields,
    mergeSnapshot,
    normalizeLabel,
    upgradeMappings,
    recordMappingOutcome,
    serialize,
    similarity
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.ResumeProFormStructure = api;
})(typeof self !== "undefined" ? self : globalThis);
