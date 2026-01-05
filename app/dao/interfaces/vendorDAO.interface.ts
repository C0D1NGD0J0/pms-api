import { ClientSession, Types } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';

import { IFindOptions } from './baseDAO.interface';

export interface IVendorDAO {
  getClientVendorStats(
    cuid: string,
    filterOptions: { status?: 'active' | 'inactive' }
  ): Promise<{
    businessTypeDistribution: any[];
    servicesDistribution: any[];
    totalVendors: number;
  }>;
  getFilteredVendors(
    cuid: string,
    filterOptions: IVendorFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IVendorDocument[]>>;
  updateVendor(
    vendorId: string | Types.ObjectId,
    updateData: Partial<IVendor>,
    session?: ClientSession
  ): Promise<IVendorDocument | null>;
  getVendorByPrimaryAccountHolder(userId: string | Types.ObjectId): Promise<IVendorDocument | null>;
  createVendor(vendorData: NewVendor, session?: ClientSession): Promise<IVendorDocument>;
  findByRegistrationNumber(registrationNumber: string): Promise<IVendorDocument | null>;
  getClientVendors(cuid: string): Promise<ListResultWithPagination<IVendorDocument[]>>;
  getVendorById(vendorId: string | Types.ObjectId): Promise<IVendorDocument | null>;
  getVendorByVuid(vuid: string): Promise<IVendorDocument | null>;
}

export interface IVendorFilterOptions {
  status?: 'active' | 'inactive';
  businessType?: string;
  search?: string;
}
