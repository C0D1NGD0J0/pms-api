import { ISuccessReturnData } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export interface TrackedJob {
  jobType:
    | 'unit_batch_creation'
    | 'property_csv_import'
    | 'property_csv_validation'
    | 'media_upload'
    | 'document_processing';
  metadata?: Record<string, any>;
  createdAt: Date;
  userId: string;
  jobId: string;
}

export class JobTracker extends BaseCache {
  private static readonly TTL_HOURS = 2;
  private static readonly TTL_SECONDS = JobTracker.TTL_HOURS * 60 * 60; // 7200 seconds

  constructor() {
    super('JobTracker');
  }

  /**
   * Track a job for a user
   * @param userId User ID
   * @param jobId Job ID from queue
   * @param jobType Type of job
   * @param metadata Optional job-specific metadata
   */
  async trackJob(
    userId: string,
    jobId: string,
    jobType: TrackedJob['jobType'],
    metadata?: Record<string, any>
  ): Promise<ISuccessReturnData> {
    try {
      const userJobsKey = `user:${userId}:jobs`;

      const jobData: TrackedJob = {
        jobId,
        jobType,
        userId,
        createdAt: new Date(),
        ...(metadata && { metadata }),
      };

      // Store job data as a hash
      const jobKey = `job:${jobId}:data`;
      await this.setObject(jobKey, jobData, JobTracker.TTL_SECONDS);

      // Add job ID to user's job set
      await this.client.sAdd(userJobsKey, jobId);
      await this.client.expire(userJobsKey, JobTracker.TTL_SECONDS);

      this.log.info(`Tracked job ${jobId} for user ${userId} with type ${jobType}`);

      return {
        success: true,
        data: { jobId, jobType },
      };
    } catch (error: any) {
      return this.handleError(error, `trackJob(${userId}, ${jobId})`);
    }
  }

  /**
   * Get all active jobs for a user with automatic cleanup
   * @param userId User ID
   * @returns Array of user jobs
   */
  async getUserJobs(userId: string): Promise<ISuccessReturnData<TrackedJob[]>> {
    try {
      const userJobsKey = `user:${userId}:jobs`;
      const jobIds = await this.client.sMembers(userJobsKey);

      if (!jobIds || jobIds.length === 0) {
        return {
          success: true,
          data: [],
        };
      }

      const jobs: TrackedJob[] = [];
      const expiredJobIds: string[] = [];

      for (const jobId of jobIds) {
        const jobKey = `job:${jobId}:data`;
        const jobResult = await this.getObject<TrackedJob>(jobKey);

        if (jobResult.success && jobResult.data) {
          jobs.push(jobResult.data);
        } else {
          expiredJobIds.push(jobId);
        }
      }

      // Auto-cleanup expired jobs
      if (expiredJobIds.length > 0) {
        await this.removeExpiredJobs(userId, expiredJobIds);
      }

      return {
        success: true,
        data: jobs,
      };
    } catch (error: any) {
      return this.handleError(error, `getUserJobs(${userId})`);
    }
  }

  /**
   * Remove completed jobs for a user
   * @param userId User ID
   * @param jobIds Array of job IDs to remove
   */
  async removeCompletedJobs(userId: string, jobIds: string[]): Promise<ISuccessReturnData> {
    try {
      if (!jobIds || jobIds.length === 0) {
        return { success: true, data: { removedCount: 0 } };
      }

      const userJobsKey = `user:${userId}:jobs`;
      let removedCount = 0;

      for (const jobId of jobIds) {
        const jobKey = `job:${jobId}:data`;
        const removed = await this.client.sRem(userJobsKey, jobId);
        await this.deleteItems([jobKey]);
        removedCount += removed;
      }

      this.log.info(`Removed ${removedCount} completed jobs for user ${userId}`);

      return {
        success: true,
        data: { removedCount },
      };
    } catch (error: any) {
      return this.handleError(error, `removeCompletedJobs(${userId})`);
    }
  }

  /**
   * Private method to remove expired job IDs from user's job set
   */
  private async removeExpiredJobs(userId: string, expiredJobIds: string[]): Promise<void> {
    try {
      const userJobsKey = `user:${userId}:jobs`;

      for (const jobId of expiredJobIds) {
        await this.client.sRem(userJobsKey, jobId);
      }

      this.log.info(`Auto-cleaned ${expiredJobIds.length} expired jobs for user ${userId}`);
    } catch (error: any) {
      this.log.error(`Error removing expired jobs for user ${userId}:`, error);
    }
  }

  /**
   * Get job count for a user
   * @param userId User ID
   */
  async getJobCount(userId: string): Promise<ISuccessReturnData<number>> {
    try {
      const userJobsKey = `user:${userId}:jobs`;
      const count = await this.client.sCard(userJobsKey);

      return {
        success: true,
        data: count,
      };
    } catch (error: any) {
      return this.handleError(error, `getJobCount(${userId})`);
    }
  }
}
