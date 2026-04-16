import { UserWorker } from '@workers/user.worker';
import { QUEUE_NAMES, JOB_NAME } from '@utils/constants';

import { BaseQueue } from './base.queue';

export interface IVendorTeamDisconnectJobData {
  /** MongoDB _id of the primary vendor user (used to fetch linked team members) */
  primaryVendorUserId: string;
  /** Human-readable client name for the disconnection email */
  companyName: string;
  /** Vendor document MongoDB _id — for updating Vendor.connectedClients */
  vendorId: string;
  /** Client MongoDB _id string */
  clientId: string;
  /** Client being disconnected from */
  cuid: string;
}

interface IConstructor {
  userWorker: UserWorker;
}

export class UserQueue extends BaseQueue {
  private readonly userWorker: UserWorker;

  constructor({ userWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.USER_QUEUE });
    this.userWorker = userWorker;

    this.processQueueJobs(
      JOB_NAME.VENDOR_TEAM_DISCONNECT_JOB,
      2,
      this.userWorker.handleVendorTeamDisconnect
    );
  }

  async addVendorTeamDisconnectJob(data: IVendorTeamDisconnectJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.VENDOR_TEAM_DISCONNECT_JOB, data, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 10000 },
    });
  }
}
