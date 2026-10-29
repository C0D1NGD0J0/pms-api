import { Types } from 'mongoose';
import { EmailWorker } from '@workers/email.worker';
import { MailType } from '@interfaces/utils.interface';

describe('EmailWorker — recipient preferences', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const getActiveUserByEmail = jest.fn();
  const getUserNotificationPreferences = jest.fn();
  const findById = jest.fn();
  const emit = jest.fn();
  const worker = new EmailWorker({
    mailerService: { sendMail } as any,
    emitterService: { emit } as any,
    profileService: { getUserNotificationPreferences } as any,
    userDAO: { getActiveUserByEmail } as any,
    invitationDAO: { findById } as any,
  });

  const job = (emailType: MailType, to = 'Tenant@Example.com') =>
    ({
      id: 'job-1',
      name: 'email',
      data: { to, emailType, client: { cuid: 'c1' } },
      progress: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    getActiveUserByEmail.mockResolvedValue({ _id: new Types.ObjectId() });
  });

  it('skips an optional email when its category is switched off', async () => {
    getUserNotificationPreferences.mockResolvedValue({
      success: true,
      data: { emailNotifications: true, maintenance: false },
    });

    const result = await worker.sendMail(job(MailType.MAINTENANCE_REQUEST_COMPLETED));

    expect(result).toEqual(expect.objectContaining({ skipped: true }));
    expect(sendMail).not.toHaveBeenCalled();
    expect(getActiveUserByEmail).toHaveBeenCalledWith('tenant@example.com');
  });

  it('skips optional emails when the email channel is off', async () => {
    getUserNotificationPreferences.mockResolvedValue({
      success: true,
      data: { emailNotifications: false, maintenance: true },
    });

    await worker.sendMail(job(MailType.MAINTENANCE_REQUEST_ACCEPTED));

    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends an optional email when the category is on', async () => {
    getUserNotificationPreferences.mockResolvedValue({
      success: true,
      data: { emailNotifications: true, maintenance: true },
    });

    await worker.sendMail(job(MailType.MAINTENANCE_REQUEST_COMPLETED));

    expect(sendMail).toHaveBeenCalled();
  });

  it('always sends required emails without looking at preferences', async () => {
    await worker.sendMail(job(MailType.PAYMENT_FAILED));

    expect(sendMail).toHaveBeenCalled();
    expect(getActiveUserByEmail).not.toHaveBeenCalled();
  });

  it('sends to people who are not users', async () => {
    getActiveUserByEmail.mockResolvedValue(null);

    await worker.sendMail(job(MailType.MAINTENANCE_REQUEST_COMPLETED, 'visitor@example.com'));

    expect(sendMail).toHaveBeenCalled();
  });

  describe('invitation emails', () => {
    const invitationJob = (invitationId: string) =>
      ({
        id: 'job-2',
        name: 'invitationJob',
        data: { to: 'new@example.com', emailType: MailType.INVITATION, invitationId },
        progress: jest.fn(),
      }) as any;

    it('does not send an invitation revoked while its email was queued', async () => {
      findById.mockResolvedValue({ status: 'revoked' });

      const result = await worker.sendMail(invitationJob('inv-1'));

      expect(result).toEqual(expect.objectContaining({ skipped: true }));
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('marks only the last failed attempt as final', async () => {
      findById.mockResolvedValue({ status: 'pending' });
      sendMail.mockRejectedValue(new Error('550 Too many emails per second'));
      const failingJob = (attemptsMade: number) => ({
        ...invitationJob('inv-3'),
        attemptsMade,
        opts: { attempts: 3 },
      });

      await expect(worker.sendMail(failingJob(0))).rejects.toThrow();
      await expect(worker.sendMail(failingJob(2))).rejects.toThrow();

      const finals = emit.mock.calls.map(([, payload]) => payload.final);
      expect(finals).toEqual([false, true]);
      sendMail.mockResolvedValue(undefined);
    });

    it('sends an invitation that is still pending', async () => {
      findById.mockResolvedValue({ status: 'pending' });

      await worker.sendMail(invitationJob('inv-2'));

      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });
});
