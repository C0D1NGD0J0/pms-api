import { ClientSession, Types } from 'mongoose';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ListResultWithPagination, ICurrentUser } from '@interfaces/index';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface IProfileDAO extends IBaseDAO<IProfileDocument> {
  updateNotificationPreferences(
    profileId: string,
    preferences: {
      messages?: boolean;
      comments?: boolean;
      announcements?: boolean;
      maintenance?: boolean;
      payments?: boolean;
      system?: boolean;
      propertyUpdates?: boolean;
      emailNotifications?: boolean;
      inAppNotifications?: boolean;
      emailFrequency?: 'immediate' | 'daily';
    }
  ): Promise<IProfileDocument | null>;

  /** Updates vendor reference fields only — vendor business data lives in the vendor collection. */
  updateVendorReference(
    profileId: string,
    vendorReference: { vendorId?: string; linkedVendorUid?: string; isLinkedAccount?: boolean }
  ): Promise<IProfileDocument | null>;

  createUserProfile(
    userId: string | Types.ObjectId,
    profileData: Partial<IProfileDocument>,
    session?: ClientSession
  ): Promise<IProfileDocument>;

  updateGDPRSettings(
    profileId: string,
    gdprSettings: Partial<IProfileDocument['settings']['gdprSettings']>
  ): Promise<IProfileDocument | null>;

  updatePersonalInfo(
    profileId: string,
    personalInfo: Partial<IProfileDocument['personalInfo']>
  ): Promise<IProfileDocument | null>;

  updateAvatar(
    profileId: string,
    avatarData: { url: string; filename?: string; key?: string }
  ): Promise<IProfileDocument | null>;

  clearRoleSpecificInfo(
    profileId: string,
    cuid: string,
    roleType: 'employee' | 'vendor'
  ): Promise<IProfileDocument | null>;

  /** Now directly updates the top-level employeeInfo field. */
  updateEmployeeInfo(
    profileId: string,
    cuid: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  updateTenantInfo(
    profileId: string,
    tenantInfo: Partial<IProfileDocument['tenantInfo']>
  ): Promise<IProfileDocument | null>;

  updateLocaleSettings(
    profileId: string,
    settings: { timeZone?: string; lang?: string }
  ): Promise<IProfileDocument | null>;

  updateVendorInfo(
    profileId: string,
    cuid: string,
    vendorInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  updateCommonEmployeeInfo(
    profileId: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  /** Profile info only — role data should be fetched and combined at the service layer. */
  getProfileInfo(profileId: string): Promise<{
    vendorInfo?: any;
    employeeInfo?: any;
    userId?: string;
  } | null>;

  searchProfiles(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IProfileDocument[]>;

  getNotificationPreferences(
    userId: string
  ): Promise<IProfileDocument['settings']['notifications'] | null>;

  updateLoginType(
    profileId: string,
    loginType: 'otp' | 'password'
  ): Promise<IProfileDocument | null>;

  updateTheme(profileId: string, theme: 'light' | 'dark'): Promise<IProfileDocument | null>;

  getProfileByUserId(userId: string | Types.ObjectId): Promise<IProfileDocument | null>;

  /** Uses aggregation to join user + profile data into a CurrentUser object. */
  generateCurrentUserInfo(userId: string, cuid?: string): Promise<ICurrentUser | null>;

  /** Lightweight alternative to generateCurrentUserInfo() for basic contact/profile info (e.g., email notifications, user lists). */
  getUserBasicInfo(userId: string, cuid: string): Promise<IUserBasicInfo | null>;

  getProfileUserId(profileId: string): Promise<string | null>;
}

export interface IUserBasicInfo {
  displayName: string | null;
  avatar: string | null;
  phone: string | null;
  profileId: string;
  firstName: string;
  fullName: string;
  lastName: string;
  userId: string;
  email: string;
  cuid: string;
  role: string;
}
