export interface InvitationImportableField {
  group: 'person' | 'employee' | 'vendor' | 'tenant';
  synonyms: string[];
  required: boolean;
  label: string;
  key: string;
}

/**
 * Every column the invitation importer accepts, with human labels and fuzzy-match
 * synonyms for the mapping step's auto-fill pass. Keys match the CSV schema
 * (InvitationValidations.invitationCsv) — this file is presentation/matching
 * metadata; the schema stays the source of truth for validation.
 */
export const INVITATION_IMPORTABLE_FIELDS: InvitationImportableField[] = [
  {
    key: 'inviteeEmail',
    label: 'Email',
    group: 'person',
    required: true,
    synonyms: ['email', 'email address', 'e-mail', 'invitee email', 'work email'],
  },
  {
    key: 'firstName',
    label: 'First Name',
    group: 'person',
    required: true,
    synonyms: ['first name', 'firstname', 'given name', 'first'],
  },
  {
    key: 'lastName',
    label: 'Last Name',
    group: 'person',
    required: true,
    synonyms: ['last name', 'lastname', 'surname', 'family name', 'last'],
  },
  {
    key: 'role',
    label: 'Role (admin, manager, staff, tenant or vendor)',
    group: 'person',
    required: true,
    synonyms: ['role', 'user role', 'user type', 'type', 'access level'],
  },
  {
    key: 'phoneNumber',
    label: 'Phone Number',
    group: 'person',
    required: false,
    synonyms: ['phone', 'phone number', 'mobile', 'cell', 'telephone'],
  },
  {
    key: 'status',
    label: 'Status (pending sends now, draft saves without sending)',
    group: 'person',
    required: false,
    synonyms: ['status', 'invitation status'],
  },
  {
    key: 'inviteMessage',
    label: 'Personal Message',
    group: 'person',
    required: false,
    synonyms: ['message', 'invite message', 'note', 'personal message'],
  },
  {
    key: 'expectedStartDate',
    label: 'Expected Start Date',
    group: 'person',
    required: false,
    synonyms: ['start date', 'expected start date', 'move in date', 'move-in date'],
  },
  {
    key: 'employeeInfo_department',
    label: 'Department',
    group: 'employee',
    required: false,
    synonyms: ['department', 'dept', 'team'],
  },
  {
    key: 'employeeInfo_jobTitle',
    label: 'Job Title',
    group: 'employee',
    required: false,
    synonyms: ['job title', 'title', 'position'],
  },
  {
    key: 'employeeInfo_employeeId',
    label: 'Employee ID',
    group: 'employee',
    required: false,
    synonyms: ['employee id', 'employee number', 'staff id'],
  },
  {
    key: 'employeeInfo_reportsTo',
    label: 'Reports To',
    group: 'employee',
    required: false,
    synonyms: ['reports to', 'manager', 'supervisor'],
  },
  {
    key: 'employeeInfo_startDate',
    label: 'Employment Start Date',
    group: 'employee',
    required: false,
    synonyms: ['employment start date', 'hire date', 'date hired'],
  },
  {
    key: 'linkedVendorUid',
    label: 'Vendor ID (to add a team member to an existing vendor)',
    group: 'vendor',
    required: false,
    synonyms: ['vendor id', 'vuid', 'linked vendor', 'linked vendor id'],
  },
  {
    key: 'vendorInfo_companyName',
    label: 'Company Name',
    group: 'vendor',
    required: false,
    synonyms: ['company', 'company name', 'business name', 'vendor name'],
  },
  {
    key: 'vendorInfo_businessType',
    label: 'Business Type',
    group: 'vendor',
    required: false,
    synonyms: ['business type', 'trade', 'service type', 'category'],
  },
  {
    key: 'vendorInfo_taxId',
    label: 'Tax ID',
    group: 'vendor',
    required: false,
    synonyms: ['tax id', 'tin', 'ein', 'vat number'],
  },
  {
    key: 'vendorInfo_registrationNumber',
    label: 'Registration Number',
    group: 'vendor',
    required: false,
    synonyms: ['registration number', 'company number', 'business number', 'rc number'],
  },
  {
    key: 'vendorInfo_yearsInBusiness',
    label: 'Years in Business',
    group: 'vendor',
    required: false,
    synonyms: ['years in business', 'years trading', 'experience'],
  },
  {
    key: 'vendorInfo_contactPerson_name',
    label: 'Contact Person Name',
    group: 'vendor',
    required: false,
    synonyms: ['contact name', 'contact person'],
  },
  {
    key: 'vendorInfo_contactPerson_jobTitle',
    label: 'Contact Person Job Title',
    group: 'vendor',
    required: false,
    synonyms: ['contact title', 'contact job title'],
  },
  {
    key: 'vendorInfo_contactPerson_email',
    label: 'Contact Person Email',
    group: 'vendor',
    required: false,
    synonyms: ['contact email'],
  },
  {
    key: 'vendorInfo_contactPerson_phone',
    label: 'Contact Person Phone',
    group: 'vendor',
    required: false,
    synonyms: ['contact phone'],
  },
  {
    key: 'tenantInfo_employerCompanyName',
    label: 'Employer',
    group: 'tenant',
    required: false,
    synonyms: ['employer', 'employer name', 'employer company'],
  },
  {
    key: 'tenantInfo_employerPosition',
    label: 'Position at Employer',
    group: 'tenant',
    required: false,
    synonyms: ['occupation', 'employer position', 'job'],
  },
  {
    key: 'tenantInfo_employerMonthlyIncome',
    label: 'Monthly Income',
    group: 'tenant',
    required: false,
    synonyms: ['monthly income', 'income', 'salary'],
  },
  {
    key: 'tenantInfo_employerContactPerson',
    label: 'Employer Contact Person',
    group: 'tenant',
    required: false,
    synonyms: ['employer contact', 'employer reference'],
  },
  {
    key: 'tenantInfo_employerCompanyAddress',
    label: 'Employer Address',
    group: 'tenant',
    required: false,
    synonyms: ['employer address', 'work address'],
  },
  {
    key: 'tenantInfo_employerContactEmail',
    label: 'Employer Contact Email',
    group: 'tenant',
    required: false,
    synonyms: ['employer email', 'employer contact email', 'reference email'],
  },
  {
    key: 'tenantInfo_emergencyContactName',
    label: 'Emergency Contact Name',
    group: 'tenant',
    required: false,
    synonyms: ['emergency contact', 'emergency contact name', 'next of kin'],
  },
  {
    key: 'tenantInfo_emergencyContactPhone',
    label: 'Emergency Contact Phone',
    group: 'tenant',
    required: false,
    synonyms: ['emergency phone', 'emergency contact phone'],
  },
  {
    key: 'tenantInfo_emergencyContactRelationship',
    label: 'Emergency Contact Relationship',
    group: 'tenant',
    required: false,
    synonyms: ['relationship', 'emergency contact relationship'],
  },
  {
    key: 'tenantInfo_emergencyContactEmail',
    label: 'Emergency Contact Email',
    group: 'tenant',
    required: false,
    synonyms: ['emergency email', 'emergency contact email'],
  },
];

export const INVITATION_REQUIRED_FIELD_KEYS = INVITATION_IMPORTABLE_FIELDS.filter(
  (f) => f.required
).map((f) => f.key);

const VALID_INVITATION_FIELD_KEYS = new Set(INVITATION_IMPORTABLE_FIELDS.map((f) => f.key));

export function getInvitationImportFieldsResponse(): {
  fields: InvitationImportableField[];
  presetMapping: null;
} {
  // No third-party presets for people — every file goes through the mapping step.
  return { fields: INVITATION_IMPORTABLE_FIELDS, presetMapping: null };
}

export function isKnownInvitationImportField(key: string): boolean {
  return VALID_INVITATION_FIELD_KEYS.has(key);
}
