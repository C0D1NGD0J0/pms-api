import { EventEmitter } from 'events';

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockConnection = Object.assign(new EventEmitter(), { readyState: 1, close: jest.fn() });

jest.mock('mongoose', () => ({
  __esModule: true,
  default: { set: jest.fn(), connect: jest.fn(), connection: mockConnection },
}));
jest.mock('@utils/helpers', () => ({ createLogger: () => mockLog }));
jest.mock('@utils/retryAsync', () => ({ retryAsync: (fn: () => Promise<unknown>) => fn() }));
jest.mock('@database/syncIndexes', () => ({ syncAllIndexes: jest.fn() }));

import { DatabaseService } from '@database/db-setup';

describe('DatabaseService disconnect logging', () => {
  let service: DatabaseService;
  let redisService: { connect: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConnection.removeAllListeners();
    mockConnection.close.mockImplementation(async () => {
      mockConnection.emit('disconnected');
    });
    redisService = { connect: jest.fn().mockResolvedValue({ success: true }) };
    service = new DatabaseService({ redisService } as any);
    await service.connect('development');
  });

  it('logs an error when MongoDB drops unexpectedly', () => {
    mockConnection.emit('disconnected');

    expect(mockLog.error).toHaveBeenCalledWith('MongoDB disconnected unexpectedly');
    expect(service.isConnected()).toBe(false);
  });

  it('does not log an error when disconnect() closes the connection', async () => {
    await service.disconnect('development');

    expect(mockLog.error).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledWith('Disconnected from development database');
  });

  it('logs unexpected drops again after reconnecting', async () => {
    await service.disconnect('development');
    await service.connect('development');

    mockConnection.emit('disconnected');

    expect(mockConnection.listenerCount('disconnected')).toBe(1);
    expect(mockLog.error).toHaveBeenCalledTimes(1);
    expect(mockLog.error).toHaveBeenCalledWith('MongoDB disconnected unexpectedly');
  });

  it('still logs unexpected drops when a reconnect fails after MongoDB opened', async () => {
    await service.disconnect('development');
    redisService.connect.mockResolvedValueOnce({ success: false, error: 'Redis down' });
    await expect(service.connect('development')).rejects.toThrow('Redis down');
    mockLog.error.mockClear();

    mockConnection.emit('disconnected');

    expect(mockLog.error).toHaveBeenCalledWith('MongoDB disconnected unexpectedly');
  });
});
