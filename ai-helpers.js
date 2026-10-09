(function attachResumeProAIHelpers(globalScope) {
  const GENERIC_ENTITY_PATTERN = /^([\u4e00-\u9fa5A-Za-z]+?)(\d+)([\u4e00-\u9fa5A-Za-z].*)$/;
  const ENTITY_LABEL_BY_GROUP = [
    { pattern: /教育/, label: "教育经历" },
    { pattern: /实习/, label: "实习经历" },
    { pattern: /工作/, label: "工作经历" },
    { pattern: /科研/, label: "科研经历" },
    { pattern: /校园|在校|校内职务|社团经历|社会实践/, label: "校园经历" },
    { pattern: /项目/, label: "项目经历" },
    { pattern: /论文/, label: "论文" },
    { pattern: /专利/, label: "专利" },
    { pattern: /证书/, label: "证书" },
    { pattern: /奖励|获奖|荣誉/, label: "获奖经历" },
    { pattern: /语言考试|外语考试|语言成绩/, label: "语言考试" },
    { pattern: /语言|外语/, label: "语言能力" },
    { pattern: /技能/, label: "专业技能" }
  ];

  const FIELD_SEMANTICS = [
    { type: "pinyin", keywords: ["拼音", "pinyin"] },
    { type: "email", keywords: ["邮箱", "email", "e-mail", "mail"] },
    { type: "phone", keywords: ["手机", "电话", "联系方式", "mobile", "phone", "联系电话"] },
    { type: "gender", keywords: ["性别", "gender"] },
    { type: "birth_date", keywords: ["出生日期", "生日", "birth", "出生年月"] },
    { type: "name", keywords: ["姓名", "name", "realname"] },
    { type: "id_number", keywords: ["身份证", "证件号码", "证件号", "idnumber", "身份证号"] },
    { type: "hometown", keywords: ["籍贯", "生源地", "户口", "户籍", "nativeplace", "hometown", "hukou"] },
    { type: "region", keywords: ["国家/地区", "国家地区", "country", "region", "地区"] },
    { type: "major", keywords: ["专业", "major"] },
    { type: "school", keywords: ["学校", "院校", "大学", "学院", "school", "university"] },
    { type: "degree", keywords: ["学历", "学位", "培养层次", "degree"] }
  ];

  function detectCascadeGroups(fields, fieldMap) {
    const selectFields = fields.filter((f) => f.tagName === "select" && !f.datePart);
    let cascadeGroupIndex = 0;
    const processedSelectIDs = new Set();
    const locationRegex = /(省|市|区|county|city|province)/i;

    selectFields.forEach((currentField) => {
      if (processedSelectIDs.has(currentField.fieldId)) {
        return;
      }

      const currentElement = fieldMap.get(currentField.fieldId)?.element;
      if (!currentElement) return;

      let parent = currentElement.parentElement;
      let depth = 0;

      while (parent && depth < 5) {
        const validSelectFieldsInParent = selectFields.filter((f) => {
          const el = fieldMap.get(f.fieldId)?.element;
          return el && parent.contains(el);
        });

        if (validSelectFieldsInParent.length > 1) {
          const hasLocationKeywords = validSelectFieldsInParent.some((f) =>
            locationRegex.test(f.name) || locationRegex.test(f.idAttr) || locationRegex.test(f.ariaLabel) || locationRegex.test(f.label)
          );

          let isCascade = hasLocationKeywords;

          if (!isCascade) {
             for (let i = 1; i < validSelectFieldsInParent.length; i++) {
               if (validSelectFieldsInParent[i].options.length <= 1) {
                 isCascade = true;
                 break;
               }
             }
          }

          if (isCascade) {
            const isKeywordBased = hasLocationKeywords;
            let cascadeSelects;
            if (isKeywordBased) {
              cascadeSelects = validSelectFieldsInParent.filter((f) =>
                locationRegex.test(f.name) || locationRegex.test(f.idAttr) ||
                locationRegex.test(f.ariaLabel) || locationRegex.test(f.label) ||
                f.options.length <= 1
              );
            } else {
              const firstSparseIndex = validSelectFieldsInParent.findIndex((f, i) => i > 0 && f.options.length <= 1);
              cascadeSelects = firstSparseIndex > 0
                ? validSelectFieldsInParent.filter((f, i) =>
                    i === firstSparseIndex - 1 || (i >= firstSparseIndex && f.options.length <= 1)
                  )
                : [];
            }
            if (cascadeSelects.length > 1) {
              cascadeSelects.forEach((f, idx) => {
                f.cascadeGroup = `group-${cascadeGroupIndex}`;
                f.cascadeLevel = idx;
                processedSelectIDs.add(f.fieldId);
              });
              cascadeGroupIndex++;
            }
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    });
  }

  const helpers = {
    ENTITY_LABEL_BY_GROUP,
    normalizeText,
    inferFieldSemantic,
    buildRuleBasedMatches,
    selectResumeCandidates,
    findSelectOptionIndex,
    selectEnumTopic,
    checkboxState,
    isPlaceholderOption,
    isResumeFieldMatch,
    phoneSourceValue,
    findResumeSource,
    sourceFieldLabel,
    educationFieldTopic,
    educationValue,
    educationFact,
    selectEnumValue,
    findComposedResumeSource: (value, fields) => composedSource(value, fields, true),
    filterValidMatches,
    isValueValidForField,
    semanticizeParsedFields,
    normalizeParsedFields,
    normalizeDateForPrecision,
    normalizeDateValue,
    normalizeDatePart,
    datePartValue,
    dateSourceMatches,
    expandResumeFields,
    splitDateRange,
    detectCascadeGroups
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }

  globalScope.ResumeProAIHelpers = helpers;

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[\s:：*（）()【】\[\]\-_/.]+/g, "");
  }

  // 只有「姓名」才是人名。关键词 name 太宽：id 里的 project-name、companyName
  // 都会命中，于是本地规则把姓名填进了「项目名称」——真实发生过，还被学成映射连错几轮。
  const PERSON_NAME_LABEL = /姓名|(^|[^a-z])(full|real|given|sur|user)?name([^a-z]|$)/i;
  const THING_NAME_LABEL = /名称|项目|公司|单位|学校|院校|作品|奖|文件|职位|岗位|部门|系统|产品|活动|课程|证书|赛事|团队|组织|城市|地址/;

  function inferFieldSemantic(field) {
    if (/区号|国家代码|calling.?code|dial.?code|country.?code/i.test([field?.label,field?.ariaLabel].filter(Boolean).join(' '))) return '';
    const haystack = normalizeText([
      field?.group,
      field?.label,
      field?.placeholder,
      field?.name,
      field?.idAttr,
      field?.ariaLabel
    ].filter(Boolean).join(" "));

    const semantic = FIELD_SEMANTICS.find((item) => item.keywords.some((keyword) => haystack.includes(normalizeText(keyword))))?.type || "";
    if (semantic !== "name") {
      return semantic;
    }

    // 判人名只看标签，不看 id / name 属性；标签拿不出人名的样子就不认，交给模型。
    const label = String(field?.label || field?.ariaLabel || "").trim();
    return PERSON_NAME_LABEL.test(label) && !THING_NAME_LABEL.test(label) ? semantic : "";
  }

  // Keep complete groups (including every repeated experience). Unknown or
  // cross-domain labels deliberately fall back to the full resume.
  function selectResumeCandidates(formFields, resumeFields) {
    const domains = [
      /教育|学校|院校|研究生|硕士|博士|专业|学历|学位|入学|毕业|education|school|university|major|degree|postgraduate/i,
      /工作经历|实习|任职经历|工作内容|工作单位|公司|雇主|\bwork\s+(?:history|experience)\b|\bemployment\b|\binternship\b|\bcompany\b/i,
      /项目|科研|研究经历|\bproject\b|\bresearch\b/i,
      /论文|专利|发表|publication|patent/i,
      /证书|奖励|奖项|荣誉|certificate|award/i,
      /技能|语言能力|skill|language/i,
      /基本信息|个人信息|姓名|电话|邮箱|籍贯|personal|contact/i
    ];
    const classify = (text) => domains.flatMap((pattern, i) => pattern.test(text) ? [i] : []);
    const selected = new Set();
    for (const field of formFields) {
      const context = [field.group, field.label, field.placeholder, field.name, field.ariaLabel].filter(Boolean).join(" ");
      // Eligibility/location questions are not employment-history questions.
      if (/authoriz|eligib|sponsor|visa|work\s*(?:permit|location)|career\s*plan|工作许可|工作授权|工作地点|工作计划|职业规划|求职意向|就业资格|签证/i.test(context)) return resumeFields;
      const categories = classify(context);
      if (categories.length !== 1) return resumeFields;
      const category = categories[0];
      if (!resumeFields.some(item => classify(String(item.group || "")).includes(category))) return resumeFields;
      const relevant = resumeFields.filter((item) => {
        const groups = classify(String(item.group || ""));
        // Custom groups cannot safely be ruled out.
        // Current employer/role and similar facts may live in basic info.
        return !groups.length || groups.includes(6) || groups.includes(category);
      });
      if (!relevant.length) return resumeFields;
      relevant.forEach((item) => selected.add(item));
    }
    return resumeFields.filter((item) => selected.has(item));
  }

  function buildRuleBasedMatches(formFields, resumeFields) {
    const strongTypes = new Set(["name", "email", "phone", "gender", "birth_date", "id_number", "hometown", "region"]);
    const matches = [];
    const usedResumeIndexes = new Set();

    formFields.forEach((field) => {
      const semantic = inferFieldSemantic(field);

      if (!strongTypes.has(semantic)) {
        return;
      }

      const formScope = personScope(fieldContextText(field));
      let candidates = resumeFields.map((resumeField, index) => ({ resumeField, index,
        value: semantic === 'phone' ? phoneSourceValue(resumeField) : resumeField.value })).filter(({ resumeField, index, value }) => {
        if (usedResumeIndexes.has(index)) {
          return false;
        }

        if (!isSamePersonScope(resumeField, formScope) || !isResumeFieldMatch(semantic, resumeField, field)) {
          return false;
        }

        // 语义对得上、但值这个字段收不下的（下拉里没有这个选项），不能占住位置，接着往后找。
        return isValueValidForField(field, value);
      });

      const seen = new Set();
      candidates = candidates.filter(({resumeField,value}) => {
        if (!resumeField.recordId) return true;
        const key = JSON.stringify([resumeField.groupId || resumeField.group || '',resumeField.recordId,semantic,normalizeText(value)]);
        if (seen.has(key)) return false;
        seen.add(key);return true;
      });

      const matchIndex = candidates.length === 1 ? candidates[0].index : -1;
      if (matchIndex >= 0) {
        matches.push({
          fieldId: field.fieldId,
          value: candidates[0].value,
          source: "local",
          ...(String(candidates[0].value).trim() !== String(resumeFields[matchIndex].value).trim() ? {relation:'formatted'} : {}),
          resumeKey: resumeFields[matchIndex].key,
          resumeGroup: resumeFields[matchIndex].group || "",
          resumeGroupId: resumeFields[matchIndex].groupId || "",
          resumeRecordId: resumeFields[matchIndex].recordId || "",
          resumeFieldId: resumeFields[matchIndex].fieldId || ""
        });
        usedResumeIndexes.add(matchIndex);
      }
    });

    return matches;
  }

  function filterValidMatches(formFields, matches) {
    const formFieldMap = new Map(formFields.map((field) => [field.fieldId, field]));

    return matches.filter((match) => {
      const formField = formFieldMap.get(match.fieldId);

      if (!formField) {
        return false;
      }

      return isValueValidForField(formField, match.value);
    });
  }

  function fieldContextText(field) {
    return normalizeText([
      field?.group,
      field?.label,
      field?.placeholder,
      field?.name,
      field?.idAttr,
      field?.ariaLabel
    ].filter(Boolean).join(" "));
  }

  // 紧急联系人、父亲、母亲、配偶是不同的人：本人的字段不取他们的值，他们的字段也不取本人的值。
  // 工行把紧急联系人放在「个人基本信息」分组下，只看字段语义会把本人的姓名和手机号填进去。
  // 「家庭成员」这类不知道具体是谁的，只用来挡住本人的值，本地规则不替它挑人。
  function personScope(text) {
    const source = String(text ?? "");
    const tags = [];

    // 传进来的是 normalizeText 之后的文字：小写、没有空格，英文词是连在一起的。
    if (/紧急联系|紧急联络|紧急电话|应急联系|监护人|emergencycontact|emergencyphone|guardian/.test(source)) tags.push("contact");
    if (/父亲|爸爸|father/.test(source)) tags.push("father");
    if (/母亲|妈妈|mother/.test(source)) tags.push("mother");
    if (/配偶|妻子|丈夫|爱人|spouse|wife|husband/.test(source)) tags.push("spouse");
    if (/家庭(?:主要)?成员|家属|家人|亲属|父母|兄弟|姐妹|子女|familymember|relative|sibling/.test(source)) tags.push("relative");

    return tags;
  }

  function isSamePersonScope(resumeField, formScope) {
    const resumeScope = personScope(normalizeText([resumeField?.group, resumeField?.key].filter(Boolean).join(" ")));

    if (!formScope.length && !resumeScope.length) {
      return true;
    }

    if (!formScope.length || !resumeScope.length) {
      return false;
    }

    return formScope.some((tag) => tag !== "relative" && resumeScope.includes(tag));
  }

  // 下拉框、单选框选值：先精确，再归一化，最后「包含」。
  // 网页选项和资料写法常对不上（本科 / 大学本科），只做全等会让大量下拉框填不上。
  // 「包含」只在唯一命中时采用：「博士」同时包含于「博士研究生」和「博士后」时宁可不选。
  function selectEnumTopic(field) {
    const label = normalizeText(field?.label || '');
    const education = educationFieldTopic(field);
    if (education) return education;
    if (/^(获奖级别|奖项级别|奖励级别|荣誉级别)$/.test(label)) return 'award-level';
    if (/语言|外语/.test(field?.group || '') && /^(掌握程度|精通程度|熟练程度|听说|听说能力|读写|读写能力|阅读能力|写作能力)$/.test(label)) return 'language-level';
    return '';
  }

  function selectEnumValue(value, topic) {
    if (topic === 'education' || topic === 'degree') return educationValue(value, topic) || normalizeText(value);
    if (topic === 'award-level') {
      const aliases = [['校级', '院校级', '学校级'], ['省级', '省区级'], ['国家级', '全国级']];
      const normalized = normalizeText(value);
      return aliases.find(group => group.some(alias => normalizeText(alias) === normalized))?.[0] || normalized;
    }
    return normalizeText(value);
  }

  function findSelectOptionIndex(options, value, field) {
    const list = Array.isArray(options) ? options : [];
    const target = String(value ?? "").trim();

    if (!target || !list.length) {
      return -1;
    }

    const isObject = (option) => typeof option === "object" && option !== null;
    const optionValue = (option) => String(isObject(option) ? option.value ?? "" : option ?? "").trim();
    const optionText = (option) => String(isObject(option) ? option.text ?? "" : option ?? "").trim();
    // 占位项和禁用项每一步都不算：值恰好就是「请选择」也不能当成填上了。
    const usable = list
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !isPlaceholderOption(option));
    const findUsable = (test) => usable.find(({ option }) => test(option))?.index ?? -1;

    if (field?.datePart) {
      const part = normalizeDatePart(target, field.datePart);
      if (!part) return -1;
      const matches = usable.filter(({option}) => normalizeDatePart(optionText(option) || optionValue(option), field.datePart) === part);
      return matches.length === 1 ? matches[0].index : -1;
    }

    // Enum selection uses the already grounded target. Degree-to-education
    // inference happens before this step; it is not a global option alias.
    const topic = selectEnumTopic(field);
    if (topic) {
      const exact = usable.filter(({option})=>normalizeText(optionText(option) || optionValue(option)) === normalizeText(target));
      if (exact.length) return exact.length === 1 ? exact[0].index : -1;
      const canonical = selectEnumValue(target, topic);
      // The displayed level owns the meaning. A backend code named 良好 must
      // never authorize selecting a visible 精通 option.
      const matches = usable.filter(({ option }) => {
        const caption = optionText(option) || optionValue(option);
        return caption && selectEnumValue(caption, topic) === canonical;
      });
      return matches.length === 1 ? matches[0].index : -1;
    }

    let index = findUsable((option) => optionValue(option) === target);
    if (index >= 0) return index;

    index = findUsable((option) => optionText(option) === target);
    if (index >= 0) return index;

    const normalizedTarget = normalizeText(target);
    if (!normalizedTarget) return -1;

    index = findUsable((option) => normalizeText(optionText(option)) === normalizedTarget
      || normalizeText(optionValue(option)) === normalizedTarget);
    if (index >= 0) return index;

    // 「全日制」不能落到「非全日制」，反过来也一样。
    const negatedBefore = (text, at) => /(非|不|无|未)$/.test(text.slice(0, at));
    const candidates = usable.flatMap(({ option, index: optionIndex }) => {
      const text = normalizeText(optionText(option));

      if (text.length < 2) {
        return [];
      }

      const inOption = text.indexOf(normalizedTarget);
      if (inOption >= 0) {
        return negatedBefore(text, inOption) ? [] : [optionIndex];
      }

      const inTarget = normalizedTarget.indexOf(text);
      if (inTarget >= 0) {
        return negatedBefore(normalizedTarget, inTarget) ? [] : [optionIndex];
      }

      return [];
    });

    return candidates.length === 1 ? candidates[0] : -1;
  }

  // 籍贯、高考生源地、户口所在地是三个问题，不能互相顶替；同一个问题下的省、市、县也要分清。
  function regionTopic(text) {
    if (/生源地/.test(text)) return "origin";
    if (/户口|户籍|hukou/.test(text)) return "hukou";
    if (/籍贯|nativeplace|hometown/.test(text)) return "native";
    return "";
  }

  function regionLevel(text) {
    // 「地区」「区域」里的「区」不是区县。
    const source = String(text ?? "").replace(/地区|区域/g, "");

    if (/省|自治区|province/.test(source)) return "province";
    if (/市|city/.test(source)) return "city";
    if (/县|区|county|district/.test(source)) return "county";
    return "";
  }

  function isSameRegionTopic(resumeField, formField) {
    // 两边都是先看字段自己的文字，看不出来才看分组：分组名「户籍与地区」不能把「籍贯」判成户口。
    const keyText = normalizeText(resumeField?.key);
    const keyTopic = regionTopic(keyText) || regionTopic(normalizeText(resumeField?.group));

    if (!keyTopic) {
      return false;
    }

    const ownText = normalizeText([
      formField?.label,
      formField?.placeholder,
      formField?.name,
      formField?.idAttr,
      formField?.ariaLabel
    ].filter(Boolean).join(" "));
    const groupText = normalizeText(formField?.group);

    // 「户口性质」「户籍类型」问的不是地方，只接受字段名一模一样的那一项。
    if (/性质|类型|类别/.test(ownText)) {
      return Boolean(keyText) && keyText === normalizeText(formField?.label);
    }

    const formTopic = regionTopic(ownText) || regionTopic(groupText);

    if (formTopic && formTopic !== keyTopic) {
      return false;
    }

    const keyLevel = regionLevel(keyText);
    const formLevel = regionLevel(ownText) || regionLevel(groupText);

    return !(keyLevel && formLevel && keyLevel !== formLevel);
  }

  function semanticizeParsedFields(fields) {
    const buckets = new Map();

    fields.forEach((field, index) => {
      const parsed = parseGenericKey(field.group, field.key);
      const bucketKey = parsed ? `${field.group}::${parsed.entityType}::${parsed.index}` : `raw::${index}`;

      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, { parsed, items: [] });
      }

      buckets.get(bucketKey).items.push({ ...field, sourceIndex: index });
    });

    const renamed = [];
    const seenKeys = new Map();
    const recordOccurrences = new Map();

    buckets.forEach(({ parsed, items }) => {
      const anchor = parsed ? findAnchorValue(items, parsed, parsed.groupName) : "";
      const entityLabel = parsed ? resolveEntityLabel(parsed.groupName, parsed.entityType) : "";
      const prefix = parsed ? (anchor ? `${anchor}${entityLabel}` : entityLabel) : '';
      const recordKey = JSON.stringify([parsed?.groupName, prefix]);
      const occurrence = parsed ? (recordOccurrences.get(recordKey) || 0) + 1 : 1;
      if (parsed) recordOccurrences.set(recordKey, occurrence);

      items.forEach((item) => {
        let nextKey = item.key;

        if (parsed) {
          const detail = sanitizeDetail(parsed, item.key);
          if (prefix) {
            nextKey = detail ? `${prefix}-${detail}` : prefix;
            if (occurrence > 1) nextKey += ` (${occurrence})`;
          }
        }

        nextKey = uniquifyKey(nextKey, seenKeys);
        renamed.push({
          group: item.group,
          key: nextKey,
          value: item.value
        });
      });
    });

    return renamed;
  }

  function normalizeParsedFields(payload) {
    if (!Array.isArray(payload)) {
      throw new Error("结果不是 JSON 数组。");
    }

    return semanticizeParsedFields(
      payload
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const group = String(item.group ?? "").trim();
          const key = String(item.key ?? "").trim();
          const value = String(item.value ?? "");

          if (!group || !key) {
            return null;
          }

          return { group, key, value };
        })
        .filter(Boolean)
    );
  }

  // 占位项和禁用项：「请选择」「--」这类，以及 disabled 的选项。
  function isPlaceholderOption(option) {
    const isObject = typeof option === "object" && option !== null;

    if (isObject && option.disabled) {
      return true;
    }

    const text = String(isObject ? option.text ?? "" : option ?? "").trim();
    // 单独的「选择」才算占位，「选择其他」是正经选项；英文的 Select… / Choose… 开头都算。
    return /^(请选择|请输入|please\s*(select|choose)|select\b|choose\b|--|—)|^选择$/i.test(text)
      || /^(?:年|月|日|年份|月份|YYYY|MM|DD)$/i.test(text);
  }

  function isResumeFieldMatch(semantic, resumeField, formField) {
    const keyText = normalizeText([resumeField?.group, resumeField?.key].filter(Boolean).join(" "));
    const value = String(resumeField?.value ?? "").trim();

    switch (semantic) {
      case "name":
        return keyText.includes("姓名") && !keyText.includes("拼音");
      case "email":
        return /@/.test(value) || keyText.includes("邮箱") || keyText.includes("email");
      case "phone":
        // 值像号码不算数：QQ、微信、学号都是纯数字。必须来源字段自己就写着手机/电话。
        return /(手机|电话|联系方式|mobile|phone|tel)/i.test(keyText)
          && !/(qq|微信|wechat|微博|学号|工号|身份证|证件)/i.test(keyText);
      case "gender":
        return /(男|女|male|female)/i.test(value) || keyText.includes("性别");
      case "birth_date":
        return /出生|生日|birth/.test(normalizeText(resumeField?.label || resumeField?.key));
      case "id_number":
        return /身份证|证件|idcard/i.test(keyText) || /^\d{17}[\dXx]$/.test(value.replace(/\s/g, ""));
      case "hometown":
        return isSameRegionTopic(resumeField, formField);
      case "region":
        return keyText.includes("国家") || keyText.includes("地区");
      default:
        return false;
    }
  }

  // AI 回的值和简历原文常常只差个写法（2027-06 对 2027-06-01），或者是从一句
  // 「排名前20%(绩点3.15)」里截出来的。只有完全找不到出处的才算模型编的。
  // Keep raw values intact. Grounded transformations carry a separate explanation.
  function sourceFieldLabel(field) {
    return String(field?.label || field?.key || '').split('-').at(-1).replace(/ \(\d+\)$/, '').trim();
  }

  // Format a purposeful telephone field only. Notes about somebody else, multiple
  // numbers, email addresses and account fields never become telephone evidence.
  function phoneSourceValue(field) {
    const purpose = normalizeText(sourceFieldLabel(field));
    if (!/(手机|电话|联系方式|mobile|phone|tel)/i.test(purpose)
      || /邮箱|email|qq|微信|wechat|微博|学号|工号|身份证|证件/i.test(purpose)) return '';
    const raw = String(field.value ?? '').trim();
    const mobile = raw.match(/^(?:\+?86[\s-]*)?(1[3-9]\d{9})(?:\s*[（(](?:微信同号|同微信|微信同手机)[）)])?$/);
    if (mobile) return mobile[1];
    return /^(?:\+?\d[\d -]{5,18})$/.test(raw) ? raw : '';
  }

  function educationFieldTopic(field) {
    const label = normalizeText(sourceFieldLabel(field));
    if (/^(?:(?:最高|最终|所获|获得)|(?:学士|本科|硕士|博士|大专|专科)(?:阶段)?)?学位$/.test(label)) return 'degree';
    if (/(?:学历|培养层次|教育层次|教育程度)$/.test(label) && !/学位/.test(label)) return 'education';
    return '';
  }

  function educationValue(value, topic = 'education') {
    const aliases = topic === 'degree'
      ? [['学士', '学士学位'], ['硕士', '硕士学位'], ['博士', '博士学位']]
      : [['本科', '大学本科', '本科学历'], ['硕士', '硕士研究生', '研究生（硕士）', '硕士研究生学历'],
        ['博士', '博士研究生', '研究生（博士）', '博士研究生学历'], ['大专', '专科', '大学专科'], ['高中'], ['中专']];
    const normalized = normalizeText(value);
    const direct = aliases.find(group => group.some(alias => normalizeText(alias) === normalized))?.[0];
    if (direct) return direct;
    if (topic === 'degree') {
      // 学科名称 qualifies the degree; honorary degrees and study status do not.
      return normalized.match(/^(?:(?:哲学|经济学|法学|教育学|文学|历史学|理学|工学|农学|医学|军事学|管理学|艺术学|交叉学科))?(学士|硕士|博士)(?:学位)?$/)?.[1] || '';
    }
    return '';
  }

  function educationFact(source, topic = 'education') {
    const purpose = educationFieldTopic(source), raw = String(source?.value ?? '').trim();
    if (!purpose || !raw) return null;
    const direct = purpose === topic && educationValue(raw, topic);
    if (direct) return {value:direct,relation:raw === direct ? 'exact' : 'equivalent'};
    // A degree explicitly stored in 学历 may be corrected there. A separate 学位
    // proves a level only within its own education record, never a global person field.
    if (topic !== 'education' || (purpose === 'degree' && (!source.recordId || !/教育/.test(source.group || '')))) return null;
    const degree = educationValue(raw, 'degree');
    const value = ({学士:'本科',硕士:'硕士',博士:'博士'})[degree];
    return value ? {value,relation:'inferred',inference:{rule:'degree-to-education',inputLabel:sourceFieldLabel(source),inputValue:raw,targetValue:value}} : null;
  }

  // Duplicate copies inside one record are one factual candidate. Different
  // records, unknown records and different field purposes remain distinct.
  function distinctSources(fields, topic = '') {
    const seen = new Set();
    return fields.filter(field => {
      if (!field.recordId) return true;
      const purpose = topic || educationFieldTopic(field) || normalizeText(sourceFieldLabel(field));
      const value = topic === 'phone' ? normalizeText(phoneSourceValue(field))
        : topic === 'education' || topic === 'degree' ? educationFact(field,topic)?.value || normalizeText(field.value)
        : topic ? selectEnumValue(field.value, topic) : normalizeText(field.value);
      const id = JSON.stringify([field.groupId || field.group || '',field.recordId,purpose,value]);
      if (seen.has(id)) return false;
      seen.add(id);return true;
    });
  }

  function findResumeSource(value, resumeFields, formField) {
    const target = String(value ?? "").trim();
    const fields = Array.isArray(resumeFields) ? resumeFields : [];
    if (!target) {
      return { relation: "none", field: null, keys: [] };
    }

    // A split year/month is an extraction from a date, never a substring of a
    // telephone, description or the opposite endpoint's date.
    if (formField?.datePart) {
      const part = normalizeDatePart(target, formField.datePart);
      const birthday = inferFieldSemantic(formField) === 'birth_date';
      const scope = birthday ? personScope(fieldContextText(formField)) : '';
      const candidates = part ? distinctSources(fields.filter(source => (!birthday || isSamePersonScope(source,scope)) && dateSourceMatches(formField, source)
        && datePartValue(source.dateSourceValue || source.value, formField.datePart) === part)) : [];
      if (!candidates.length) return {relation:'none',field:null,keys:[]};
      return {relation:'date-part',field:candidates[0],keys:candidates.map(source=>source.key),ambiguous:candidates.length>1};
    }

    if (formField && inferFieldSemantic(formField) === 'phone') {
      const scope = personScope(fieldContextText(formField));
      const candidates = distinctSources(fields.filter(field => isSamePersonScope(field, scope) && phoneSourceValue(field) === target),'phone');
      if (!candidates.length) return {relation:'none',field:null,keys:[]};
      return {relation:String(candidates[0].value).trim() === target ? 'exact' : 'formatted',
        field:candidates[0],keys:candidates.map(field=>field.key),ambiguous:candidates.length>1};
    }

    const topic = formField && educationFieldTopic(formField);
    if (topic) {
      const canonical = educationValue(target, topic) || (topic === 'education' ? ({学士:'本科',硕士:'硕士',博士:'博士'})[educationValue(target,'degree')] : '');
      // Never use substring matching for education enums (博士后 != 博士, 研究生 != 硕士).
      let candidates = canonical ? fields.filter(field => educationFact(field,topic)?.value === canonical) : [];
      const explicit = candidates.filter(field => educationFact(field,topic).relation !== 'inferred');
      if (explicit.length) candidates = explicit;
      candidates = distinctSources(candidates,topic);
      if (!candidates.length) return { relation: 'none', field: null, keys: [] };
      const fact = educationFact(candidates[0],topic);
      return { relation: fact.relation === 'inferred' ? 'inferred' : String(candidates[0].value).trim() === target ? 'exact' : 'equivalent',
        ...(fact.inference ? {inference:fact.inference} : {}),standardValue:canonical,
        field: candidates[0], keys: candidates.map(field => field.key), ambiguous: candidates.length > 1 };
    }

    const enumTopic = formField && selectEnumTopic(formField);
    if (enumTopic === 'award-level') {
      const candidates = distinctSources(fields.filter(field => selectEnumTopic({label:sourceFieldLabel(field)}) === enumTopic
        && selectEnumValue(field.value,enumTopic) === selectEnumValue(target,enumTopic)),enumTopic);
      if (!candidates.length) return {relation:'none',field:null,keys:[]};
      return {relation:String(candidates[0].value).trim() === target ? 'exact' : 'equivalent',
        field:candidates[0],keys:candidates.map(field=>field.key),ambiguous:candidates.length>1};
    }

    const exact = distinctSources(fields.filter((field) => String(field.value ?? "").trim() === target));
    if (exact.length) {
      return { relation: "exact", field: exact[0], keys: exact.map((field) => field.key), ambiguous: exact.length > 1 };
    }

    const parts = (raw) => parseDateParts(String(raw).trim());
    // parseDateParts 给的是字符串，「2000年1月5日」是 1/5、「2000-01-05」是 01/05，
    // 必须按数值比，否则同一个日子会被判成对不上。
    const num = (value) => (value == null ? null : Number(value));
    const sameMonth = (left, right) => {
      const a = parts(left);
      const b = parts(right);
      if (!a?.year || !b?.year || a.year !== b.year || num(a.month) !== num(b.month)) {
        return false;
      }
      return !a.day || !b.day || num(a.day) === num(b.day);
    };
    const dated = distinctSources(fields.filter((field) => sameMonth(field.value, target)));
    if (dated.length) {
      return { relation: "date", field: dated[0], keys: dated.map(field => field.key), ambiguous: dated.length > 1 };
    }

    const squashedTarget = normalizeText(target);
    if (squashedTarget.length >= 2) {
      const cuts = distinctSources(fields.filter((field) => normalizeText(field.value).includes(squashedTarget)));
      if (cuts.length) {
        return { relation: "partial", field: cuts[0], keys: cuts.map(field => field.key), ambiguous: cuts.length > 1 };
      }

      const rewritten = fields.find((field) => sharesOpening(normalizeText(field.value), squashedTarget));
      if (rewritten) {
        return { relation: "rewritten", field: rewritten, keys: [rewritten.key] };
      }
    }

    return composedSource(target, fields) || { relation: "none", field: null, keys: [] };
  }

  // 模型把同一条经历的两段原文（内容概述＋主要工作）拼成一段描述时，整段不再是任何字段值的子串，
  // 按值回查会判成「编造」。逐句回查：每一句都有出处才算可验证，夹一句编造的仍然判 none。
  function composedSource(target, fields, strict = false) {
    // 门槛 6 字：模型拼描述时的连接词一般不超过 5 字（在该项目中、综上、此外），
    // 而 7 个字的编造短句若被忽略就等于放行。
    const pieces = String(target)
      .split(/[。；;！!？?\n]+/)
      .map((sentence) => normalizeText(sentence))
      .filter(Boolean);
    const connectors = /^(在该项目中|此外|同时|综上|其中)$/;
    const sentences = strict ? pieces.filter(sentence => !connectors.test(sentence)) : pieces.filter(sentence => sentence.length >= 6);
    if (sentences.length < 2) {
      return null;
    }

    const contributors = [];
    const keys = [];
    for (const sentence of sentences) {
      const field = fields.find((item) => normalizeText(item.value).includes(sentence))
        || (!strict && fields.find((item) => sharesOpening(normalizeText(item.value), sentence)));
      if (!field) {
        return null;
      }
      contributors.push(field);
      if (!keys.includes(field.key)) {
        keys.push(field.key);
      }
    }

    // 单字段就能覆盖整段的情况前面已经被 partial/rewritten 接住；跨经历拼贴不算可验证。
    if (keys.length < 2) return null;
    const records = new Set(contributors.map((field) => field.recordId).filter(Boolean));
    if (records.size > 1) return null;
    if (strict && (records.size !== 1 || contributors.some(field => !field.recordId)
      || new Set(contributors.map(field => field.groupId || field.group || '')).size !== 1)) return null;
    return { relation: "composed", field: contributors[0], keys, fieldIds: [...new Set(contributors.map(field => field.fieldId))] };
  }

  // 长文本被模型截短或改写过之后就不是子串了，但开头一大段还是同一段话。
  // 门槛取 24 个字符：两个都以「基于」开头的东西不该被认成一回事。
  function sharesOpening(left, right) {
    const limit = Math.min(left.length, right.length);
    if (limit < 8) {
      return false;
    }

    let shared = 0;
    while (shared < limit && left[shared] === right[shared]) {
      shared += 1;
    }

    return shared >= 24 || shared === limit;
  }

  function isValueValidForField(field, value) {
    const text = String(value ?? "").trim();
    const semantic = inferFieldSemantic(field);
    if (/区号|国家代码|calling.?code|dial.?code|country.?code/i.test([field?.label,field?.ariaLabel].filter(Boolean).join(' '))) return /^\+?\d{1,4}$/.test(text);

    if (!text) {
      return false;
    }
    if (field?.datePart) {
      return Boolean(normalizeDatePart(text,field.datePart)) && (!Array.isArray(field.options)
        || field.optionsComplete === false
        || !field.options.some(option=>!isPlaceholderOption(option))
        || findSelectOptionIndex(field.options,text,field)>=0);
    }
    if (field?.inputType === 'checkbox') return checkboxState(value, field.label) !== null;

    // 只有「请选择」、选项还没加载出来的下拉框（没被识别成联动组的下一级）这里不判，
    // 交给页面填写时等选项出来再选；否则值在这里就被丢掉，页面上的重试拿不到东西。
    const hasRealOptions = Array.isArray(field?.options)
      && field.options.some((option) => !isPlaceholderOption(option) && String(typeof option === "object" && option !== null ? option.text ?? "" : option ?? "").trim());

    if ((field?.inputType === "select" || field?.inputType === "radio") && hasRealOptions && field?.cascadeGroup === undefined) {
      // 和网页上实际选值用同一套规则，否则页面能选上的值会先在这里被丢掉。
      if (findSelectOptionIndex(field.options, text, field) < 0) {
        return false;
      }
    }

    switch (semantic) {
      case "pinyin":
        return /^[A-Za-z\s]+$/.test(text);
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
      case "phone":
        return /^[+\d][\d\s-]{6,}$/.test(text);
      case "birth_date":
        return /(\d{4}[-/.年]\d{1,2}([-/.\月]\d{1,2}日?)?)/.test(text);
      case "gender":
        return /(男|女|male|female)/i.test(text);
      case "id_number":
        return /^[0-9xX]{8,18}$/.test(text.replace(/\s/g, ""));
      case "name":
        return text.length <= 20 && !/@/.test(text) && !/\d{5,}/.test(text);
      case "hometown":
        return !/(硕|博|学位|专业|邮箱|电话|手机)/.test(text);
      default:
        return true;
    }
  }

  function checkboxState(value, label = '') {
    const text = normalizeText(value);
    if (/^(?:true|1|是|已勾选|勾选|选中)$/.test(text)) return true;
    if (/^(?:false|0|否|未勾选|不选|未选中)$/.test(text)) return false;
    if (text && text === normalizeText(label) && /^(?:至今|在职|在读|没有(?:工作|实习)经历|无(?:工作|实习)经历)$/.test(text)) return true;
    return null;
  }

  function parseGenericKey(groupName, key) {
    const match = String(key ?? "").trim().match(GENERIC_ENTITY_PATTERN);

    if (!match) {
      return null;
    }

    return {
      groupName,
      entityType: match[1],
      index: match[2],
      detail: match[3]
    };
  }

  function findAnchorValue(items, parsed, groupName) {
    const preferredKeywords = resolveAnchorKeywords(groupName, parsed.entityType);
    const preferredField = items.find((item) => preferredKeywords.some((keyword) => normalizeText(item.key).includes(normalizeText(keyword))) && item.value);

    if (preferredField) {
      return sanitizeAnchor(preferredField.value);
    }

    const fallbackField = items.find((item) => item.value);
    return fallbackField ? sanitizeAnchor(fallbackField.value) : "";
  }

  function resolveAnchorKeywords(groupName, entityType) {
    if (/教育/.test(groupName)) {
      return ["学校", "院校", "大学", "学院"];
    }

    if (/实习|工作/.test(groupName)) {
      return ["公司", "单位", "组织", "机构"];
    }

    if (/科研/.test(groupName)) {
      return ["课题", "实验室", "项目", "单位"];
    }

    if (/校园|在校|校内职务|社团经历|社会实践/.test(groupName)) {
      return ["组织", "社团", "部门", "单位"];
    }

    if (/项目/.test(groupName)) {
      return ["项目", "名称", "标题"];
    }

    if (/论文|专利|证书|奖励|获奖|荣誉|考试/.test(groupName)) {
      return ["标题", "名称", "奖项"];
    }

    return ["名称", "标题", "公司", "学校", "单位"];
  }

  function resolveEntityLabel(groupName, entityType) {
    return ENTITY_LABEL_BY_GROUP.find((item) => item.pattern.test(groupName))?.label || `${entityType}信息`;
  }

  function sanitizeDetail(parsed, originalKey) {
    return String(originalKey)
      .replace(GENERIC_ENTITY_PATTERN, "$3")
      .replace(/^(公司名|公司|单位|学校|院校|大学|学院|岗位名称|岗位|职位名称|职位|项目名称|项目|论文标题|标题|名称)/, (match) => match)
      .replace(/^[\s\-_:：]+/, "")
      .trim();
  }

  function sanitizeAnchor(value) {
    return String(value ?? "")
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);
  }

  function uniquifyKey(key, seenKeys) {
    const base = key || "未命名字段";
    const count = seenKeys.get(base) || 0;
    seenKeys.set(base, count + 1);
    return count ? `${base} (${count + 1})` : base;
  }

  // Canonicalize a component without inventing any missing date part.
  function normalizeDatePart(value, part) {
    const suffix = part === 'year' ? '年' : part === 'month' ? '月' : part === 'day' ? '日' : '';
    if (!suffix) return '';
    const match = String(value ?? '').trim().match(new RegExp('^(\\d{' + (part === 'year' ? '4' : '1,2') + '})\\s*' + suffix + '?$'));
    if (!match) return '';
    const number = Number(match[1]);
    if (part === 'year') return number >= 1000 && number <= 9999 ? String(number) : '';
    return number >= 1 && number <= (part === 'month' ? 12 : 31) ? pad2(number) : '';
  }

  function datePartValue(value, part) {
    const parts = parseDateParts(String(value ?? '').trim());
    if (!parts) return part === 'year' ? normalizeDatePart(value,part) : '';
    if (!normalizeDatePart(parts.year,'year') || !normalizeDatePart(parts.month,'month')) return '';
    if (parts.day) {
      const day = Number(parts.day), limit = new Date(Number(parts.year),Number(parts.month),0).getDate();
      if (day < 1 || day > limit) return '';
    }
    return normalizeDatePart(parts[part],part);
  }

  function dateSourceMatches(field, source) {
    if(field?.dateRangeUnresolved)return false;
    const purpose = sourceFieldLabel(source), label = field?.label || '';
    if (field?.rangeRole === 'start' || /开始|入学|起始/.test(label)) return /开始|入学|起始/.test(purpose);
    if (field?.rangeRole === 'end' || /结束|毕业|截止/.test(label)) return /结束|毕业|截止/.test(purpose);
    if (/获奖|颁奖/.test(label)) return /获奖时间|获奖日期|颁奖/.test(purpose);
    if (/出生|生日/.test(label)) return /出生|生日/.test(purpose);
    return /时间|日期|年月/.test(label) && /时间|日期|年月/.test(purpose);
  }

  // 页面的日期精度和简历里写的精度不一定一样。目标是天、简历只到月时补 01 并标记，
  // 交给调用方在对照表里说清楚「按 1 号填」；目标精度不明时原样写，不替用户改写法。
  function normalizeDateForPrecision(rawValue, precision) {
    const raw = String(rawValue ?? "").trim();
    const parts = parseDateParts(raw);

    // 解析不出年月（比如只写了「2024」或「至今」）就原样写，不替用户改写法。
    if (!parts?.year || !parts.month || precision === "auto") {
      return { value: raw, precision: "auto", padded: false };
    }

    if (precision === "month") {
      return { value: `${parts.year}-${pad2(parts.month)}`, precision: "month", padded: false };
    }

    if (precision === "day") {
      return {
        value: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day || "01")}`,
        precision: "day",
        padded: !parts.day
      };
    }

    return { value: raw, precision: "auto", padded: false };
  }

  function normalizeDateValue(rawValue, inputType) {
    const raw = String(rawValue ?? "").trim();

    const parsed = parseDateParts(raw);

    if (!parsed) {
      return raw;
    }

    const { year, month, day, hour, minute } = parsed;

    switch (inputType) {
      case "date":
        if (!year || !month || !day) return raw;
        return `${year}-${pad2(month)}-${pad2(day)}`;
      case "month":
        if (!year || !month) return raw;
        return `${year}-${pad2(month)}`;
      case "time":
        if (hour === null || minute === null) return raw;
        return `${pad2(hour)}:${pad2(minute)}`;
      case "datetime-local":
        if (!year || !month || !day) return raw;
        return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour ?? 0)}:${pad2(minute ?? 0)}`;
      default:
        return raw;
    }
  }

  function parseDateParts(raw) {
    if (/(19|20)\d{2}.+(19|20)\d{2}/.test(raw)) return null;

    const chineseMatch = raw.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (chineseMatch) {
      return {
        year: chineseMatch[1],
        month: chineseMatch[2],
        day: chineseMatch[3] || null,
        hour: chineseMatch[4] != null ? chineseMatch[4] : null,
        minute: chineseMatch[5] != null ? chineseMatch[5] : null
      };
    }

    const separatorMatch = raw.match(/^(\d{4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,2})(?!\d))?(?:[T\s](\d{1,2}):(\d{1,2}))?/);
    if (separatorMatch) {
      return {
        year: separatorMatch[1],
        month: separatorMatch[2],
        day: separatorMatch[3] || null,
        hour: separatorMatch[4] != null ? separatorMatch[4] : null,
        minute: separatorMatch[5] != null ? separatorMatch[5] : null
      };
    }

    const timeMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      return {
        year: null,
        month: null,
        day: null,
        hour: timeMatch[1],
        minute: timeMatch[2]
      };
    }

    return null;
  }

  // 资料树里有些事实不是以「可直接比对的值」存的：起止时间写成一条区间串（硕士时间 = 2024.9.1-2027.6.1），
  // 奖项名只存在于记录名/键前缀里（「研究生学业奖学金一等奖-获奖时间」）。findResumeSource 只按值回查，
  // 这两种形状会被判成「编造」再被 guard 拦掉——值其实就在资料里。发送前补出等价字段，不动存储。
  const MAX_SYNTHETIC_FIELDS = 60;

  function splitDateRange(value) {
    const raw = String(value ?? "").trim();
    if (!/(19|20)\d{2}/.test(raw)) return null;
    const halves = raw.split(/\s*(?:-|–|—|~|至|到)\s*/);
    if (halves.length !== 2) return null;
    const [start, end] = halves.map((half) => parseDateParts(half.trim()));
    if (!start?.year || !start.month || !end?.year || !end.month) return null;
    return [`${start.year}-${Number(start.month)}`, `${end.year}-${Number(end.month)}`];
  }

  function expandResumeFields(fields) {
    const original = Array.isArray(fields) ? fields : [];
    const identity = field => JSON.stringify([field.groupId || field.group || '', field.recordId]);
    const educationPrefix = field => /教育/.test(field.group || '')
      ? String(field.key || '').match(/^(硕士|博士|学士|本科|大专|专科)(?:学校|院校|专业|时间|学历|学位|入学|毕业|主修课程|研究方向)/)?.[1] : '';
    const legacyEducation = new Map();
    for (const field of original) {
      const prefix = educationPrefix(field);
      if (!prefix || !field.recordId || !/^(待归类资料|基本资料)$/.test(field.recordName || '')) continue;
      const record = identity(field), stages = legacyEducation.get(record) || new Set();
      stages.add(prefix);legacyEducation.set(record,stages);
    }
    // Older trees merged masters/bachelors into one unclassified record. Split
    // their observation identities while preserving stored IDs, keys and values.
    // Prefixes separate legacy stages. A level conversion still requires an
    // explicit 学历/学位 value in that stage; the prefix alone is not a new fact.
    const list = original.map(field => {
      const prefix = educationPrefix(field);
      return prefix && legacyEducation.get(identity(field))?.size > 1
        ? {...field,recordId:`${field.recordId}:education:${prefix}`,recordName:`${prefix}阶段`} : field;
    });
    const added = [];
    const awardRecords = new Set(list.filter(f => /奖励|获奖/.test(f?.group || "") && /获奖名称|奖项名称|奖励名称/.test(f?.key || "") && String(f?.value || "").trim()).map(f => f.recordId || f.key));

    for (const field of list) {
      if (added.length >= MAX_SYNTHETIC_FIELDS) break;
      const key = String(field?.key ?? "").trim();
      const value = String(field?.value ?? "").trim();

      if (/时间$/.test(key) && !/开始|结束/.test(key)) {
        const range = splitDateRange(value);
        if (range) {
          const precise = value.split(/\s*(?:-|–|—|~|至|到)\s*/).map(part => normalizeDateForPrecision(part, 'day'));
          const dateEvidence = index => precise[index]?.precision === 'day' && !precise[index].padded
            ? {dateSourceValue:precise[index].value} : {};
          // 键里带「开始/结束」是 guard 的日期键检查要求的（见 guardResumeSources）。
          added.push(
            { ...field, key: `${key}-开始时间`, value: range[0], fieldId: `syn-${field.fieldId || key}-start`, synthetic: true, ...dateEvidence(0) },
            { ...field, key: `${key}-结束时间`, value: range[1], fieldId: `syn-${field.fieldId || key}-end`, synthetic: true, ...dateEvidence(1) }
          );
        }
      }

      const recordKey = field?.recordId || key;
      const legacyAward = key.match(/^(.+)-获奖时间(?: \((\d+)\))?$/);
      const recordName = String(field?.recordName || '');
      // The old parser added (2)/(3) to keys and display titles, never to the award's factual name.
      const awardName = legacyAward && (recordName === legacyAward[1] || recordName === `${legacyAward[1]} (${legacyAward[2]})`) ? legacyAward[1] : '';
      if (/奖励|获奖/.test(field?.group || "") && awardName && !/^(?:获奖|奖励|获奖经历)\s*\d+$|^(?:基本资料|待归类资料|新建经历|未命名经历)$/.test(awardName) && !awardRecords.has(recordKey)) {
        awardRecords.add(recordKey);
        added.push({ ...field, key: `${awardName}-获奖名称`, label: '获奖名称', value: awardName, fieldId: `syn-${recordKey}-name`, synthetic: true });
      }
    }

    // Legacy campus paragraphs can contain an explicit role that was omitted from
    // an otherwise structured record. Link by the exact organization, never by
    // row order or a duty mentioned later in the paragraph. Storage stays intact.
    const campusFields = list.filter(field => /校园|在校|校内|社团|学生工作|社会实践/.test(field.group || ''));
    const organizations = campusFields.filter(field => field.fieldId && field.recordId
      && /^(活动名称|组织名称|社团名称|学生组织)$/.test(sourceFieldLabel(field)) && String(field.value || '').trim());
    const legacy = campusFields.filter(field => field.fieldId && /^(?:校园|校园经历|在校经历|在校职务|校内职务|社团经历|社会实践)\d+$/.test(field.key || ''));
    const roleLabel = /^(职位|职位名称|职务|职务名称|担任职务|项目角色|担任角色)$/;
    const roleText = /^(?:干事|会长|副会长|部长|副部长|主席|副主席|队长|负责人|成员|志愿者|秘书长|理事)$/;
    const handled = new Set();
    for (const organization of organizations) {
      if (added.length >= MAX_SYNTHETIC_FIELDS) break;
      const record = identity(organization), name = String(organization.value).trim();
      if (handled.has(record)) continue;
      handled.add(record);
      const names = organizations.filter(field => identity(field) === record);
      if (names.length !== 1 || organizations.some(field => identity(field) !== record && String(field.value).trim() === name)
        || campusFields.some(field => identity(field) === record && roleLabel.test(sourceFieldLabel(field)) && String(field.value || '').trim())) continue;
      const candidates = legacy.flatMap(field => {
        if ((field.groupId || field.group) !== (organization.groupId || organization.group)) return [];
        const raw = String(field.value || '').trim();
        const mentions = organizations.filter(other => raw.includes(String(other.value).trim()));
        if (mentions.length !== 1 || mentions[0] !== organization) return [];
        const first = raw.split(/[，,；;。\n]/)[0].trim();
        if (!first.startsWith(name)) return [];
        const role = first.slice(name.length).trim();
        return roleText.test(role) ? [{field,role}] : [];
      });
      if (candidates.length !== 1) continue;
      const {field,role} = candidates[0];
      const fieldId = `syn-${organization.recordId}-role`;
      if (list.some(item => item.fieldId === fieldId) || added.some(item => item.fieldId === fieldId)) continue;
      added.push({...organization,key:`${organization.recordName || name}-职位`,label:'职位',value:role,
        fieldId,synthetic:true,derivedFrom:[field.fieldId,organization.fieldId]});
    }

    return added.length ? [...list, ...added.slice(0, MAX_SYNTHETIC_FIELDS)] : list;
  }

  function pad2(value) {
    return String(Number(value)).padStart(2, "0");
  }
})(typeof self !== "undefined" ? self : globalThis);
