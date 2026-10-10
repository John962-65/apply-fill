/* Date precision from page evidence only. Never infers from the resume value. */
(function (root) {
  'use strict';
  // 与 content.js 的 DATE_DAY_HINT/DATE_MONTH_HINT 同词表；此处只用于解释页面写法，不回填简历。
  const DAY_HINT = /(yyyy|年)\s*[-/.年]?\s*(mm|月)\s*[-/.月]?\s*(dd|日)|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/i;
  const MONTH_HINT = /(yyyy|年)\s*[-/.年]?\s*(mm|月)(?!\s*[-/.月]?\s*(dd|日))|\d{4}[-/.]\d{1,2}$|\d{4}年\d{1,2}月$/i;
  const YEAR_HINT = /^yyyy$/i;

  // 页面已显示值的形态（提交行为证据 / 当前值形态证据）。只认完整格式，不猜。
  function precisionOfValue(text) {
    const s = String(text ?? '').trim();
    if (/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?$/.test(s)) return 'day';
    if (/^\d{4}[-/.年]\d{1,2}月?$/.test(s)) return 'month';
    if (/^\d{4}\s*年?$/.test(s)) return 'year';
    return null;
  }

  // 静态控件证据：控件类型与页面写法（placeholder）。鸭子类型，便于无 DOM 测试。
  function staticEvidence(element) {
    const type = String(element?.type || '').toLowerCase();
    if (type === 'date' || type === 'datetime-local') return { precision: 'day', source: '控件类型 type=' + type, weight: 'strong' };
    if (type === 'month') return { precision: 'month', source: '控件类型 type=month', weight: 'strong' };
    const placeholder = String(element?.getAttribute?.('placeholder') || '');
    if (!placeholder) return null;
    if (YEAR_HINT.test(placeholder)) return { precision: 'year', source: '页面写法「' + placeholder + '」', weight: 'strong' };
    if (DAY_HINT.test(placeholder)) return { precision: 'day', source: '页面写法「' + placeholder + '」', weight: 'strong' };
    if (MONTH_HINT.test(placeholder)) return { precision: 'month', source: '页面写法「' + placeholder + '」', weight: 'strong' };
    return null;
  }

  // 动态结构证据：日历分类器看到的网格集合。有日格→day；仅年+月→month；仅年→year。
  function structuralEvidence(calendar) {
    const grids = Array.isArray(calendar?.grids) ? calendar.grids : [];
    if (!grids.length) return null;
    if (grids.includes('day')) return { precision: 'day', source: '日历包含日期格', weight: 'strong' };
    if (grids.includes('month')) return { precision: 'month', source: '日历只到月份格', weight: 'strong' };
    if (grids.includes('year')) return { precision: 'year', source: '日历只到年份格', weight: 'strong' };
    return null;
  }

  // 当前值形态是弱证据：那个值可能是用户手填或平台示例，单独不足以定精度。
  function currentValueEvidence(element) {
    const precision = precisionOfValue(element?.value);
    return precision ? { precision, source: '当前值形态', weight: 'weak' } : null;
  }

  // 证据冲突或只有弱证据 → precision:null，调用方（通用日期 Agent）应停止而不是按资料日期猜测。
  function resolve({ element, calendar } = {}) {
    const evidence = [];
    const push = item => { if (item) evidence.push(item); };
    push(staticEvidence(element));
    push(structuralEvidence(calendar));
    push(currentValueEvidence(element));
    const strong = evidence.filter(item => item.weight === 'strong');
    const precisions = [...new Set(strong.map(item => item.precision))];
    if (strong.length && precisions.length === 1) {
      return { precision: precisions[0], confidence: 'high', evidence };
    }
    if (strong.length > 1 && precisions.length > 1) {
      return { precision: null, confidence: 'conflict', evidence };
    }
    return { precision: null, confidence: 'insufficient', evidence };
  }

  root.ResumeProDatePrecision = { resolve, precisionOfValue, staticEvidence, structuralEvidence };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ResumeProDatePrecision;
})(typeof self !== 'undefined' ? self : globalThis);
