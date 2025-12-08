import { ClientDAO } from '@dao/index';
import { ValidateCuidAndLeaseIdSchema } from '@shared/validations/UtilsValidation';

// Mock the container
jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      clientDAO: {
        findFirst: jest.fn(),
      },
    },
  },
}));

describe('ValidateCuidAndLeaseIdSchema', () => {
  let mockClientDAO: jest.Mocked<ClientDAO>;

  beforeEach(async () => {
    const { container } = await import('@di/setup');
    mockClientDAO = container.cradle.clientDAO as jest.Mocked<ClientDAO>;
    jest.clearAllMocks();
  });

  it('should validate valid cuid and leaseId', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    const result = await ValidateCuidAndLeaseIdSchema.parseAsync({
      cuid: 'MMQHHVX09JJT',
      leaseId: '507f1f77bcf86cd799439011',
    });

    expect(result).toEqual({
      cuid: 'MMQHHVX09JJT',
      leaseId: '507f1f77bcf86cd799439011',
    });
  });

  it('should reject invalid cuid', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);

    await expect(
      ValidateCuidAndLeaseIdSchema.parseAsync({
        cuid: 'INVALID_CUID',
        leaseId: '507f1f77bcf86cd799439011',
      })
    ).rejects.toThrow();
  });

  it('should reject missing cuid', async () => {
    await expect(
      ValidateCuidAndLeaseIdSchema.parseAsync({
        leaseId: '507f1f77bcf86cd799439011',
      } as any)
    ).rejects.toThrow();
  });

  it('should reject missing leaseId', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    await expect(
      ValidateCuidAndLeaseIdSchema.parseAsync({
        cuid: 'MMQHHVX09JJT',
      } as any)
    ).rejects.toThrow();
  });

  it('should reject empty leaseId', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    await expect(
      ValidateCuidAndLeaseIdSchema.parseAsync({
        cuid: 'MMQHHVX09JJT',
        leaseId: '',
      })
    ).rejects.toThrow();
  });

  it('should accept leaseId as ObjectId string', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    const result = await ValidateCuidAndLeaseIdSchema.parseAsync({
      cuid: 'MMQHHVX09JJT',
      leaseId: '507f1f77bcf86cd799439011',
    });

    expect(result.leaseId).toBe('507f1f77bcf86cd799439011');
  });

  it('should accept leaseId as luid string', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    const result = await ValidateCuidAndLeaseIdSchema.parseAsync({
      cuid: 'MMQHHVX09JJT',
      leaseId: 'L-2025-ABC123',
    });

    expect(result.leaseId).toBe('L-2025-ABC123');
  });

  it('should preserve both params in validated output', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: 'MMQHHVX09JJT' } as any);

    const result = await ValidateCuidAndLeaseIdSchema.parseAsync({
      cuid: 'MMQHHVX09JJT',
      leaseId: '507f1f77bcf86cd799439011',
    });

    expect(result).toHaveProperty('cuid');
    expect(result).toHaveProperty('leaseId');
    expect(Object.keys(result).length).toBe(2);
  });
});
