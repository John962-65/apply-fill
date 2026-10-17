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

export { parseDateAtom };

function requireFactValue<T>(fact: ResumeFact<T> | undefined): T | undefined {
  if (fact === undefined) {
    return undefined;
  }
  return fact.value;
}

function normalizeEducationEntry(facts: EducationFacts): EducationEntry {
  const startRaw = requireFactValue(facts.startDate);
  const endRaw = requireFactValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: EducationEntry = {
    id: facts.id,
    school: facts.school.value,
    degree: facts.degree.value,
  };
  const major = requireFactValue(facts.major);
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
  const startRaw = requireFactValue(facts.startDate);
  const endRaw = requireFactValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: WorkEntry = {
    id: facts.id,
    company: facts.company.value,
  };
  const role = requireFactValue(facts.role);
  const description = requireFactValue(facts.description);
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
    name: facts.name.value,
  };
  const category = requireFactValue(facts.category);
  const level = requireFactValue(facts.level);
  if (category !== undefined) {
    entry.category = category;
  }
  if (level !== undefined) {
    entry.level = level;
  }
  return entry;
}

function normalizeProjectEntry(facts: ProjectFacts): ProjectEntry {
  const startRaw = requireFactValue(facts.startDate);
  const endRaw = requireFactValue(facts.endDate);
  const startParsed = startRaw === undefined ? undefined : parseDateAtom(startRaw);
  const endParsed = endRaw === undefined ? undefined : parseDateAtom(endRaw);
  const entry: ProjectEntry = {
    id: facts.id,
    name: facts.name.value,
  };
  const role = requireFactValue(facts.role);
  const description = requireFactValue(facts.description);
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
  const basic: NormalizedBasic = { name: facts.basic.name.value };
  const phone = requireFactValue(facts.basic.phone);
  const email = requireFactValue(facts.basic.email);
  const gender = requireFactValue(facts.basic.gender);
  const intro = requireFactValue(facts.basic.intro);
  const birthRaw = requireFactValue(facts.basic.birthDate);
  if (phone !== undefined) basic.phone = phone;
  if (email !== undefined) basic.email = email;
  if (gender !== undefined) basic.gender = gender;
  if (intro !== undefined) basic.intro = intro;
  const location = requireFactValue(facts.basic.location);
  const city = requireFactValue(facts.basic.city);
  const postalCode = requireFactValue(facts.basic.postalCode);
  const idType = requireFactValue(facts.basic.idType);
  const idExplanation = requireFactValue(facts.basic.idExplanation);
  if (location !== undefined) basic.location = location;
  if (city !== undefined) basic.city = city;
  if (postalCode !== undefined) basic.postalCode = postalCode;
  if (idType !== undefined) basic.idType = idType;
  if (idExplanation !== undefined) basic.idExplanation = idExplanation;
  if (birthRaw !== undefined) {
    const parsed = parseDateAtom(birthRaw);
    if (parsed !== undefined && !('present' in parsed)) {
      basic.birthDate = parsed;
    }
  }

  const preferences: NormalizedPreferences = {};
  const salary = requireFactValue(facts.preferences.expectedSalary);
  const freshGraduate = requireFactValue(facts.preferences.freshGraduate);
  const subscribeNotifications = requireFactValue(facts.preferences.subscribeNotifications);
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
