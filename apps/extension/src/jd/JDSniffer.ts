import type { JobContextCandidate } from '@/shared/contracts/context';
export type { JobContextSource, JobContextCandidate } from '@/shared/contracts/context';

const TITLE_MAX = 120;
const COMPANY_MAX = 80;
const DESCRIPTION_MAX = 20000;
const SECTION_MAX = 4000;
const LOCATION_MAX = 120;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function stripHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('script, style').forEach((node) => node.remove());
  return collapse(template.content.textContent ?? '');
}

function pickFirstText(root: ParentNode, selectors: string[], maxLength: number): string | undefined {
  for (const selector of selectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      const inner = element instanceof HTMLElement && typeof element.innerText === 'string' ? element.innerText : '';
      const text = collapse(inner !== '' ? inner : element.textContent ?? '');
      if (text !== '' && text.length <= maxLength) {
        return text;
      }
    }
  }
  return undefined;
}

function pickLongText(root: ParentNode, selectors: string[], minLength: number): string | undefined {
  for (const selector of selectors) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) {
      const text = collapse(element.textContent ?? '');
      if (text.length >= minLength) {
        return clamp(text, DESCRIPTION_MAX);
      }
    }
  }
  return undefined;
}

function splitDescriptionSections(description: string): {
  responsibilities?: string;
  requirements?: string;
} {
  const result: { responsibilities?: string; requirements?: string } = {};
  const responsibilityMatch = /(?:岗位职责|工作职责|职位职责|职位描述|Responsibilities)[：:]\s*([\s\S]*?)(?=(?:任职要求|任职资格|岗位要求|任职条件|技术要求|Requirements|Qualifications)|$)/i.exec(
    description,
  );
  if (responsibilityMatch !== null && responsibilityMatch[1] !== undefined) {
    const text = collapse(responsibilityMatch[1]);
    if (text !== '') {
      result.responsibilities = clamp(text, SECTION_MAX);
    }
  }
  const requirementMatch = /(?:任职要求|任职资格|岗位要求|任职条件|技术要求|Requirements|Qualifications)[：:]\s*([\s\S]*)$/i.exec(
    description,
  );
  if (requirementMatch !== null && requirementMatch[1] !== undefined) {
    const text = collapse(requirementMatch[1]);
    if (text !== '') {
      result.requirements = clamp(text, SECTION_MAX);
    }
  }
  return result;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

function findJobPosting(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
    return record;
  }
  if (record['@graph'] !== undefined) {
    return findJobPosting(record['@graph']);
  }
  return undefined;
}

function fromJsonLd(root: ParentNode): JobContextCandidate | undefined {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const posting = findJobPosting(parsed);
    if (posting === undefined) {
      continue;
    }
    const candidate: JobContextCandidate = { source: 'jsonld', confidence: 'high' };
    const title = asString(posting['title']);
    if (title !== undefined) {
      candidate.title = clamp(collapse(title), TITLE_MAX);
    }
    const organization = posting['hiringOrganization'];
    if (typeof organization === 'object' && organization !== null) {
      const name = asString((organization as Record<string, unknown>)['name']);
      if (name !== undefined) {
        candidate.company = clamp(collapse(name), COMPANY_MAX);
      }
    }
    const location = posting['jobLocation'];
    if (typeof location === 'object' && location !== null) {
      const address = (location as Record<string, unknown>)['address'];
      if (typeof address === 'object' && address !== null) {
        const addressRecord = address as Record<string, unknown>;
        const parts = [
          asString(addressRecord['addressLocality']),
          asString(addressRecord['addressRegion']),
          asString(addressRecord['addressCountry']),
        ].filter((part): part is string => part !== undefined);
        if (parts.length > 0) {
          candidate.location = clamp(parts.join(' '), LOCATION_MAX);
        }
      }
    }
    const rawDescription = asString(posting['description']);
    if (rawDescription !== undefined) {
      const description = clamp(stripHtml(rawDescription), DESCRIPTION_MAX);
      candidate.description = description;
      const sections = splitDescriptionSections(description);
      if (sections.responsibilities !== undefined) {
        candidate.responsibilities = sections.responsibilities;
      }
      if (sections.requirements !== undefined) {
        candidate.requirements = sections.requirements;
      }
    }
    if (candidate.title !== undefined || candidate.description !== undefined || candidate.company !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function fromDom(root: ParentNode): JobContextCandidate | undefined {
  const title = pickFirstText(
    root,
    ['[class*="job-title"]', '[class*="position-title"]', '[class*="job-name"]', '[class*="position-name"]', 'h1'],
    TITLE_MAX,
  );
  const company = pickFirstText(
    root,
    ['[class*="company-name"]', '[class*="company"]', '[class*="corp"]'],
    COMPANY_MAX,
  );
  const description = pickLongText(
    root,
    [
      '[class*="job-detail"]',
      '[class*="job-description"]',
      '[class*="job-desc"]',
      '[class*="position-desc"]',
      '[class*="job-content"]',
      'article',
      'main',
    ],
    40,
  );
  if (title === undefined && description === undefined) {
    return undefined;
  }
  const candidate: JobContextCandidate = { source: 'dom', confidence: 'medium' };
  if (title !== undefined) {
    candidate.title = title;
  }
  if (company !== undefined) {
    candidate.company = company;
  }
  if (description !== undefined) {
    candidate.description = description;
    const sections = splitDescriptionSections(description);
    if (sections.responsibilities !== undefined) {
      candidate.responsibilities = sections.responsibilities;
    }
    if (sections.requirements !== undefined) {
      candidate.requirements = sections.requirements;
    }
  }
  return candidate;
}

export function sniffJobDescription(root: ParentNode = document): JobContextCandidate | undefined {
  return fromJsonLd(root) ?? fromDom(root);
}
