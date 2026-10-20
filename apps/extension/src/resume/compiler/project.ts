import type {
  NormalizedResume,
  ProjectDerivation,
  ProjectEntry,
  Projections,
  ProjectProjection,
} from '@/shared/contracts/resume';

const INTRO_SHORT_LIMIT = 50;
const ONE_LINER_LIMIT = 50;
const SUMMARY_LIMIT = 150;

const METRIC_PATTERN =
  /\d+(?:\.\d+)?\s*(?:%|％|万|亿|千|百|人|次|个|项|天|小时|分钟|秒|毫秒|元|ms|s|MB|GB|TB|倍|条|篇|家|所|分|台|套|款|张|页|QPS|TPS)/i;
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
const OUTCOME_PATTERN = /(提升|降低|减少|增长|提高|优化|节省|缩短|达成|上线|交付|发布|获奖|排名|覆盖|支撑|服务|累计|完成|通过率|准确率|转化率|性能)/;
const RESPONSIBILITY_PATTERN = /(负责|主导|设计|实现|开发|搭建|维护|参与|推动|编写|构建|管理|协调|调研|测试|部署|重构)/;
const TECHNICAL_PATTERN =
  /(架构|算法|模型|框架|引擎|流水线|微服务|前端|后端|数据库|中间件|可视化|React|Vue|TypeScript|JavaScript|Node\.?js|Python|Java|Go|Docker|Kubernetes|CI\/CD|GraphQL|REST|Webpack|Vite|LLM|RAG)/i;

interface SentencePart {
  text: string;
  factPath: string;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function classify(sentence: string): ProjectDerivation['field'] {
  if (METRIC_PATTERN.test(sentence) || OUTCOME_PATTERN.test(sentence)) {
    return 'outcomes';
  }
  if (TECHNICAL_PATTERN.test(sentence) && !RESPONSIBILITY_PATTERN.test(sentence)) {
    return 'technicalMethods';
  }
  if (RESPONSIBILITY_PATTERN.test(sentence)) {
    return 'responsibilities';
  }
  return 'background';
}

function joinLimited(parts: string[], maxLength: number, separator = '；'): string {
  const joined = parts.filter((part) => part.trim() !== '').join(separator);
  if (joined.length <= maxLength) {
    return joined;
  }
  const boundary = Math.max(
    joined.lastIndexOf('；', maxLength),
    joined.lastIndexOf('。', maxLength),
    joined.lastIndexOf('，', maxLength),
    joined.lastIndexOf(',', maxLength),
    joined.lastIndexOf(' ', maxLength),
  );
  if (boundary > maxLength * 0.5) {
    return joined.slice(0, boundary);
  }
  return joined.slice(0, maxLength);
}

function uniqueParts(parts: SentencePart[]): SentencePart[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    if (part.text === '' || seen.has(part.text)) return false;
    seen.add(part.text);
    return true;
  });
}

function sentencesWithFact(text: string | undefined, factPath: string): SentencePart[] {
  if (text === undefined) return [];
  return splitSentences(text).map((sentence) => ({ text: sentence, factPath }));
}

function numericTokens(text: string): string[] {
  return text.match(NUMBER_PATTERN) ?? [];
}

