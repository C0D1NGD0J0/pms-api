import {
  toggleTeamMemberStatusSchema,
  clientVendorsQuerySchema,
  vendorFilterQuerySchema,
  updateTeamMemberSchema,
  vendorIdParamSchema,
  createVendorSchema,
  updateVendorSchema,
  vendorQuerySchema,
} from './schemas';

export const VendorValidations = {
  // Vendor CRUD operations
  createVendor: createVendorSchema,
  updateVendor: updateVendorSchema,
  vendorQuery: vendorQuerySchema,
  vendorIdParam: vendorIdParamSchema,
  clientVendorsQuery: clientVendorsQuerySchema,
  vendorFilterQuery: vendorFilterQuerySchema,
  // Team member operations
  updateTeamMember: updateTeamMemberSchema,
  toggleTeamMemberStatus: toggleTeamMemberStatusSchema,
};

export {
  toggleTeamMemberStatusSchema,
  clientVendorsQuerySchema,
  vendorFilterQuerySchema,
  updateTeamMemberSchema,
  vendorIdParamSchema,
  createVendorSchema,
  updateVendorSchema,
  vendorQuerySchema,
};
