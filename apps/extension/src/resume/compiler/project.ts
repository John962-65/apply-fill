import type { NormalizedResume, Projections } from '@/shared/contracts/resume';
import { truncateText } from '@/shared/utils/text';

const INTRO_SHORT_LIMIT = 50;

export function buildProjections(normalized: NormalizedResume): Projections {
  const projections: Projections = {};
  const intro = normalized.basic.intro?.trim();
  if (intro !== undefined && intro !== '') {
    projections.introShort = truncateText(intro, INTRO_SHORT_LIMIT);
  }
  return projections;
}
