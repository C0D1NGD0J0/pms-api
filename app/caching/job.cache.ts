import { ISuccessReturnData } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export interface UserJob {
  jobType: 'unit_batch_creation' | 'property_csv_import' | 'media_upload' | 'document_processing';
  metadata?: Record<string, any>; // Optional job-specific data
  addedAt: string; // ISO timestamp
  userId: string;
  jobId: string;
}

export class JobCache extends BaseCache {
  constructor() {
    super('JobCache');
  }

  /**
   * Add a job to user's active jobs set
   * @param userId User ID
   * @param jobId Job ID from queue
   * @param jobType Type of job
   * @param ttl Time to live in seconds (default 1 hour)
   * @param metadata Optional job-specific metadata
   */
  async addUserJob(
    userId: string,
    jobId: string,
    jobType: UserJob['jobType'],
    ttl = 3600,
    metadata?: Record<string, any>
  ): Promise<ISuccessReturnData> {
    try {
      const userJobsKey = `user:${userId}:jobs`;

      const jobData: UserJob = {
        jobId,
        jobType,
        userId,
        addedAt: new Date().toISOString(),
        ...(metadata && { metadata }),
      };

      // store job data as a hash
      const jobKey = `job:${jobId}:data`;
      await this.setObject(jobKey, jobData, ttl);

      // add job ID to user's job set
      await this.client.sAdd(userJobsKey, jobId);
      await this.client.expire(userJobsKey, ttl);

      this.log.info(`Added job ${jobId} for user ${userId} with type ${jobType}`);

      return {
        success: true,
        data: { jobId, jobType },
      };
    } catch (error: any) {
      return this.handleError(error, `addUserJob(${userId}, ${jobId})`);
    }
  }

  /**
   * Get all active jobs for a user
   * @param userId User ID
   * @returns Array of user jobs with their current data
   */
  async getUserJobs(userId: string): Promise<ISuccessReturnData<UserJob[]>> {
    try {
      const userJobsKey = `user:${userId}:jobs`;
      const jobIds = await this.client.sMembers(userJobsKey);

      if (!jobIds || jobIds.length === 0) {
        return {
          success: true,
          data: [],
        };
      }

      const jobs: UserJob[] = [];
      const invalidJobIds: string[] = [];

      for (const jobId of jobIds) {
        const jobKey = `job:${jobId}:data`;
        const jobResult = await this.getObject<UserJob>(jobKey);

        if (jobResult.success && jobResult.data) {
          jobs.push(jobResult.data);
        } else {
          invalidJobIds.push(jobId);
        }
      }

      if (invalidJobIds.length > 0) {
        await this.cleanupUserJobs(userId, invalidJobIds);
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
   * Remove a job from user's active jobs
   * @param userId User ID
   * @param jobId Job ID to remove
   */
  async removeUserJob(userId: string, jobId: string): Promise<ISuccessReturnData> {
    try {
      const userJobsKey = `user:${userId}:jobs`;
      const jobKey = `job:${jobId}:data`;

      const removedFromSet = await this.client.sRem(userJobsKey, jobId);
      await this.deleteItems([jobKey]);

      this.log.info(`Removed job ${jobId} for user ${userId}`);
      return {
        success: removedFromSet > 0,
        data: { jobId, removed: removedFromSet > 0 },
      };
    } catch (error: any) {
      return this.handleError(error, `removeUserJob(${userId}, ${jobId})`);
    }
  }

  /**
   * Bulk cleanup of invalid job IDs from user's job set
   * @param userId User ID
   * @param invalidJobIds Array of job IDs to remove
   */
  async cleanupUserJobs(userId: string, invalidJobIds: string[]): Promise<ISuccessReturnData> {
    try {
      if (!invalidJobIds || invalidJobIds.length === 0) {
        return { success: true, data: { cleanedCount: 0 } };
      }

      const userJobsKey = `user:${userId}:jobs`;

      // Remove invalid job IDs one by one to avoid Redis argument issues
      let removedCount = 0;
      for (const jobId of invalidJobIds) {
        const removed = await this.client.sRem(userJobsKey, jobId);
        removedCount += removed;
      }

      this.log.info(`Cleaned up ${removedCount} invalid jobs for user ${userId}`);

      return {
        success: true,
        data: { cleanedCount: removedCount },
      };
    } catch (error: any) {
      return this.handleError(error, `cleanupUserJobs(${userId})`);
    }
  }

  /**
   * Update job metadata
   * @param jobId Job ID
   * @param metadata New metadata to merge
   */
  async updateJobMetadata(
    jobId: string,
    metadata: Record<string, any>
  ): Promise<ISuccessReturnData> {
    try {
      const jobKey = `job:${jobId}:data`;
      const jobResult = await this.getObject<UserJob>(jobKey);

      if (!jobResult.success || !jobResult.data) {
        return {
          success: false,
          data: null,
          error: 'Job not found',
        };
      }

      const updatedJob: UserJob = {
        ...jobResult.data,
        metadata: {
          ...jobResult.data.metadata,
          ...metadata,
        },
      };

      await this.setObject(jobKey, updatedJob);

      return {
        success: true,
        data: { jobId, metadata },
      };
    } catch (error: any) {
      return this.handleError(error, `updateJobMetadata(${jobId})`);
    }
  }

  /**
   * Get total count of active jobs for a user
   * @param userId User ID
   */
  async getUserJobCount(userId: string): Promise<ISuccessReturnData<number>> {
    try {
      const userJobsKey = `user:${userId}:jobs`;
      const count = await this.client.sCard(userJobsKey);

      return {
        success: true,
        data: count,
      };
    } catch (error: any) {
      return this.handleError(error, `getUserJobCount(${userId})`);
    }
  }
}
