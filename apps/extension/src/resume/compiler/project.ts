import type { NormalizedResume, Projections, ProjectProjection } from '@/shared/contracts/resume';
import { truncateText } from '@/shared/utils/text';

const INTRO_SHORT_LIMIT = 50;

export function buildProjections(normalized: NormalizedResume): Projections {
  const projections: Projections = {};
  const intro = normalized.basic.intro?.trim();
  if (intro !== undefined && intro !== '') {
    projections.introShort = truncateText(intro, INTRO_SHORT_LIMIT);
  }
  projections.projects = normalized.projects.map((entry, index): ProjectProjection => {
    const description = entry.description?.trim() || entry.name;
    const sourceFactPaths = ['name', 'description', 'role', 'responsibilities', 'outcomes', 'keywords']
      .filter((key) => entry[key as keyof typeof entry] !== undefined)
      .map((key) => `projects[${index}].${key}`);
    return {
      resumeEntryId: entry.id,
      title: entry.name,
      one_liner: truncateText(description, 50),
      summary_150: truncateText(description, 150),
      responsibilities: entry.responsibilities ?? entry.role ?? '',
      outcomes: entry.outcomes ?? '',
      full_description: description,
      keywords: [...(entry.keywords ?? [])],
      sourceFactPaths,
    };
  });
  return projections;
}
