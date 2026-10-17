export const RESUME_SCHEMA_VERSION = 1;

export type FactSource = 'user' | 'resume-import' | 'verified-document';

export interface ResumeFact<T> {
  value: T;
  source: FactSource;
  verified: boolean;
  updatedAt: number;
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
}

export interface EducationFacts {
  id: string;
  school: ResumeFact<string>;
  degree: ResumeFact<string>;
  major?: ResumeFact<string>;
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
}

export interface CompiledResume {
  schemaVersion: number;
  facts: ResumeFactsDocument;
  normalized: NormalizedResume;
  projections: Projections;
  compiledAt: number;
}
