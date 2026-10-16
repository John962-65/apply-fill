import type { ApplicationContext } from './ApplicationContext';

export interface EssayProjection {
  label: string;
  text: string;
}

export interface EssayInput {
  question?: string;
  jd?: Pick<ApplicationContext, 'title' | 'company' | 'responsibilities' | 'requirements'>;
  projection: EssayProjection;
}

export const ESSAY_MAX_LENGTH = 800;
export const ESSAY_BODY_MAX_LENGTH = 320;
export const ESSAY_CLAUSE_MAX_LENGTH = 40;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function firstClause(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const normalized = collapse(text);
  if (normalized === '') {
    return undefined;
  }
  const match = /[^。；;.!?！？]+/.exec(normalized);
  const clause = collapse(match !== null ? match[0] : normalized);
  if (clause === '') {
    return undefined;
  }
  return clause.length > ESSAY_CLAUSE_MAX_LENGTH ? clause.slice(0, ESSAY_CLAUSE_MAX_LENGTH) : clause;
}

export function generateEssayDraft(input: EssayInput): string {
  const parts: string[] = [];
  const title = input.jd?.title;
  const company = input.jd?.company;
  if (title !== undefined && title !== '') {
    parts.push(company !== undefined && company !== '' ? `我应聘${company}的“${title}”岗位。` : `我应聘“${title}”岗位。`);
  } else if (input.question !== undefined && input.question !== '') {
    parts.push(`关于“${input.question}”，结合我的经历说明如下。`);
  } else {
    parts.push('结合我的经历说明如下。');
  }

  const body = collapse(input.projection.text);
  if (body !== '') {
    const clipped = body.length > ESSAY_BODY_MAX_LENGTH ? body.slice(0, ESSAY_BODY_MAX_LENGTH) : body;
    parts.push(`${input.projection.label}：${clipped}`);
  }

  const requirement = firstClause(input.jd?.requirements);
  if (requirement !== undefined) {
    parts.push(`我注意到岗位要求中提到“${requirement}”，这与我的上述经历直接相关，可以快速上手并持续贡献。`);
  }

  parts.push('期待有机会进一步交流，谢谢！');

  const draft = parts.join('\n\n');
  return draft.length > ESSAY_MAX_LENGTH ? draft.slice(0, ESSAY_MAX_LENGTH) : draft;
}
