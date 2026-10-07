import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { InvitationWorker } from '@workers/invitation.worker';

describe('InvitationWorker — CSV jobs', () => {
  let worker: InvitationWorker;
  let mockSubscriptionService: any;
  let mockInvitationCsvProcessor: any;
  let mockInvitationService: any;
  let mockSSEService: any;

  const testCuid = 'test-client-cuid';
  const testUserId = new Types.ObjectId().toString();

  const makeJob = (overrides = {}) =>
    ({
      id: 'job-123',
      data: {
        csvFilePath: '/tmp/test-invitations.csv',
        clientInfo: { cuid: testCuid, clientDisplayName: 'Test Co', id: 'client-id' },
        userId: testUserId,
        ...overrides,
      },
      progress: jest.fn(),
    }) as any;

  const row = (email: string, role: string, csvRowNumber: number) => ({
    inviteeEmail: email,
    role,
    status: 'pending',
    personalInfo: { firstName: 'Test', lastName: 'User' },
    metadata: {},
    csvRowNumber,
  });

  const lastNotification = () => mockSSEService.sendToUser.mock.calls.at(-1)[2];

  beforeEach(() => {
    mockSubscriptionService = { getAvailableSeats: jest.fn() };
    mockInvitationCsvProcessor = { validateCsv: jest.fn() };
    mockInvitationService = { dispatchInvitation: jest.fn().mockResolvedValue({ success: true }) };
    mockSSEService = { sendToUser: jest.fn().mockResolvedValue(undefined) };

    worker = new InvitationWorker({
      subscriptionService: mockSubscriptionService,
      invitationCsvProcessor: mockInvitationCsvProcessor,
      invitationService: mockInvitationService,
      emitterService: { emit: jest.fn(), on: jest.fn() },
      sseService: mockSSEService,
    } as any);
  });

  afterEach(() => jest.clearAllMocks());

  describe('processCsvImport', () => {
    it('sends every row through the shared dispatch, without the CSV row number', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [row('a@test.com', ROLES.TENANT, 1), row('b@test.com', ROLES.VENDOR, 2)],
        totalRows: 2,
        errors: null,
      });

      const result = await worker.processCsvImport(makeJob());

      expect(mockInvitationService.dispatchInvitation).toHaveBeenCalledTimes(2);
      const [inviterId, cuid, data] = mockInvitationService.dispatchInvitation.mock.calls[0];
      expect(inviterId).toBe(testUserId);
      expect(cuid).toBe(testCuid);
      expect(data).not.toHaveProperty('csvRowNumber');
      expect(result.createdCount).toBe(2);
      expect(lastNotification()).toEqual(
        expect.objectContaining({
          jobId: 'job-123',
          jobType: 'csv_invitation_import',
          stage: 'completed',
          totalRows: 2,
          createdCount: 2,
          errorCount: 0,
          errors: [],
        })
      );
    });

    it('passes the column mapping to the CSV reader', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [row('a@test.com', ROLES.TENANT, 1)],
        totalRows: 1,
        errors: null,
      });
      const columnMapping = { 'E-mail': 'inviteeEmail' };

      await worker.processCsvImport(makeJob({ columnMapping }));

      expect(mockInvitationCsvProcessor.validateCsv).toHaveBeenCalledWith(
        '/tmp/test-invitations.csv',
        expect.objectContaining({ columnMapping })
      );
    });

    it('trims employee rows beyond free seats and reports them against their rows', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [
          row('admin1@test.com', ROLES.ADMIN, 1),
          row('admin2@test.com', ROLES.ADMIN, 2),
          row('tenant@test.com', ROLES.TENANT, 3),
          row('admin3@test.com', ROLES.STAFF, 4),
        ],
        totalRows: 4,
        errors: null,
      });
      mockSubscriptionService.getAvailableSeats.mockResolvedValue({
        availableSeats: 1,
        totalAllowed: 5,
      });

      await worker.processCsvImport(makeJob());

      const dispatched = mockInvitationService.dispatchInvitation.mock.calls.map(
        (call: any[]) => call[2].inviteeEmail
      );
      expect(dispatched).toEqual(['admin1@test.com', 'tenant@test.com']);
      const notification = lastNotification();
      expect(notification.createdCount).toBe(2);
      expect(notification.errors.map((e: any) => e.rowNumber)).toEqual([2, 4]);
      expect(notification.errors[0].errors[0].field).toBe('role');
    });

    it('does not check seats when the file has no employee rows', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [row('t@test.com', ROLES.TENANT, 1)],
        totalRows: 1,
        errors: null,
      });

      await worker.processCsvImport(makeJob());

      expect(mockSubscriptionService.getAvailableSeats).not.toHaveBeenCalled();
    });

    it('records a failed send as a row error and keeps going', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [
          row('me@test.com', ROLES.TENANT, 3),
          row('ok@test.com', ROLES.TENANT, 5),
        ],
        totalRows: 5,
        errors: [
          { rowNumber: 1, errors: [{ field: 'role', error: 'Please provide a valid role' }] },
        ],
      });
      mockInvitationService.dispatchInvitation
        .mockRejectedValueOnce(new Error("You can't send an invitation to yourself"))
        .mockResolvedValueOnce({ success: true });

      await worker.processCsvImport(makeJob());

      const notification = lastNotification();
      expect(notification.stage).toBe('completed');
      expect(notification.createdCount).toBe(1);
      expect(notification.errorCount).toBe(2);
      expect(notification.errors).toEqual([
        expect.objectContaining({ rowNumber: 1 }),
        {
          rowNumber: 3,
          errors: [{ field: 'inviteeEmail', error: "You can't send an invitation to yourself" }],
        },
      ]);
    });

    it('fails the job, with the validation errors, when no row is valid', async () => {
      const errors = [{ rowNumber: 1, errors: [{ field: 'inviteeEmail', error: 'Required' }] }];
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [],
        totalRows: 1,
        errors,
      });

      await worker.processCsvImport(makeJob());

      expect(mockInvitationService.dispatchInvitation).not.toHaveBeenCalled();
      expect(lastNotification()).toEqual(
        expect.objectContaining({ stage: 'failed', createdCount: 0, errorCount: 1, errors })
      );
    });

    it('tells the user when the seat check itself fails, and sends nothing', async () => {
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [row('admin@test.com', ROLES.ADMIN, 1)],
        totalRows: 1,
        errors: null,
      });
      mockSubscriptionService.getAvailableSeats.mockRejectedValue(new Error('Stripe down'));

      const result = await worker.processCsvImport(makeJob());

      expect(result.success).toBe(false);
      expect(mockInvitationService.dispatchInvitation).not.toHaveBeenCalled();
      expect(lastNotification()).toEqual(
        expect.objectContaining({ jobType: 'csv_invitation_import', stage: 'failed' })
      );
    });
  });

  describe('processCsvValidation', () => {
    it('includes the row errors alongside the valid count', async () => {
      const errors = [{ rowNumber: 2, errors: [{ field: 'firstName', error: 'Required' }] }];
      mockInvitationCsvProcessor.validateCsv.mockResolvedValue({
        validInvitations: [row('a@test.com', ROLES.TENANT, 1)],
        totalRows: 2,
        errors,
        finishedAt: new Date(),
      });

      await worker.processCsvValidation(makeJob());

      expect(lastNotification()).toEqual(
        expect.objectContaining({
          jobType: 'csv_invitation_validation',
          stage: 'completed',
          totalRows: 2,
          validCount: 1,
          errorCount: 1,
          errors,
        })
      );
      expect(mockInvitationService.dispatchInvitation).not.toHaveBeenCalled();
    });

    it('reports a header problem to the user instead of failing silently', async () => {
      mockInvitationCsvProcessor.validateCsv.mockRejectedValue(
        new Error('Missing required columns: role')
      );

      await expect(worker.processCsvValidation(makeJob())).rejects.toThrow(
        'Missing required columns: role'
      );
      expect(lastNotification()).toEqual(
        expect.objectContaining({
          jobType: 'csv_invitation_validation',
          stage: 'failed',
          error: 'Missing required columns: role',
        })
      );
    });
  });
});
