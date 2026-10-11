import { IGuestPassDocument, IGuestPassStats } from '@interfaces/guestPass.interface';

export interface IGuestPassDAO {
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
  acknowledgePass(
    cuid: string,
    vpuid: string,
    acknowledgedBy: string
  ): Promise<IGuestPassDocument | null>;
  getStats(
    cuid: string,
    propertyId?: string | string[],
    createdBy?: string
  ): Promise<IGuestPassStats>;
  bulkAcknowledge(cuid: string, vpuids: string[], acknowledgedBy: string): Promise<number>;
  getUnacknowledgedPasses(cuid: string, propertyId: string): Promise<IGuestPassDocument[]>;
  findByCode(code: string, cuid: string): Promise<IGuestPassDocument | null>;
  getUnacknowledgedCount(cuid: string, propertyId?: string): Promise<number>;
  expireOldPasses(cuid?: string): Promise<number>;
}
