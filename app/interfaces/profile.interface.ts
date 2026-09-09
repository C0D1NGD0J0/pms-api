import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { INotificationSettings } from './notification.interface';
import { IPhoneVerification, ISMSConsent } from './sms.interface';

export enum EmployeeDepartment {
  MAINTENANCE = 'maintenance',
  OPERATIONS = 'operations',
  ACCOUNTING = 'accounting',
  MANAGEMENT = 'management',
  SECURITY = 'security',
  OTHER = 'other',
}

export enum ProfileBackgroundCheckStatus {
  NOT_REQUIRED = 'not_required',
  APPROVED = 'approved',
  PENDING = 'pending',
  FAILED = 'failed',
}

export enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

export interface ITenantInfo {
  padMandateDetails?: Map<string, IPadMandateDetails>;
  paymentGatewayCustomers?: Map<string, string>;
  backgroundChecks?: IBackgroundCheckItem[];
  cardPaymentMethods?: Map<string, string>;
  paymentHistory?: IPaymentHistoryItem[];
  paymentMandates?: Map<string, string>;
  rentalReferences?: IRentalReference[];
  paymentMethods?: Map<string, string>;
  emergencyContact?: IEmergencyContact;
  leaseHistory?: ILeaseHistoryItem[];
  employerInfo?: IEmployerInfoItem[];
  activeLeases?: IActiveLeaseItem[];
  propertyId?: string;
  unitId?: string;
  pets?: IPet[];
}

export interface IProfileUpdateData {
  policies?: {
    tos?: { accepted?: boolean };
    marketing?: { accepted?: boolean };
  };
  settings?: {
    timeZone?: string;
    lang?: string;
  } & Partial<ISettings>;
  profileMeta?: {
    timeZone?: string;
    lang?: string;
  };
  personalInfo?: Partial<IPersonalInfo>;
  employeeInfo?: Partial<IEmployeeInfo>;
  userInfo?: {
    email?: string;
  };
  tenantInfo?: Partial<ITenantInfo>;
  vendorInfo?: Partial<IVendorInfo>;
}

export interface ISettings {
  pushSubscriptions?: IPushSubscription[];
  phoneVerification?: IPhoneVerification;
  notifications?: INotificationSettings;
  gdprSettings?: IGDPRSettings;
  smsConsent?: ISMSConsent;
  loginType?: LoginType;
  theme?: ThemeType;
  timeZone?: string;
  lang: string;
}

export interface IActiveLeaseItem {
  leaseId: string | Types.ObjectId;
  propertyAddress?: string;
  leaseNumber?: string;
  rentAmount?: number;
  confirmedDate: Date;
  unitNumber?: string;
  confirmed: boolean;
  startDate?: Date;
  endDate?: Date;
  luid?: string;
  cuid: string;
}

export interface IPopulatedUser {
  cuids?: Array<{
    role: IUserRoleType;
    addedAt: Date;
    cuid: string;
  }>;
  deletedAt?: Date | null;
  _id: Types.ObjectId;
  activecuid: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  uid: string;
}

export interface ILeaseHistoryItem {
  status: LeaseHistoryStatus;
  leaseNumber?: string;
  propertyName: string;
  rentAmount: number;
  unitNumber: string;
  leaseStart: Date;
  leaseEnd: Date;
  luid?: string;
  id?: string;
}

export interface IProfileDocument extends Document, IProfile {
  getGravatarUrl: () => string;
  _id: Types.ObjectId;
  fullname?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  puid: string;
  id: string;
}

export interface IEmployeeInfo {
  emergencyContact?: IEmergencyContact;
  department?: EmployeeDepartment;
  clientSpecificSettings?: any;
  employeeId?: string;
  reportsTo?: string;
  jobTitle?: string;
  startDate?: Date;
}

export interface IVendorInfo {
  vendorId?: Types.ObjectId; // Reference to the vendor collection
  isLinkedAccount: boolean;
  linkedVendorUid?: string; // Reference to primary vendor (stays as string to match user model)
}

export interface IProfile {
  employeeInfo?: IEmployeeInfo;
  personalInfo: IPersonalInfo;
  tenantInfo?: ITenantInfo;
  vendorInfo?: IVendorInfo;
  user: Types.ObjectId;
  settings: ISettings;
  policies: IPolicies;
}

/**
 * - employerInfo, activeLeases, backgroundChecks are client-specific (filtered by cuid)
 * - rentalReferences, pets, emergencyContact are shared across all clients
 * - Historical/relationship data (leaseHistory, paymentHistory, etc.) specific to tenant management
 */
export interface IPadMandateDetails {
  cancellationRights?: string;
  payeeName?: string;
  mandateId?: string;
  confirmedAt?: Date;
  frequency: string;
  debitDay?: number;
  startDate?: Date;
  amount: number;
}

