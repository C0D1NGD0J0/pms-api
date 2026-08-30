const mockFindFirst = jest.fn();

jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      inspectionDAO: { findFirst: mockFindFirst },
      clientDAO: { findFirst: jest.fn().mockResolvedValue({ cuid: 'valid-cuid' }) },
    },
  },
}));

import { UtilsValidations } from '@shared/validations/UtilsValidation';

describe('ValidateIuidSchema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should accept valid iuid that exists in DB', async () => {
    mockFindFirst.mockResolvedValue({ iuid: 'INS-12345', cuid: 'client-1' });

    const result = await UtilsValidations.iuid.safeParseAsync({ iuid: 'INS-12345' });

    expect(result.success).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith({ iuid: 'INS-12345', deletedAt: null });
  });

  it('should reject iuid that does not exist in DB', async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await UtilsValidations.iuid.safeParseAsync({ iuid: 'INS-NONEXISTENT' });

    expect(result.success).toBe(false);
  });

  it('should reject empty iuid', async () => {
    const result = await UtilsValidations.iuid.safeParseAsync({ iuid: '' });

    expect(result.success).toBe(false);
  });

  it('should work with cuid.merge(iuid) for combined param validation', async () => {
    mockFindFirst.mockResolvedValue({ iuid: 'INS-12345' });

    const combined = UtilsValidations.cuid.merge(UtilsValidations.iuid);
    const result = await combined.safeParseAsync({ cuid: 'valid-cuid', iuid: 'INS-12345' });

    expect(result.success).toBe(true);
  });
});
