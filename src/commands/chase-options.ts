export const GRADING_COMPANY_CHOICES = [
  { name: 'Any', value: 'ANY' },
  { name: 'Raw / Ungraded', value: 'RAW' },
  { name: 'PSA', value: 'PSA' },
  { name: 'CGC', value: 'CGC' },
  { name: 'BGS', value: 'BGS' },
  { name: 'TAG', value: 'TAG' },
  { name: 'SGC', value: 'SGC' },
  { name: 'ACE', value: 'ACE' }
] as const;

export const GRADE_VALUE_CHOICES = [
  { name: 'Any', value: 'ANY' },
  { name: '10', value: '10' },
  { name: '9.5', value: '9.5' },
  { name: '9', value: '9' },
  { name: '8.5', value: '8.5' },
  { name: '8', value: '8' },
  { name: '7.5', value: '7.5' },
  { name: '7', value: '7' },
  { name: '6.5', value: '6.5' },
  { name: '6', value: '6' },
  { name: '5', value: '5' },
  { name: '4', value: '4' },
  { name: '3', value: '3' },
  { name: '2', value: '2' },
  { name: '1', value: '1' }
] as const;

export const CONDITION_CHOICES = [
  { name: 'Any', value: 'ANY' },
  { name: 'NM or better', value: 'NM_OR_BETTER' },
  { name: 'LP or better', value: 'LP_OR_BETTER' },
  { name: 'MP or better', value: 'MP_OR_BETTER' },
  { name: 'HP or better', value: 'HP_OR_BETTER' },
  { name: 'Damaged only', value: 'DMG' }
] as const;

type GradingCompany = (typeof GRADING_COMPANY_CHOICES)[number]['value'];
type GradeValue = (typeof GRADE_VALUE_CHOICES)[number]['value'];
type ConditionChoice = (typeof CONDITION_CHOICES)[number]['value'];

export function buildGradePreference(company: GradingCompany | null, value: GradeValue | null): string | null | undefined {
  if (company === null && value === null) return undefined;
  if (company === 'ANY') return null;
  if (company === 'RAW') return 'UNGRADED';
  if (company === null) return undefined;
  if (value === 'ANY' || value === null) return company;
  return `${company} ${value}`;
}

export function gradeSelectionWarning(company: GradingCompany | null, value: GradeValue | null): string | undefined {
  if (value !== null && value !== 'ANY' && company === null) {
    return 'Choose a grading company before choosing a grade value.';
  }
  if (value !== null && value !== 'ANY' && company === 'ANY') {
    return 'Choose a grading company before choosing a grade value.';
  }
  if (value !== null && value !== 'ANY' && company === 'RAW') {
    return 'Raw / Ungraded cannot be combined with a numeric grade value.';
  }
  return undefined;
}

export function inferGradingCompanyFromGrade(grade: string | undefined): GradingCompany | undefined {
  const normalized = grade?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'UNGRADED' || normalized === 'RAW') return 'RAW';
  const company = normalized.split(/\s+/)[0];
  return GRADING_COMPANY_CHOICES.some((choice) => choice.value === company && company !== 'ANY' && company !== 'RAW')
    ? (company as GradingCompany)
    : undefined;
}

export function normalizeConditionChoice(value: ConditionChoice | null): string | null | undefined {
  if (value === null) return undefined;
  if (value === 'ANY') return null;
  if (value === 'NM_OR_BETTER') return 'NM';
  if (value === 'LP_OR_BETTER') return 'NM,LP';
  if (value === 'MP_OR_BETTER') return 'NM,LP,MP';
  if (value === 'HP_OR_BETTER') return 'NM,LP,MP,HP';
  return 'DMG';
}
