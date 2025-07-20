import { ClientSession } from 'mongoose';

// Client DAO Mock
export const createMockClientDAO = () => ({
  // BaseDAO methods
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn().mockImplementation(
    async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
      return await callback(session);
    }
  ),

  // ClientDAO specific methods
  getClientById: jest.fn(),
  getClientBycuid: jest.fn(),
  listClients: jest.fn(),
});

// Invitation DAO Mock
export const createMockInvitationDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn().mockImplementation(
    async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
      return await callback(session);
    }
  ),
  getInvitationById: jest.fn(),
  getInvitationsByClient: jest.fn(),
});

// Client Service Mock (when implemented)
export const createMockClientService = () => ({
  createClient: jest.fn(),
  updateClient: jest.fn(),
  deleteClient: jest.fn(),
  getClientById: jest.fn(),
  getClientByCuid: jest.fn(),
  listClients: jest.fn(),
  updateClientSettings: jest.fn(),
});

// Invitation Service Mock (when implemented)
export const createMockInvitationService = () => ({
  createInvitation: jest.fn(),
  sendInvitation: jest.fn(),
  acceptInvitation: jest.fn(),
  cancelInvitation: jest.fn(),
  getInvitationById: jest.fn(),
  getInvitationsByClient: jest.fn(),
  resendInvitation: jest.fn(),
});