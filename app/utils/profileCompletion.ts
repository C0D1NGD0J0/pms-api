import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { IUserRoleType, ROLES } from '@shared/constants/roles.constants';

import { calcPercentage } from './math.utils';

export interface IAccountSetupData {
  tenantHasPaymentMethod: boolean;
  hasPaymentProcessor: boolean;
  subscriptionActive: boolean;
  payoutsEnabled: boolean;
  propertyCount: number;
  vendorCount: number;
  tenantCount: number;
  staffCount: number;
  leaseCount: number;
  unitCount: number;
}

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
  roles: IUserRoleType[],
  accountData?: IAccountSetupData
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

  // ── Account setup (admin/super-admin only) ────────────────────────────────
  if (accountData && roles.some((r) => [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(r as any))) {
    sections.push(
      scoreSection('accountSetup', 'Account Setup', [
        {
          key: 'subscription',
          label: 'Active subscription',
          value: accountData.subscriptionActive ? 'active' : null,
        },
        {
          key: 'property',
          label: 'Add your first property',
          value: accountData.propertyCount > 0 ? 'done' : null,
        },
        {
          key: 'unit',
          label: 'Add property units',
          value: accountData.unitCount > 0 ? 'done' : null,
        },
        {
          key: 'paymentGateway',
          label: 'Set up payment processing',
          value: accountData.hasPaymentProcessor ? 'done' : null,
        },
        {
          key: 'payoutBank',
          label: 'Connect bank for payouts',
          value: accountData.payoutsEnabled ? 'done' : null,
        },
      ])
    );

    sections.push(
      scoreSection('teamSetup', 'Build Your Team', [
        {
          key: 'staff',
          label: 'Invite staff members',
          value: accountData.staffCount > 0 ? 'done' : null,
        },
        {
          key: 'vendor',
          label: 'Connect a vendor',
          value: accountData.vendorCount > 0 ? 'done' : null,
        },
      ])
    );

    sections.push(
      scoreSection('tenantSetup', 'Tenant Management', [
        {
          key: 'tenant',
          label: 'Invite tenants',
          value: accountData.tenantCount > 0 ? 'done' : null,
        },
        {
          key: 'tenantPayment',
          label: 'Tenant payment method set up',
          value: accountData.tenantHasPaymentMethod ? 'done' : null,
        },
        {
          key: 'lease',
          label: 'Create a lease',
          value: accountData.leaseCount > 0 ? 'done' : null,
        },
      ])
    );
  }

  // ── Overall ───────────────────────────────────────────────────────────────
  const totalFields = sections.reduce((a, s) => a + s.totalFields, 0);
  const completedFields = sections.reduce((a, s) => a + s.completedFields, 0);
  const percent = totalFields > 0 ? calcPercentage(completedFields, totalFields) : 0;

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
    percent: totalFields > 0 ? calcPercentage(completedFields, totalFields) : 100,
    completedFields,
    totalFields,
    fields,
  };
}

function isDefaultAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const defaultHost = DEFAULT_AVATAR_PATTERN.toLowerCase();

    return hostname === defaultHost || hostname.endsWith('.' + defaultHost);
  } catch {
    // If the URL is invalid, conservatively treat it as non-default.
    return false;
  }
}

function isCustomAvatar(url?: string): boolean {
  return !!url && !isDefaultAvatarUrl(url);
}