function consistencyOf(
  projection: ProjectProjection,
  entry: ProjectEntry,
  sourceText: string,
  sourceFactPaths: string[],
): ProjectProjection['consistency'] {
  const issues: string[] = [];
  const known = new Set(numericTokens(sourceText));
  const derivedFields: Array<[string, string]> = [
    ['one_liner', projection.one_liner],
    ['summary_150', projection.summary_150],
    ['responsibilities', projection.responsibilities],
    ['outcomes', projection.outcomes],
    ['full_description', projection.full_description],
  ];
  for (const [field, text] of derivedFields) {
    for (const token of numericTokens(text)) {
      if (!known.has(token)) {
        issues.push(`${field} 中的数值 ${token} 未出现在项目「${entry.name}」的来源事实中`);
      }
    }
  }
  for (const derivation of projection.derivations ?? []) {
    if (!sourceFactPaths.includes(derivation.factPath)) {
      issues.push(`${derivation.field} 引用了未确认来源 ${derivation.factPath}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function projectionForEntry(entry: ProjectEntry, index: number): ProjectProjection {
  const prefix = `projects[${index}]`;
  const sourceFactPaths: string[] = [];
  const used = (key: keyof ProjectEntry): string => {
    const path = `${prefix}.${String(key)}`;
    if (!sourceFactPaths.includes(path)) sourceFactPaths.push(path);
    return path;
  };

  const backgroundParts: SentencePart[] = [];
  const responsibilityParts: SentencePart[] = [];
  const technicalParts: SentencePart[] = [];
  const outcomeParts: SentencePart[] = [];

  if (entry.description !== undefined) {
    const path = used('description');
    for (const sentence of splitSentences(entry.description)) {
      const target =
        classify(sentence) === 'outcomes'
          ? outcomeParts
          : classify(sentence) === 'technicalMethods'
            ? technicalParts
            : classify(sentence) === 'responsibilities'
              ? responsibilityParts
              : backgroundParts;
      target.push({ text: sentence, factPath: path });
    }
  }
  if (entry.responsibilities !== undefined) {
    const path = used('responsibilities');
    responsibilityParts.push(...sentencesWithFact(entry.responsibilities, path));
  }
  if (entry.outcomes !== undefined) {
    const path = used('outcomes');
    outcomeParts.push(...sentencesWithFact(entry.outcomes, path));
  }
  if (entry.role !== undefined) used('role');
  if (entry.name !== undefined) used('name');
  if (entry.keywords !== undefined) used('keywords');
  if (entry.startDate !== undefined) used('startDate');
  if (entry.endDate !== undefined) used('endDate');

  const background = uniqueParts(backgroundParts);
  const responsibilities = uniqueParts(responsibilityParts);
  const technical = uniqueParts(technicalParts);
  const outcomes = uniqueParts(outcomeParts);

  const fullBackground = background.length > 0
    ? background.map((part) => part.text).join('；')
    : [entry.name, entry.role].filter((part) => part !== undefined && part !== '').join(' · ');
  const backgroundText = joinLimited(fullBackground === '' ? [] : [fullBackground], 120, '；');
  const fullResponsibilities = responsibilities.length > 0
    ? responsibilities.map((part) => part.text).join('；')
    : (entry.role ?? '');
  const responsibilitiesText = joinLimited(fullResponsibilities === '' ? [] : [fullResponsibilities], 200, '；');
  const fullTechnical = technical.map((part) => part.text).join('；');
  const technicalText = joinLimited(fullTechnical === '' ? [] : [fullTechnical], 160, '；');
  const fullOutcomes = outcomes.map((part) => part.text).join('；');
  const outcomesText = joinLimited(fullOutcomes === '' ? [] : [fullOutcomes], 160, '；');

  const oneLiner = joinLimited(
    [
      [entry.name, entry.role].filter((part) => part !== undefined && part !== '').join(' · '),
      outcomes[0]?.text ?? background[0]?.text ?? '',
    ].filter((part) => part !== ''),
    ONE_LINER_LIMIT,
  );
  const summary = joinLimited(
    [backgroundText, responsibilitiesText, outcomesText].filter((part) => part !== ''),
    SUMMARY_LIMIT,
    '；',
  );

  const sections: string[] = [];
  if (fullBackground !== '') sections.push(`项目背景：${fullBackground}`);
  if (fullResponsibilities !== '') sections.push(`职责：${fullResponsibilities}`);
  if (fullTechnical !== '') sections.push(`技术方法：${fullTechnical}`);
  if (fullOutcomes !== '') sections.push(`成果：${fullOutcomes}`);
  const fullDescription =
    sections.length > 0
      ? sections.join('\n')
      : [entry.name, entry.description].filter((part) => part !== undefined && part !== '').join('：');

  const derivations: ProjectDerivation[] = [];
  const appendDerivation = (field: ProjectDerivation['field'], parts: SentencePart[], text: string): void => {
    if (text === '' || parts.length === 0) return;
    const factPath = parts[0]?.factPath ?? sourceFactPaths[0] ?? `${prefix}.description`;
    derivations.push({ field, text, factPath });
  };
  appendDerivation('background', background, backgroundText);
  appendDerivation('responsibilities', responsibilities, responsibilitiesText);
  appendDerivation('technicalMethods', technical, technicalText);
  appendDerivation('outcomes', outcomes, outcomesText);

  const sourceText = [
    entry.description,
    entry.responsibilities,
    entry.outcomes,
    entry.role,
    entry.name,
    ...(entry.keywords ?? []),
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join('；');

  const projection: ProjectProjection = {
    resumeEntryId: entry.id,
    title: entry.name,
    one_liner: oneLiner,
    summary_150: summary,
    responsibilities: responsibilitiesText,
    outcomes: outcomesText,
    full_description: fullDescription,
    ...(backgroundText !== '' ? { background: backgroundText } : {}),
    ...(technicalText !== '' ? { technicalMethods: technicalText } : {}),
    keywords: [...(entry.keywords ?? [])],
    sourceFactPaths,
    derivations,
  };
  projection.consistency = consistencyOf(projection, entry, sourceText, sourceFactPaths);
  return projection;
}

export function buildProjections(normalized: NormalizedResume): Projections {
  const projections: Projections = {};
  const intro = normalized.basic.intro?.trim();
  if (intro !== undefined && intro !== '') {
    projections.introShort = joinLimited(splitSentences(intro), INTRO_SHORT_LIMIT);
  }
  projections.projects = normalized.projects.map((entry, index) => projectionForEntry(entry, index));
  return projections;
}
