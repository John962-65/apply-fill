import type {
  EducationEntry,
  EducationFacts,
  NormalizedBasic,
  NormalizedPreferences,
  NormalizedResume,
  ProjectEntry,
  ProjectFacts,
  ResumeFact,
  ResumeFactsDocument,
  SkillEntry,
  SkillFacts,
  WorkEntry,
  WorkFacts,
} from '@/shared/contracts/resume';
import { parseDateAtom } from '@/shared/utils/date';

import { isConfirmedFact } from '../review/facts';

export { parseDateAtom };

function confirmedValue<T>(fact: ResumeFact<T> | undefined): T | undefined {
  if (fact === undefined || !isConfirmedFact(fact as ResumeFact<unknown>)) {
    return undefined;
  }
  const value = fact.value;
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  if (Array.isArray(value) && value.length === 0) {
    return undefined;
  }
  return value;
}

function normalizeEducationEntry(facts: EducationFacts): EducationEntry {
  const startRaw = confirmedValue(facts.startDate);
  const endRaw = confirmedValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: EducationEntry = {
    id: facts.id,
    school: confirmedValue(facts.school) ?? '',
    degree: confirmedValue(facts.degree) ?? '',
  };
  const major = confirmedValue(facts.major);
  const gpa = confirmedValue(facts.gpa);
  if (gpa !== undefined) entry.gpa = gpa;
  if (major !== undefined) {
    entry.major = major;
  }
  if (startParsed !== undefined && !('present' in startParsed)) {
    entry.startDate = startParsed;
  }
  if (endParsed !== undefined) {
    entry.endDate = endParsed;
  }
  return entry;
}

function normalizeWorkEntry(facts: WorkFacts): WorkEntry {
  const startRaw = confirmedValue(facts.startDate);
  const endRaw = confirmedValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: WorkEntry = {
    id: facts.id,
    company: confirmedValue(facts.company) ?? '',
  };
  const role = confirmedValue(facts.role);
  const description = confirmedValue(facts.description);
  if (role !== undefined) {
    entry.role = role;
  }
  if (description !== undefined) {
    entry.description = description;
  }
  if (startParsed !== undefined && !('present' in startParsed)) {
    entry.startDate = startParsed;
  }
  if (endParsed !== undefined) {
    entry.endDate = endParsed;
  }
  return entry;
}

function normalizeSkillEntry(facts: SkillFacts): SkillEntry {
  const entry: SkillEntry = {
    id: facts.id,
    name: confirmedValue(facts.name) ?? '',
  };
  const category = confirmedValue(facts.category);
  const level = confirmedValue(facts.level);
  if (category !== undefined) {
    entry.category = category;
  }
  if (level !== undefined) {
    entry.level = level;
  }
  return entry;
}

function normalizeProjectEntry(facts: ProjectFacts): ProjectEntry {
  const startRaw = confirmedValue(facts.startDate);
  const endRaw = confirmedValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: ProjectEntry = {
    id: facts.id,
    name: confirmedValue(facts.name) ?? '',
  };
  const role = confirmedValue(facts.role);
  const description = confirmedValue(facts.description);
  const responsibilities = confirmedValue(facts.responsibilities);
  const outcomes = confirmedValue(facts.outcomes);
  const keywords = confirmedValue(facts.keywords);
  if (responsibilities !== undefined) entry.responsibilities = responsibilities;
  if (outcomes !== undefined) entry.outcomes = outcomes;
  if (keywords !== undefined) entry.keywords = [...keywords];
  if (role !== undefined) {
    entry.role = role;
  }
  if (description !== undefined) {
    entry.description = description;
  }
  if (startParsed !== undefined && !('present' in startParsed)) {
    entry.startDate = startParsed;
  }
  if (endParsed !== undefined) {
    entry.endDate = endParsed;
  }
  return entry;
}

export function normalizeResume(facts: ResumeFactsDocument): NormalizedResume {
  const basic: NormalizedBasic = { name: confirmedValue(facts.basic.name) ?? '' };
  const phone = confirmedValue(facts.basic.phone);
  const email = confirmedValue(facts.basic.email);
  const gender = confirmedValue(facts.basic.gender);
  const intro = confirmedValue(facts.basic.intro);
  const birthRaw = confirmedValue(facts.basic.birthDate);
  if (phone !== undefined) basic.phone = phone;
  if (email !== undefined) basic.email = email;
  if (gender !== undefined) basic.gender = gender;
  if (intro !== undefined) basic.intro = intro;
  const location = confirmedValue(facts.basic.location);
  const city = confirmedValue(facts.basic.city);
  const postalCode = confirmedValue(facts.basic.postalCode);
  const idType = confirmedValue(facts.basic.idType);
  const idExplanation = confirmedValue(facts.basic.idExplanation);
  if (location !== undefined) basic.location = location;
  if (city !== undefined) basic.city = city;
  if (postalCode !== undefined) basic.postalCode = postalCode;
  if (idType !== undefined) basic.idType = idType;
  if (idExplanation !== undefined) basic.idExplanation = idExplanation;
  const awards = confirmedValue(facts.basic.awards);
  const additionalInfo = confirmedValue(facts.basic.additionalInfo);
  if (awards !== undefined) basic.awards = awards;
  if (additionalInfo !== undefined) basic.additionalInfo = additionalInfo;
  if (birthRaw !== undefined) {
    const parsed = parseDateAtom(birthRaw);
    if (parsed !== undefined && !('present' in parsed)) {
      basic.birthDate = parsed;
    }
  }

  const preferences: NormalizedPreferences = {};
  const salary = confirmedValue(facts.preferences.expectedSalary);
  const freshGraduate = confirmedValue(facts.preferences.freshGraduate);
  const subscribeNotifications = confirmedValue(facts.preferences.subscribeNotifications);
  if (salary !== undefined) preferences.expectedSalary = salary;
  if (freshGraduate !== undefined) preferences.freshGraduate = freshGraduate;
  if (subscribeNotifications !== undefined) preferences.subscribeNotifications = subscribeNotifications;

  return {
    basic,
    education: facts.education.map(normalizeEducationEntry),
    work: (facts.work ?? []).map(normalizeWorkEntry),
    projects: (facts.projects ?? []).map(normalizeProjectEntry),
    skills: (facts.skills ?? []).map(normalizeSkillEntry),
    preferences,
  };
}
