import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IUserIdentificationType } from './user.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

/**
 * Employee Department Enum
 */
export enum EmployeeDepartment {
  MAINTENANCE = 'maintenance', // Maintenance and repairs
  OPERATIONS = 'operations', // Day-to-day property operations
  ACCOUNTING = 'accounting', // Financial operations and rent collection
  MANAGEMENT = 'management', // Executive and general management
  SECURITY = 'security', // Security and access control
  OTHER = 'other', // Any other department not listed
}

/**
 * Profile Background Check Status Enum
 */
export enum ProfileBackgroundCheckStatus {
  NOT_REQUIRED = 'not_required',
  APPROVED = 'approved',
  PENDING = 'pending',
  FAILED = 'failed',
}

/**
 * Data Retention Policy Enum
 */
export enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

/**
 * Profile Update Data Interface
 * Used when updating profile data
 */
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

/**
 * Tenant Information Interface
 * - employerInfo, activeLeases, backgroundChecks are client-specific (filtered by cuid)
 * - rentalReferences, pets, emergencyContact are shared across all clients
 * - Historical/relationship data (leaseHistory, paymentHistory, etc.) specific to tenant management
 */
export interface ITenantInfo {
  maintenanceRequests?: IMaintenanceRequestItem[];
  paymentGatewayCustomers?: Map<string, string>;
  backgroundChecks?: IBackgroundCheckItem[];
  paymentHistory?: IPaymentHistoryItem[];
  rentalReferences?: IRentalReference[];
  emergencyContact?: IEmergencyContact;
  leaseHistory?: ILeaseHistoryItem[];
  employerInfo?: IEmployerInfoItem[];
  activeLeases?: IActiveLeaseItem[];
  notes?: INoteItem[];
  pets?: IPet[];
}

/**
 * Notification Settings Interface
 */
export interface INotificationSettings {
  emailFrequency: EmailFrequencyType;
  emailNotifications: boolean;
  inAppNotifications: boolean;
  propertyUpdates: boolean;
  announcements: boolean;
  maintenance: boolean;
  comments: boolean;
  messages: boolean;
  payments: boolean;
  system: boolean;
}

/**
 * Active Lease Item Interface
 */
export interface IActiveLeaseItem {
  leaseId: string | Types.ObjectId;
  propertyAddress?: string;
  leaseNumber?: string;
  monthlyRent?: number;
  confirmedDate: Date;
  unitNumber?: string;
  confirmed: boolean;
  startDate?: Date;
  endDate?: Date;
  luid?: string;
  cuid: string;
}

/**
 * Populated User Interface
 */
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

/**
 * Personal Info Interface
 */
