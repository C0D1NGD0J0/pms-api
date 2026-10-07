import { Types } from 'mongoose';
import { EmailWorker } from '@workers/email.worker';
import { MailType } from '@interfaces/utils.interface';

describe('EmailWorker — recipient preferences', () => {
  const sendMail = jest.fn().mockResolvedValue(undefined);
  const getActiveUserByEmail = jest.fn();
  const getUserNotificationPreferences = jest.fn();
  const worker = new EmailWorker({
    mailerService: { sendMail } as any,
    emitterService: { emit: jest.fn() } as any,
    profileService: { getUserNotificationPreferences } as any,
    userDAO: { getActiveUserByEmail } as any,
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
});
