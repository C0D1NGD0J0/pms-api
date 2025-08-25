import {
  clientVendorsQuerySchema,
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
};

export {
  clientVendorsQuerySchema,
  vendorIdParamSchema,
  createVendorSchema,
  updateVendorSchema,
  vendorQuerySchema,
};
