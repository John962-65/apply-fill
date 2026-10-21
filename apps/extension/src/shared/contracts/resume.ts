export const RESUME_SCHEMA_VERSION = 2;
export const RESUME_COMPILER_VERSION = 4;

export type FactSource = 'user' | 'resume-import' | 'verified-document';
export type FactReviewStatus = 'pending' | 'confirmed' | 'rejected';
export type ResumeExtractionEngine = 'rule' | 'llm';

export interface FactEvidence {
  text: string;
  page?: number;
  section?: string;
  line?: number;
  blockId?: string;
  startOffset?: number;
  endOffset?: number;
  instanceId?: string;
  sectionKind?: 'basic' | 'education' | 'work' | 'projects' | 'skills' | 'awards' | 'additional';
  status?: 'current' | 'historical';
}

export interface ResumeFact<T> {
  value: T;
  source: FactSource;
  /** Legacy mirror. New code must use reviewStatus; true only after field-level confirmation. */
  verified: boolean;
  reviewStatus?: FactReviewStatus;
  confidence?: number;
  evidence?: FactEvidence[];
  evidenceStatus?: 'current' | 'historical';
  originalValue?: T;
  valueModified?: boolean;
  updatedAt: number;
}

export interface ResumeExtractionMeta {
  engine: ResumeExtractionEngine;
  textHash?: string;
  pageCount?: number;
  layout?: 'single-column' | 'two-column' | 'table' | 'mixed';
  warnings?: string[];
}

export interface BasicFacts {
  name: ResumeFact<string>;
  phone?: ResumeFact<string>;
  email?: ResumeFact<string>;
  gender?: ResumeFact<string>;
  birthDate?: ResumeFact<string>;
  intro?: ResumeFact<string>;
  location?: ResumeFact<string>;
  city?: ResumeFact<string>;
  postalCode?: ResumeFact<string>;
  idType?: ResumeFact<string>;
  idExplanation?: ResumeFact<string>;
  awards?: ResumeFact<string>;
  additionalInfo?: ResumeFact<string>;
}

export interface EducationFacts {
  id: string;
  school: ResumeFact<string>;
  degree: ResumeFact<string>;
  major?: ResumeFact<string>;
  gpa?: ResumeFact<string | number>;
  startDate?: ResumeFact<string>;
  endDate?: ResumeFact<string>;
}

export interface ProjectFacts {
  id: string;
  name: ResumeFact<string>;
  role?: ResumeFact<string>;
  description?: ResumeFact<string>;
  startDate?: ResumeFact<string>;
  endDate?: ResumeFact<string>;
  responsibilities?: ResumeFact<string>;
  outcomes?: ResumeFact<string>;
  keywords?: ResumeFact<string[]>;
}

export interface WorkFacts {
  id: string;
  company: ResumeFact<string>;
  role?: ResumeFact<string>;
  description?: ResumeFact<string>;
  startDate?: ResumeFact<string>;
  endDate?: ResumeFact<string>;
}

export interface SkillFacts {
  id: string;
  name: ResumeFact<string>;
  category?: ResumeFact<string>;
  level?: ResumeFact<string>;
}

export interface PreferenceFacts {
  expectedSalary?: ResumeFact<number>;
  freshGraduate?: ResumeFact<boolean>;
  subscribeNotifications?: ResumeFact<boolean>;
}

export interface ResumeFactsDocument {
  schemaVersion: number;
  basic: BasicFacts;
  education: EducationFacts[];
  work?: WorkFacts[];
  projects?: ProjectFacts[];
  skills?: SkillFacts[];
  preferences: PreferenceFacts;
  updatedAt: number;
  extraction?: ResumeExtractionMeta;
  migration?: {
    originalFacts: unknown;
    fromSchemaVersion?: number;
    warnings: string[];
  };
  review?: {
    updatedAt: number;
    lastPath?: string;
  };
}

export type FillabilityReason =
  | 'PATH_NOT_FOUND'
  | 'FACT_NOT_CONFIRMED'
  | 'FACT_REJECTED'
  | 'EMPTY_VALUE'
  | 'TYPE_MISMATCH'
  | 'DATE_PRECISION_INSUFFICIENT'
  | 'DERIVED_TEXT_INVALID'
  | 'REQUIRED_FACT_MISSING';

export interface FieldFillability {
  path: string;
  fillable: boolean;
  reason?: FillabilityReason;
  value?: unknown;
  factPaths: string[];
}

export interface FillabilityReport {
  ok: boolean;
  compilerVersion: number;
  checkedAt: number;
  confirmedFields: number;
  pendingFields: number;
  rejectedFields: number;
  fields: FieldFillability[];
  issues: Array<{ path: string; reason: FillabilityReason; detail?: string }>;
}

export interface DateAtom {
  year: number;
  month?: number;
  day?: number;
  precision: 'year' | 'month' | 'day';
  isPresent?: boolean;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string;
  major?: string;
  gpa?: string | number;
  startDate?: DateAtom;
  endDate?: DateAtom | { present: true };
}

export interface ProjectEntry {
  id: string;
  name: string;
  role?: string;
  description?: string;
  startDate?: DateAtom;
  endDate?: DateAtom | { present: true };
  responsibilities?: string;
  outcomes?: string;
  keywords?: string[];
}

export interface WorkEntry {
  id: string;
  company: string;
  role?: string;
  description?: string;
  startDate?: DateAtom;
  endDate?: DateAtom | { present: true };
}

export interface SkillEntry {
  id: string;
  name: string;
  category?: string;
  level?: string;
}

export interface NormalizedBasic {
  name: string;
  phone?: string;
  email?: string;
  gender?: string;
  birthDate?: DateAtom;
  intro?: string;
  location?: string;
  city?: string;
  postalCode?: string;
  idType?: string;
  idExplanation?: string;
  awards?: string;
  additionalInfo?: string;
}

export interface NormalizedPreferences {
  expectedSalary?: number;
  freshGraduate?: boolean;
  subscribeNotifications?: boolean;
}

export interface NormalizedResume {
  basic: NormalizedBasic;
  education: EducationEntry[];
  work: WorkEntry[];
  projects: ProjectEntry[];
  skills: SkillEntry[];
  preferences: NormalizedPreferences;
}

export interface Projections {
  introShort?: string;
  projects?: ProjectProjection[];
}

export interface ProjectDerivation {
  field: 'background' | 'responsibilities' | 'technicalMethods' | 'outcomes';
  text: string;
  factPath: string;
}

export interface ProjectProjection {
  resumeEntryId: string;
  title: string;
  one_liner: string;
  summary_150: string;
  responsibilities: string;
  outcomes: string;
  full_description: string;
  background?: string;
  technicalMethods?: string;
  keywords: string[];
  sourceFactPaths: string[];
  derivations?: ProjectDerivation[];
  consistency?: {
    ok: boolean;
    issues: string[];
  };
}

export interface CompiledResume {
  compilerVersion?: number;
  schemaVersion: number;
  facts: ResumeFactsDocument;
  normalized: NormalizedResume;
  projections: Projections;
  fillability?: FillabilityReport;
  compiledAt: number;
}

export interface ResumeVersionInfo {
  id: string;
  label: string;
  createdAt: number;
  active: boolean;
}