export interface IPersonalInfo {
  phoneNumber?: string;
  displayName: string;
  firstName: string;
  headline?: string;
  lastName: string;
  location: string;
  avatar?: IAvatar;
  bio?: string;
  dob?: Date;
}

export interface IBackgroundCheckItem {
  status: ProfileBackgroundCheckStatus;
  checkedDate: Date;
  expiryDate?: Date;
  notes?: string;
  cuid: string; // Track which client performed the background check
}

export interface IEmployerInfoItem {
  companyAddress: string;
  monthlyIncome: number;
  contactPerson: string;
  contactEmail: string;
  companyName: string;
  position: string;
  cuid: string;
}

export interface IProfileEditData {
  personalInfo: IProfileEditPersonalInfo;
  settings: IProfileEditSettings;
  userType: ProfileUserType;
  roles: IUserRoleType[];
  policies?: IPolicies;
}

export interface IGDPRSettings {
  dataRetentionPolicy: DataRetentionPolicy;
  dataProcessingConsent: boolean;
  processingConsentDate: Date;
  retentionExpiryDate: Date;
}

export interface ICompletionSection {
  fields: ICompletionField[];
  completedFields: number;
  totalFields: number;
  percent: number;
  label: string;
  key: string;
}

export interface IPushSubscription {
  keys: {
    p256dh: string;
    auth: string;
  };
  deviceLabel?: string;
  endpoint: string;
  createdAt?: Date;
}

export interface IPaymentHistoryItem {
  status: PaymentStatus;
  type: PaymentType;
  amount: number;
  dueDate: Date;
  date: Date;
}

export interface IProfileEditPersonalInfo extends IPersonalInfo {
  isActive: boolean;
  email: string;
  uid: string;
}

export interface IProfileCompletion {
  sections: ICompletionSection[];
  missingFields: string[];
  percent: number;
}

export interface IPolicies {
  marketing: IPolicyAcceptance;
  privacy?: IPolicyAcceptance;
  tos: IPolicyAcceptance;
}

export interface IEmergencyContact {
  relationship: string;
  phone: string;
  email: string;
  name: string;
}

export interface IRentalReference {
  propertyAddress: string;
  landlordName: string;
  [key: string]: any;
}

export interface IPet {
  isServiceAnimal: boolean;
  [key: string]: any;
  breed: string;
  type: string;
}

export interface IProfileWithUser extends Omit<IProfileDocument, 'user'> {
  user: IPopulatedUser;
}

export interface IProfileEditSettings extends ISettings {
  timeZone: string;
  lang: string;
}

export type ProfileUserType = 'employee' | 'vendor' | 'tenant' | 'primary_account_holder';

export interface ICompletionField {
  filled: boolean;
  label: string;
  key: string;
}

export interface IPolicyAcceptance {
  acceptedOn: Date | null;
  accepted: boolean;
}

export type MaintenanceRequestStatus = 'pending' | 'in_progress' | 'completed';

export interface IAvatar {
  filename: string;
  key: string;
  url: string;
}

export type MaintenanceRequestPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * @deprecated Use IVendorInfo instead
 */
export interface ClientVendorInfo {
  linkedVendorUid?: Types.ObjectId;
}

export type NoteType = 'general' | 'payment' | 'maintenance' | 'lease';

export type LeaseHistoryStatus = 'completed' | 'active' | 'terminated';

export type PaymentStatus = 'paid' | 'late' | 'pending';

export type EmailFrequencyType = 'immediate' | 'daily';

export type PaymentType = 'rent' | 'fee' | 'deposit';

export type LoginType = 'otp' | 'password';

export type ThemeType = 'light' | 'dark';

/**
 * @deprecated Use IEmployeeInfo instead
 */
export type EmployeeInfo = IEmployeeInfo;

/**
 * @deprecated Use IGDPRSettings instead
 */
export type GDPRSettings = IGDPRSettings;

/**
 * @deprecated Use ITenantInfo instead
 */
export type TenantInfo = ITenantInfo;

/**
 * @deprecated Use IVendorInfo instead
 */
export type VendorInfo = IVendorInfo;

/**
 * @deprecated Use IProfile instead
 */
export type Profile = IProfile;

/** Type guard to check if profile has populated user */
export function isProfileWithPopulatedUser(
  profile: IProfileDocument | null
): profile is { user: IPopulatedUser } & IProfileDocument {
  if (!profile) return false;
  const user = profile.user;
  return (
    user !== null &&
    typeof user === 'object' &&
    !(user instanceof Types.ObjectId) &&
    'uid' in user &&
    'email' in user
  );
}
