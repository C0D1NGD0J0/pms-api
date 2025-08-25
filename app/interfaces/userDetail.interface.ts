/**
 * Vendor specific info
 */
export interface IVendorInfo {
  stats: {
    completedJobs: number;
    activeJobs: number;
    rating: string;
    responseTime: string;
    onTimeRate: string;
  };
  insuranceInfo: {
    provider: string;
    policyNumber: string;
    expirationDate: Date | null;
    coverageAmount: number;
  };
  contactPerson: {
    name: string;
    jobTitle: string;
    email: string;
    phone: string;
  };
  serviceAreas: {
    baseLocation: string;
    maxDistance: number;
  };
  servicesOffered: Record<string, any>;
  linkedUsers?: ILinkedVendorUser[];
  linkedVendorId: string | null;
  registrationNumber: string;
  isLinkedAccount: boolean;
  isPrimaryVendor: boolean;
  yearsInBusiness: number;
  businessType: string;
  companyName: string;
  tags: string[];
  taxId: string;
}

/**
 * Employee specific info
 */
export interface IEmployeeInfo {
  stats: {
    propertiesManaged: number;
    unitsManaged: number;
    tasksCompleted: number;
    onTimeRate: string;
    rating: string;
    activeTasks: number;
  };
  performance: {
    taskCompletionRate: string;
    tenantSatisfaction: string;
    avgOccupancyRate: string;
    avgResponseTime: string;
  };
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  officeInfo: {
    address: string;
    city: string;
    workHours: string;
  };
  employmentType: string;
  directManager: string;
  employeeId: string;
  department: string;
  position: string;
  skills: string[];
  hireDate: Date;
  tenure: string;
  tags: string[];
}

/**
 * Base user detail structure common to all user types
 */
export interface IUserDetailBase {
  profile: {
    firstName: string;
    lastName: string;
    fullName: string;
    avatar: string;
    phoneNumber: string;
    email: string;
    about: string;
    contact: {
      phone: string;
      email: string;
    };
  };
  user: {
    uid: string;
    email: string;
    roles: string[];
    userType: 'employee' | 'vendor' | 'tenant';
    isActive: boolean;
    createdAt: Date;
    displayName: string;
  };
  status: 'Active' | 'Inactive';
  properties: IUserProperty[];
  documents: any[];
  tasks: any[];
}

/**
 * Tenant specific info
 */
export interface ITenantInfo {
  leaseInfo: {
    status: string;
    startDate: Date;
    endDate: Date | null;
    monthlyRent: number;
  };
  unit: {
    propertyName: string;
    unitNumber: string;
    address: string;
  };
  maintenanceRequests: any[];
  paymentHistory: any[];
  rentStatus: string;
  documents: any[];
}

/**
 * Vendor team member response
 */
export interface IVendorTeamMember {
  lastLogin: Date | null;
  permissions: string[];
  displayName: string;
  phoneNumber: string;
  firstName: string;
  isActive: boolean;
  lastName: string;
  joinedDate: Date;
  email: string;
  role: string;
  uid: string;
}

/**
 * Vendor team members response
 */
export interface IVendorTeamMembersResponse {
  summary: {
    totalMembers: number;
    activeMembers: number;
    inactiveMembers: number;
  };
  teamMembers: IVendorTeamMember[];
  pagination: any;
}

/**
 * Linked vendor user info
 */
export interface ILinkedVendorUser {
  phoneNumber?: string;
  displayName: string;
  isActive: boolean;
  email: string;
  uid: string;
}

/**
 * Property info for user
 */
export interface IUserProperty {
  occupancy: string;
  location: string;
  units: number;
  since: string;
  name: string;
}

/**
 * Union type for all user detail responses
 */
export type IUserDetailResponse =
  | IEmployeeDetailResponse
  | IVendorDetailResponse
  | ITenantDetailResponse;

/**
 * Employee detail response
 */
export interface IEmployeeDetailResponse extends IUserDetailBase {
  employeeInfo: IEmployeeInfo;
}

/**
 * Vendor detail response
 */
export interface IVendorDetailResponse extends IUserDetailBase {
  vendorInfo: IVendorInfo;
}

/**
 * Tenant detail response
 */
export interface ITenantDetailResponse extends IUserDetailBase {
  tenantInfo: ITenantInfo;
}

/**
 * Type guard to check if response is for employee
 */
export function isEmployeeDetailResponse(
  response: IUserDetailResponse
): response is IEmployeeDetailResponse {
  return 'employeeInfo' in response;
}

/**
 * Type guard to check if response is for vendor
 */
export function isVendorDetailResponse(
  response: IUserDetailResponse
): response is IVendorDetailResponse {
  return 'vendorInfo' in response;
}

/**
 * Type guard to check if response is for tenant
 */
export function isTenantDetailResponse(
  response: IUserDetailResponse
): response is ITenantDetailResponse {
  return 'tenantInfo' in response;
}
