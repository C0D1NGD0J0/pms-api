import { QueryFilter } from 'mongoose';
import { IGuestPassDocument, IGuestPassStats } from '@interfaces/guestPass.interface';

export interface IGuestPassDAO {
  acknowledgePass(
    cuid: string,
    vpuid: string,
    acknowledgedBy: string,
    visibilityFilter?: QueryFilter<IGuestPassDocument>
  ): Promise<IGuestPassDocument | null>;
  bulkAcknowledge(
    cuid: string,
    vpuids: string[],
    acknowledgedBy: string,
    visibilityFilter?: QueryFilter<IGuestPassDocument>
  ): Promise<number>;
  getUnacknowledgedPasses(
    cuid: string,
    propertyId: string,
    visibilityFilter?: QueryFilter<IGuestPassDocument>
  ): Promise<IGuestPassDocument[]>;
  getUnacknowledgedCount(
    cuid: string,
    propertyId?: string,
    visibilityFilter?: QueryFilter<IGuestPassDocument>
  ): Promise<number>;
  markAsUsed(
    id: string,
    cuid: string,
    validatedBy: string,
    notes?: string
  ): Promise<IGuestPassDocument | null>;
  revokePass(
    id: string,
    cuid: string,
    revokedBy: string,
    reason?: string
  ): Promise<IGuestPassDocument | null>;
  getStats(
    cuid: string,
    propertyId?: string | string[],
    createdBy?: string
  ): Promise<IGuestPassStats>;
  findByCode(code: string, cuid: string): Promise<IGuestPassDocument | null>;
  expireOldPasses(cuid?: string): Promise<number>;
}
