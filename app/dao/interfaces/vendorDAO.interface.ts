import { ClientSession, Types } from 'mongoose';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';

export interface IVendorDAO {
  getClientVendorStats(
    cuid: string,
    filterOptions: { status?: 'active' | 'inactive' }
  ): Promise<{
    businessTypeDistribution: any[];
    servicesDistribution: any[];
    totalVendors: number;
  }>;
  updateVendor(
    vendorId: string | Types.ObjectId,
    updateData: Partial<IVendor>,
    session?: ClientSession
  ): Promise<IVendorDocument | null>;
  getVendorByPrimaryAccountHolder(userId: string | Types.ObjectId): Promise<IVendorDocument | null>;
  createVendor(vendorData: NewVendor, session?: ClientSession): Promise<IVendorDocument>;
  findByRegistrationNumber(registrationNumber: string): Promise<IVendorDocument | null>;
  getVendorById(vendorId: string | Types.ObjectId): Promise<IVendorDocument | null>;
  getClientVendors(cuid: string): Promise<IVendorDocument[]>;
}
