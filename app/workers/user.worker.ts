import { Job } from 'bull';
import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { UserCache } from '@caching/index';
import { createLogger } from '@utils/index';
import { JOB_NAME } from '@utils/constants';
import { EmailQueue } from '@queues/email.queue';
import { MailType } from '@interfaces/utils.interface';
import { IVendorTeamDisconnectJobData } from '@queues/user.queue';

interface IConstructor {
  emailQueue: EmailQueue;
  userCache: UserCache;
  userDAO: UserDAO;
}

export class UserWorker {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly userCache: UserCache;
  private readonly emailQueue: EmailQueue;

  constructor({ userDAO, userCache, emailQueue }: IConstructor) {
    this.log = createLogger('UserWorker');
    this.userDAO = userDAO;
    this.userCache = userCache;
    this.emailQueue = emailQueue;
  }

  /**
   * Disconnect all linked vendor team members from a client after the primary vendor is removed.
   * Runs in the background so large teams don't block the API response.
   * Arrow function to preserve `this` binding when passed as a queue callback.
   */
  handleVendorTeamDisconnect = async (job: Job<IVendorTeamDisconnectJobData>) => {
    const { primaryVendorUserId, cuid, clientId, companyName } = job.data;
    const startTime = Date.now();

    this.log.info(
      { jobId: job.id, primaryVendorUserId, cuid },
      'UserWorker: processing vendor team disconnect job'
    );

    try {
      await job.progress(10);

      const linkedUsers = await this.userDAO.getLinkedVendorUsers(primaryVendorUserId, cuid);

      await job.progress(30);

      if (linkedUsers.items.length === 0) {
        this.log.info(
          { jobId: job.id, primaryVendorUserId, cuid },
          'UserWorker: no linked team members to disconnect'
        );
        await job.progress(100);
        return { success: true, disconnected: 0, duration: Date.now() - startTime };
      }

      const disconnectedAt = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      let disconnected = 0;

      for (const linkedUser of linkedUsers.items) {
        await this.userDAO.updateById(
          linkedUser._id.toString(),
          { $set: { 'cuids.$[elem].isConnected': false } },
          { arrayFilters: [{ 'elem.cuid': cuid }] } as any
        );

        await this.userCache.invalidateUserDetail(cuid, linkedUser.uid);

        try {
          await this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_DISCONNECTED_JOB, {
            to: linkedUser.email,
            subject: 'Your Account Connection Has Been Removed',
            emailType: MailType.ACCOUNT_DISCONNECTED,
            client: { cuid, id: clientId },
            data: {
              fullname: linkedUser.fullname || linkedUser.email,
              companyName,
              disconnectedAt,
              roles: 'vendor',
            },
          });
        } catch (emailError) {
          this.log.error(
            { uid: linkedUser.uid, error: emailError },
            'UserWorker: failed to queue team member disconnection email'
          );
        }

        disconnected++;
      }

      await job.progress(100);

      const duration = Date.now() - startTime;
      this.log.info(
        { jobId: job.id, primaryVendorUserId, cuid, disconnected, duration },
        'UserWorker: vendor team disconnect job completed'
      );

      return { success: true, disconnected, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error(
        {
          jobId: job.id,
          primaryVendorUserId,
          cuid,
          attempt: job.attemptsMade + 1,
          duration,
          error: error.message,
        },
        'UserWorker: vendor team disconnect job failed'
      );

      const maxAttempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.log.error(
          { jobId: job.id, jobData: job.data },
          'UserWorker: ⚠️ ALERT — vendor team disconnect exhausted all retries'
        );
      }

      throw error;
    }
  };
}
