/**
 * Shared test utility helpers
 */

/**
 * Creates a mock Express.Multer.File object for use in tests
 */
export const createMockMulterFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File => ({
  fieldname: 'file',
  originalname: 'test-file.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: Buffer.from('mock file content'),
  size: 1024,
  destination: '',
  filename: 'test-file.pdf',
  path: '',
  stream: null as any,
  ...overrides,
});
