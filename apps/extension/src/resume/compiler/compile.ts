import type { CompiledResume, ResumeFactsDocument } from '@/shared/contracts/resume';
import { RESUME_COMPILER_VERSION, RESUME_SCHEMA_VERSION } from '@/shared/contracts/resume';

import { auditResumeFillability } from '../validation/fillability';
import { normalizeResume } from './normalize';
import { buildProjections } from './project';

export function compileResume(facts: ResumeFactsDocument, now: number = Date.now()): CompiledResume {
  const normalized = normalizeResume(facts);
  const compiled: CompiledResume = {
    compilerVersion: RESUME_COMPILER_VERSION,
    schemaVersion: RESUME_SCHEMA_VERSION,
    facts,
    normalized,
    projections: buildProjections(normalized),
    compiledAt: now,
  };
  compiled.fillability = auditResumeFillability(compiled, now);
  return compiled;
}
