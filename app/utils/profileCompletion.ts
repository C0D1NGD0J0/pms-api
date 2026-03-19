import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { IUserRoleType, ROLES } from '@shared/constants/roles.constants';

export interface ICompletionSection {
  fields: ICompletionField[];
  completedFields: number;
  totalFields: number;
  percent: number;
  label: string;
  key: string;
}

export interface IProfileCompletion {
  sections: ICompletionSection[];
  missingFields: string[];
  percent: number;
}

export interface ICompletionField {
  filled: boolean;
  label: string;
  key: string;
}

const DEFAULT_AVATAR_PATTERN = 'lorempixel.com';

export function computeProfileCompletion(
  profile: IProfileDocument,
  client: IClientDocument,
  roles: IUserRoleType[]
): IProfileCompletion {
  const sections: ICompletionSection[] = [];

  // ── Core (all users) ──────────────────────────────────────────────────────
  sections.push(
    scoreSection('core', 'Personal Information', [
      {
        key: 'phone',
        label: 'Phone number',
        value: profile.personalInfo?.phoneNumber || null,
      },
      {
        key: 'avatar',
        label: 'Profile photo',
        value: isCustomAvatar(profile.personalInfo?.avatar?.url) ? 'set' : null,
      },
      {
        key: 'location',
        label: 'Location',
        value: profile.personalInfo?.location || null,
      },
      {
        key: 'dob',
        label: 'Date of birth',
        value: profile.personalInfo?.dob ?? null,
      },
      {
        key: 'tos',
        label: 'Terms of service',
        value: profile.policies?.tos?.accepted ? 'accepted' : null,
      },
    ])
  );

  // ── Employee info (staff role) ────────────────────────────────────────────
  if (roles.includes(ROLES.STAFF)) {
    const emp = profile.employeeInfo;
    sections.push(
      scoreSection('employee', 'Employee Information', [
        { key: 'department', label: 'Department', value: emp?.department },
        { key: 'jobTitle', label: 'Job title', value: emp?.jobTitle },
        { key: 'startDate', label: 'Start date', value: emp?.startDate ?? null },
      ])
    );
  }

  // ── Tenant profile ────────────────────────────────────────────────────────
  if (roles.includes(ROLES.TENANT)) {
    const t = profile.tenantInfo;
    sections.push(
      scoreSection('tenant', 'Tenant Profile', [
        {
          key: 'emergencyName',
          label: 'Emergency contact name',
          value: t?.emergencyContact?.name,
        },
        {
          key: 'emergencyPhone',
          label: 'Emergency contact phone',
          value: t?.emergencyContact?.phone,
        },
        {
          key: 'relationship',
          label: 'Emergency relationship',
          value: t?.emergencyContact?.relationship,
        },
        {
          key: 'employer',
          label: 'Employment information',
          value: t?.employerInfo?.length ? 'set' : null,
        },
      ])
    );
  }

  // ── Enterprise / business profile (admin/super-admin only) ───────────────
  if (
    client.accountType?.isEnterpriseAccount &&
    roles.some((r) => [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(r as any))
  ) {
    const cp = client.companyProfile;
    sections.push(
      scoreSection('enterprise', 'Business Profile', [
        { key: 'legalName', label: 'Legal entity name', value: cp?.legalEntityName },
        { key: 'companyEmail', label: 'Company email', value: cp?.companyEmail },
        { key: 'companyAddr', label: 'Company address', value: cp?.companyAddress },
        { key: 'companyPhone', label: 'Company phone', value: cp?.companyPhone },
        { key: 'website', label: 'Website', value: cp?.website },
        {
          key: 'regNumber',
          label: 'Registration number',
          value: cp?.registrationNumber,
        },
      ])
    );
  }

  // ── Overall ───────────────────────────────────────────────────────────────
  const totalFields = sections.reduce((a, s) => a + s.totalFields, 0);
  const completedFields = sections.reduce((a, s) => a + s.completedFields, 0);
  const percent = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;

  const missingFields = sections.flatMap((s) =>
    s.fields.filter((f) => !f.filled).map((f) => f.label)
  );

  return { percent, sections, missingFields };
}

function scoreSection(
  key: string,
  label: string,
  rawFields: { key: string; label: string; value: unknown }[]
): ICompletionSection {
  const fields: ICompletionField[] = rawFields.map((f) => ({
    key: f.key,
    label: f.label,
    filled: f.value !== undefined && f.value !== null && f.value !== '',
  }));

  const completedFields = fields.filter((f) => f.filled).length;
  const totalFields = fields.length;

  return {
    key,
    label,
    percent: totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 100,
    completedFields,
    totalFields,
    fields,
  };
}

function isCustomAvatar(url?: string): boolean {
  return !!url && !url.includes(DEFAULT_AVATAR_PATTERN);
}
