import {
  clientVendorsQuerySchema,
  vendorFilterQuerySchema,
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
};

export {
  clientVendorsQuerySchema,
  vendorFilterQuerySchema,
  vendorIdParamSchema,
  createVendorSchema,
  updateVendorSchema,
  vendorQuerySchema,
};
