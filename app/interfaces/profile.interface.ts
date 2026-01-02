import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IdentificationType } from './user.interface';

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
 * Tenant Information Interface
 * - employerInfo, activeLeases, backgroundChecks are client-specific (filtered by cuid)
 * - rentalReferences, pets, emergencyContact are shared across all clients
 * - Historical/relationship data (leaseHistory, paymentHistory, etc.) specific to tenant management
 */
export interface ITenantInfo {
  maintenanceRequests?: IMaintenanceRequestItem[];
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
 * Profile Update Data Interface
 * Used when updating profile data
 */
export interface IProfileUpdateData {
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
 * Employer Info Item Interface
 */
export interface IEmployerInfoItem {
  companyAddress: string;
  monthlyIncome: number;
  contactPerson: string;
  contactEmail: string;
  companyName: string;
  position: string;
  cuid: string; // Track which client the employer info is associated with
}

/**
 * Personal Info Interface
 */
export interface IPersonalInfo {
  identification?: IdentificationType;
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
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

/**
 * Active Lease Item Interface
 */
export interface IActiveLeaseItem {
  leaseId: string | Types.ObjectId; // Reference to Lease entity - all details fetched from there
  confirmedDate: Date;
  confirmed: boolean;
  cuid: string; // Track which client the lease is associated with
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
 * Vendor Info Interface
 */
export interface IVendorInfo {
  vendorId?: Types.ObjectId; // Reference to the vendor collection
  isLinkedAccount: boolean;
  linkedVendorUid?: string; // Reference to primary vendor (stays as string to match user model)
}

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

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
 * Profile Edit Data Interface
 * Used when fetching profile data for editing/display
 */
export interface IProfileEditData {
  personalInfo: IProfileEditPersonalInfo;
  identification?: IdentificationType;
  settings: IProfileEditSettings;
  userType: ProfileUserType;
  roles: IUserRoleType[];
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
 * Lease History Item Interface
 */
export interface ILeaseHistoryItem {
  status: LeaseHistoryStatus;
  propertyName: string;
  unitNumber: string;
  rentAmount: number;
  leaseStart: Date;
  leaseEnd: Date;
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
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

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
 * Note Type
 */
export type NoteType = 'general' | 'payment' | 'maintenance' | 'lease';

/**
 * Lease History Status Type
 */
export type LeaseHistoryStatus = 'completed' | 'active' | 'terminated';

/**
 * @deprecated Use INotificationSettings instead
 */
export type NotificationSettings = INotificationSettings;

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Payment Status Type
 */
export type PaymentStatus = 'paid' | 'late' | 'pending';

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
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
 * ============================================================================
 * LEGACY INTERFACES (Backward Compatibility)
 * ============================================================================
 */

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