export interface IPersonalInfo {
  identification?: IUserIdentificationType;
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

/**
 * Profile Edit Data Interface
 * Used when fetching profile data for editing/display
 */
export interface IProfileEditData {
  identification?: IUserIdentificationType;
  personalInfo: IProfileEditPersonalInfo;
  settings: IProfileEditSettings;
  userType: ProfileUserType;
  roles: IUserRoleType[];
  policies?: IPolicies;
}

/**
 * Lease History Item Interface
 */
export interface ILeaseHistoryItem {
  status: LeaseHistoryStatus;
  leaseNumber?: string;
  propertyName: string;
  monthlyRent: number;
  unitNumber: string;
  leaseStart: Date;
  leaseEnd: Date;
  luid?: string;
  id?: string;
}

/**
 * Profile Document Interface
 * Extends IProfile with MongoDB document properties and methods
 */
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

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Vendor Info Interface
 */
export interface IVendorInfo {
  vendorId?: Types.ObjectId; // Reference to the vendor collection
  isLinkedAccount: boolean;
  linkedVendorUid?: string; // Reference to primary vendor (stays as string to match user model)
}

/**
 * Main Profile Interface
 */
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
 * Background Check Item Interface
 */
export interface IBackgroundCheckItem {
  status: ProfileBackgroundCheckStatus;
  checkedDate: Date;
  expiryDate?: Date;
  notes?: string;
  cuid: string; // Track which client performed the background check
}

/**
 * Employer Info Item Interface
 */
export interface IEmployerInfoItem {
  companyAddress: string;
  monthlyIncome: number;
  contactPerson: string;
  contactEmail: string;
  companyName: string;
  position: string;
  cuid: string;
}

/**
 * Maintenance Request Item Interface
 */
export interface IMaintenanceRequestItem {
  priority: MaintenanceRequestPriority;
  status: MaintenanceRequestStatus;
  description: string;
  requestId: string;
  type: string;
  date: Date;
}

/**
 * Employee Info Interface
 */
export interface IEmployeeInfo {
  department?: EmployeeDepartment;
  clientSpecificSettings?: any;
  employeeId?: string;
  reportsTo?: string;
  jobTitle?: string;
  startDate?: Date;
}

/**
 * Settings Interface
 */
export interface ISettings {
  notifications?: INotificationSettings;
  gdprSettings?: IGDPRSettings;
  loginType?: LoginType;
  theme?: ThemeType;
  timeZone?: string;
  lang: string;
}

/**
 * GDPR Settings Interface
 */
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

/**
 * Payment History Item Interface
 */
export interface IPaymentHistoryItem {
  status: PaymentStatus;
  type: PaymentType;
  amount: number;
  dueDate: Date;
  date: Date;
}

/**
 * Profile Edit Personal Info Interface
 */
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

/**
 * Emergency Contact Interface
 */
export interface IEmergencyContact {
  relationship: string;
  phone: string;
  email: string;
  name: string;
}

/**
 * Rental Reference Interface
 */
export interface IRentalReference {
  propertyAddress: string;
  landlordName: string;
  [key: string]: any;
}

/**
 * Pet Interface
 */
export interface IPet {
  isServiceAnimal: boolean;
  [key: string]: any;
  breed: string;
  type: string;
}

/**
 * Note Item Interface
 */
export interface INoteItem {
  timestamp: Date;
  type: NoteType;
  author: string;
  note: string;
}

/**
 * Profile with Populated User Interface
 * Used when you need both profile and user data together
 */
export interface IProfileWithUser extends Omit<IProfileDocument, 'user'> {
  user: IPopulatedUser;
}

/**
 * Profile Edit Settings Interface
 */
export interface IProfileEditSettings extends ISettings {
  timeZone: string;
  lang: string;
}

/**
 * Profile User Type
 * Extended user type including primary_account_holder
 */
export type ProfileUserType = 'employee' | 'vendor' | 'tenant' | 'primary_account_holder';

/**
 * Policies Interface
 */
export interface IPolicies {
  marketing: IPolicyAcceptance;
  tos: IPolicyAcceptance;
}

export interface ICompletionField {
  filled: boolean;
  label: string;
  key: string;
}

/**
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

/**
 * Policy Acceptance Interface
 */
export interface IPolicyAcceptance {
  acceptedOn: Date | null;
  accepted: boolean;
}

/**
 * Maintenance Request Status Type
 */
export type MaintenanceRequestStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Avatar Interface
 */
export interface IAvatar {
  filename: string;
  key: string;
  url: string;
}

/**
 * Maintenance Request Priority Type
 */
export type MaintenanceRequestPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Client Vendor Info Interface
 * @deprecated Use IVendorInfo instead
 */
export interface ClientVendorInfo {
  linkedVendorUid?: Types.ObjectId;
}

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Note Type
 */
export type NoteType = 'general' | 'payment' | 'maintenance' | 'lease';

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

/**
 * Lease History Status Type
 */
export type LeaseHistoryStatus = 'completed' | 'active' | 'terminated';

/**
 * @deprecated Use INotificationSettings instead
 */
export type NotificationSettings = INotificationSettings;

/**
 * Payment Status Type
 */
export type PaymentStatus = 'paid' | 'late' | 'pending';

/**
 * ============================================================================
 * LEGACY INTERFACES (Backward Compatibility)
 * ============================================================================
 */

/**
 * Email Frequency Type
 */
export type EmailFrequencyType = 'immediate' | 'daily';

/**
 * Payment Type
 */
export type PaymentType = 'rent' | 'fee' | 'deposit';

/**
 * Login Type
 */
export type LoginType = 'otp' | 'password';

/**
 * Theme Type
 */
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
 * ============================================================================
 * PROFILE COMPLETION INTERFACES
 * ============================================================================
 */

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

/**
 * Type guard to check if profile has populated user
 */
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
