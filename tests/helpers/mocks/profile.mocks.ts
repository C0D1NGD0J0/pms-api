import { ClientSession, Types } from 'mongoose';
import { EmployeeDepartment, EmployeeInfo, VendorInfo } from '@interfaces/profile.interface';

import { createSuccessResponse, createMockProfile } from '../mockFactories';

/**
 * Enhanced ProfileDAO Mock with role-specific methods
 */
export const createMockProfileDAO = () => ({
  // BaseDAO methods
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteItem: jest.fn(),
  startSession: jest.fn().mockReturnValue({} as ClientSession),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  findById: jest.fn(),
  update: jest.fn(),

  // ProfileDAO specific methods
  createUserProfile: jest.fn().mockResolvedValue(createMockProfile()),
  getUserProfile: jest.fn().mockResolvedValue(createMockProfile()),
  updateProfile: jest.fn().mockResolvedValue(createMockProfile()),
  generateCurrentUserInfo: jest.fn().mockResolvedValue({
    _id: new Types.ObjectId(),
    uid: 'mock-uid',
    email: 'test@example.com',
    profile: createMockProfile(),
  }),
  getProfileInfo: jest.fn().mockResolvedValue({
    userId: 'mock-user-id',
    profileId: 'mock-profile-id',
    clientRoleInfo: [],
  }),

  // Role-specific methods for ProfileService
  ensureClientRoleInfo: jest.fn().mockResolvedValue(true),
  updateEmployeeInfo: jest.fn().mockResolvedValue(createMockProfile()),
  updateVendorInfo: jest.fn().mockResolvedValue(createMockProfile()),
  updateCommonEmployeeInfo: jest.fn().mockResolvedValue(createMockProfile()),
  updateCommonVendorInfo: jest.fn().mockResolvedValue(createMockProfile()),

  // Notification preferences methods
  getNotificationPreferences: jest.fn(),
  updateNotificationPreferences: jest.fn().mockResolvedValue(createMockProfile()),
  getRoleSpecificInfo: jest.fn().mockResolvedValue({
    employeeInfo: {
      department: EmployeeDepartment.MANAGEMENT, // Using enum value
      jobTitle: 'Software Developer',
      employmentType: 'full-time',
      startDate: new Date('2023-01-01'),
      supervisorId: 'supervisor-id',
      skills: ['JavaScript', 'TypeScript', 'Node.js'],
      certifications: ['AWS Certified'],
      emergencyContact: {
        name: 'Emergency Contact',
        relationship: 'Spouse',
        phoneNumber: '+1234567890',
      },
    } as EmployeeInfo,
    vendorInfo: null,
  }),
  clearRoleSpecificInfo: jest.fn().mockResolvedValue(createMockProfile()),
});

/**
 * Mock ProfileValidations schemas (Zod-like validation)
 */
export const createMockProfileValidations = () => ({
  updateEmployeeInfo: {
    safeParse: jest.fn().mockReturnValue({
      success: true,
      data: {
        department: EmployeeDepartment.MANAGEMENT, // Using enum value
        jobTitle: 'Software Developer',
        employmentType: 'full-time',
        startDate: new Date(),
      },
    }),
  },
  updateVendorInfo: {
    safeParse: jest.fn().mockReturnValue({
      success: true,
      data: {
        companyName: 'Vendor Company',
        businessType: 'Software Development',
        servicesProvided: ['Web Development'],
        contractType: 'project-based',
      },
    }),
  },
  profileUpdate: {
    safeParse: jest.fn().mockReturnValue({
      success: true,
      data: {
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
        employeeInfo: {
          department: EmployeeDepartment.MANAGEMENT, // Using enum value
          jobTitle: 'Developer',
        },
      },
    }),
  },
});

/**
 * Enhanced ProfileService Mock
 */
export const createMockProfileService = () => ({
  updateEmployeeInfo: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockProfile(), 'Employee information updated successfully')
    ),
  updateVendorInfo: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockProfile(), 'Vendor information updated successfully')
    ),
  getRoleSpecificInfo: jest.fn().mockResolvedValue(
    createSuccessResponse(
      {
        employeeInfo: {
          department: EmployeeDepartment.MANAGEMENT, // Using enum value
          jobTitle: 'Software Developer',
          employmentType: 'full-time',
        },
        vendorInfo: null,
      },
      'Role-specific information retrieved successfully'
    )
  ),
  clearRoleSpecificInfo: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockProfile(), 'Role-specific information cleared successfully')
    ),
  initializeRoleInfo: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockProfile(), 'Role information initialized successfully')
    ),
  updateProfileWithRoleInfo: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(
        createMockProfile(),
        'Profile updated with role information successfully'
      )
    ),
});

/**
 * Mock data factories for profile-related entities
 */
export const createMockEmployeeInfo = (overrides: Partial<EmployeeInfo> = {}): EmployeeInfo => ({
  department: EmployeeDepartment.MANAGEMENT, // Using enum value
  jobTitle: 'Software Developer',
  startDate: new Date('2023-01-01'),
  ...overrides,
});

export const createMockVendorInfo = (overrides: Partial<VendorInfo> = {}): VendorInfo => ({
  isLinkedAccount: false,
  vendorId: new Types.ObjectId(),
  linkedVendorUid: undefined,
  ...overrides,
});

/**
 * Mock translation function
 */
export const createMockTranslationFunction = () => {
  return jest.fn().mockImplementation((key: string, params?: any) => {
    // Simple mock that returns the key with params if provided
    const translations: Record<string, string> = {
      'profile.errors.invalidData': 'Invalid profile data provided',
      'profile.errors.notFound': 'Profile not found',
      'profile.errors.unauthorizedAccess': 'Unauthorized access to profile',
      'profile.errors.roleInfoNotFound': 'Role information not found',
      'profile.success.employeeInfoUpdated': 'Employee information updated successfully',
      'profile.success.vendorInfoUpdated': 'Vendor information updated successfully',
      'profile.success.roleInfoCleared': 'Role information cleared successfully',
      'profile.success.roleInfoInitialized': 'Role information initialized successfully',
    };

    const translated = translations[key] || key;
    return params ? `${translated} ${JSON.stringify(params)}` : translated;
  });
};
