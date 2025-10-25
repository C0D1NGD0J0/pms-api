import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  IRentRollItem,
  ILeaseStats,
  LeaseStatus,
} from '@interfaces/lease.interface';

import { ILeaseDAO } from './interfaces/leaseDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';

export class LeaseDAO implements ILeaseDAO {
  private readonly log: Logger;
  private readonly leaseModel: Model<ILeaseDocument>;

  constructor({ leaseModel }: { leaseModel: Model<ILeaseDocument> }) {
    this.log = createLogger('LeaseDAO');
    this.leaseModel = leaseModel;
  }

  async createLease(
    cuid: string,
    _data: Partial<ILeaseDocument>,
    _session?: ClientSession
  ): Promise<ILeaseDocument> {
    this.log.info(`Creating lease for client ${cuid}`);
    throw new Error('createLease not yet implemented');
  }

  async getLeaseById(
    cuid: string,
    leaseId: string,
    _opts?: IFindOptions
  ): Promise<ILeaseDocument | null> {
    this.log.info(`Getting lease ${leaseId} for client ${cuid}`);
    throw new Error('getLeaseById not yet implemented');
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    _pagination: IPaginationQuery
  ): ListResultWithPagination<ILeaseDocument[]> {
    this.log.info(`Getting filtered leases for client ${cuid}`, { filters });
    throw new Error('getFilteredLeases not yet implemented');
  }

  async updateLease(
    cuid: string,
    leaseId: string,
    _data: Partial<ILeaseDocument>
  ): Promise<ILeaseDocument | null> {
    this.log.info(`Updating lease ${leaseId} for client ${cuid}`);
    throw new Error('updateLease not yet implemented');
  }

  async deleteLease(cuid: string, leaseId: string): Promise<boolean> {
    this.log.info(`Deleting lease ${leaseId} for client ${cuid}`);
    throw new Error('deleteLease not yet implemented');
  }

  async checkOverlappingLeases(
    _cuid: string,
    _propertyId: string,
    unitId: string,
    _startDate: Date,
    _endDate: Date,
    _excludeLeaseId?: string
  ): Promise<ILeaseDocument[]> {
    this.log.info(`Checking overlapping leases for unit ${unitId}`);
    throw new Error('checkOverlappingLeases not yet implemented');
  }

  async getActiveLeaseByTenant(cuid: string, tenantId: string): Promise<ILeaseDocument | null> {
    this.log.info(`Getting active lease for tenant ${tenantId}`);
    throw new Error('getActiveLeaseByTenant not yet implemented');
  }

  async getActiveLeaseByUnit(cuid: string, unitId: string): Promise<ILeaseDocument | null> {
    this.log.info(`Getting active lease for unit ${unitId}`);
    throw new Error('getActiveLeaseByUnit not yet implemented');
  }

  async getExpiringLeases(cuid: string, daysAhead: number): Promise<ILeaseDocument[]> {
    this.log.info(`Getting leases expiring within ${daysAhead} days for client ${cuid}`);
    throw new Error('getExpiringLeases not yet implemented');
  }

  async updateLeaseStatus(cuid: string, leaseId: string, status: LeaseStatus): Promise<boolean> {
    this.log.info(`Updating status for lease ${leaseId} to ${status}`);
    throw new Error('updateLeaseStatus not yet implemented');
  }

  async terminateLease(
    cuid: string,
    leaseId: string,
    _terminationData: {
      terminationDate: Date;
      terminationReason: string;
      moveOutDate?: Date;
      notes?: string;
    }
  ): Promise<ILeaseDocument | null> {
    this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);
    throw new Error('terminateLease not yet implemented');
  }

  async getLeaseStats(cuid: string, filters?: FilterQuery<ILeaseDocument>): Promise<ILeaseStats> {
    this.log.info(`Getting lease stats for client ${cuid}`, { filters });
    throw new Error('getLeaseStats not yet implemented');
  }

  async getRentRollData(cuid: string, propertyId?: string): Promise<IRentRollItem[]> {
    this.log.info(`Getting rent roll data for client ${cuid}`, { propertyId });
    throw new Error('getRentRollData not yet implemented');
  }
}
