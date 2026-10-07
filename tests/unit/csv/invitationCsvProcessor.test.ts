import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { InvitationCsvProcessor } from '@services/csv/invitationCsvProcessor';
import { InvitationValidations } from '@shared/validations/InvitationValidation';
import { INVITATION_IMPORTABLE_FIELDS } from '@services/csv/invitationImportFields';

describe('InvitationCsvProcessor', () => {
  let processor: InvitationCsvProcessor;
  let mockInvitationDAO: any;
  let mockClientDAO: any;
  let mockVendorDAO: any;
  let mockUserDAO: any;
  const cuid = 'test-client-cuid';
  const userId = new Types.ObjectId().toString();

  beforeEach(() => {
    mockInvitationDAO = {
      findPendingInvitation: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        id: 'client-id',
        cuid,
        isVerified: true,
      }),
    };
    mockVendorDAO = { getVendorByVuid: jest.fn() };
    mockUserDAO = { getUserWithClientAccess: jest.fn().mockResolvedValue(null) };

    processor = new InvitationCsvProcessor({
      invitationDAO: mockInvitationDAO,
      clientDAO: mockClientDAO,
      vendorDAO: mockVendorDAO,
      userDAO: mockUserDAO,
    });
  });

  it('accepts exactly the columns the CSV schema validates (import fields and schema stay in sync)', () => {
    const schemaKeys = Object.keys(
      (InvitationValidations.invitationCsv as any)._def.schema.shape
    ).filter((key) => key !== 'cuid');

    expect(INVITATION_IMPORTABLE_FIELDS.map((f) => f.key).sort()).toEqual(schemaKeys.sort());
  });

  describe('header transformer — columnMapping', () => {
    const transform = (header: string, mapping?: Record<string, string>) =>
      (processor as any).createInvitationHeaderTransformer(mapping)({ header });

    it('uses the user-confirmed mapping first', () => {
      expect(transform('Work Email', { 'Work Email': 'inviteeEmail' })).toBe('inviteeEmail');
    });

    it('ignores a mapping to an unknown field', () => {
      expect(transform('Password', { Password: 'password' })).toBeNull();
    });

    it('falls back to a case-insensitive exact match', () => {
      expect(transform(' FIRSTNAME ')).toBe('firstName');
    });

    it('drops columns it does not recognise', () => {
      expect(transform('Favourite colour')).toBeNull();
    });
  });

  describe('required headers', () => {
    const validate = (headers: string[]) => (processor as any).validateRequiredHeaders(headers);

    it('does not require a status column (defaults to pending)', () => {
      expect(validate(['inviteeEmail', 'firstName', 'lastName', 'role']).isValid).toBe(true);
    });

    it('names the missing required columns', () => {
      const result = validate(['inviteeEmail', 'firstName']);
      expect(result.isValid).toBe(false);
      expect(result.missingHeaders).toEqual(['lastName', 'role']);
    });
  });

  describe('template', () => {
    it('passes its own header validation', () => {
      const headerLine = processor.generateTemplateCsv().split('\n')[0];
      expect((processor as any).validateRequiredHeaders(headerLine.split(',')).isValid).toBe(true);
    });

    it('only uses accepted columns', () => {
      const accepted = processor.getAcceptedHeaders();
      processor.getTemplateHeaders().forEach((header) => expect(accepted).toContain(header));
    });
  });

  describe('end-to-end validateCsv against a real file', () => {
    let tmpDir: string;
    const writeCsv = (lines: string[]) => {
      const csvPath = path.join(tmpDir, 'users.csv');
      fs.writeFileSync(csvPath, lines.join('\n'));
      return csvPath;
    };

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invitation-csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('validates the downloadable template as-is', async () => {
      const csvPath = path.join(tmpDir, 'template.csv');
      fs.writeFileSync(csvPath, processor.generateTemplateCsv());

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.errors).toBeNull();
      expect(result.validInvitations).toHaveLength(3);
    });

    it('applies a column mapping, accepts accented names and keeps row numbers', async () => {
      const csvPath = writeCsv([
        'E-mail,Given name,Surname,Type',
        'amelie@example.com,Amélie,Côté,tenant',
      ]);

      const result = await processor.validateCsv(csvPath, {
        cuid,
        userId,
        columnMapping: {
          'E-mail': 'inviteeEmail',
          'Given name': 'firstName',
          Surname: 'lastName',
          Type: 'role',
        },
      });

      expect(result.errors).toBeNull();
      expect(result.validInvitations[0]).toEqual(
        expect.objectContaining({
          inviteeEmail: 'amelie@example.com',
          status: 'pending',
          csvRowNumber: 1,
          personalInfo: expect.objectContaining({ firstName: 'Amélie', lastName: 'Côté' }),
        })
      );
    });

    it('flags a repeated email with the row it first appeared on', async () => {
      const csvPath = writeCsv([
        'inviteeEmail,firstName,lastName,role',
        'dup@example.com,Jane,Doe,staff',
        'other@example.com,John,Roe,tenant',
        'DUP@example.com,Janet,Doe,tenant',
      ]);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.validInvitations).toHaveLength(2);
      expect(result.errors).toEqual([
        {
          rowNumber: 3,
          errors: [{ field: 'inviteeEmail', error: expect.stringContaining('1') }],
        },
      ]);
    });

    it('never accepts account-owner roles', async () => {
      const csvPath = writeCsv([
        'inviteeEmail,firstName,lastName,role',
        'boss@example.com,Big,Boss,super-admin',
        'root@example.com,Root,User,root-admin',
      ]);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.validInvitations).toHaveLength(0);
      expect(result.errors?.map((e) => e.errors[0].field)).toEqual(['role', 'role']);
    });

    it('reports bad values against their column instead of "unknown"', async () => {
      const csvPath = writeCsv([
        'inviteeEmail,firstName,lastName,role,employeeInfo_department',
        'tech@example.com,Tech,Person,staff,plumbing-dept',
      ]);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.errors?.[0].errors[0].field).toBe('employeeInfo_department');
    });

    it('treats short rows (missing trailing cells) as blank, not invalid', async () => {
      const csvPath = writeCsv([
        'inviteeEmail,firstName,lastName,role,phoneNumber,inviteMessage',
        'short@example.com,Short,Row,tenant',
      ]);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.errors).toBeNull();
      expect(result.validInvitations).toHaveLength(1);
    });

    it('rejects the whole file when a required column is missing', async () => {
      const csvPath = writeCsv(['inviteeEmail,firstName,lastName', 'x@example.com,X,Y']);

      await expect(processor.validateCsv(csvPath, { cuid, userId })).rejects.toThrow('role');
    });

    it('applies the unverified-account tenant cap with row numbers', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: new Types.ObjectId(),
        id: 'client-id',
        cuid,
        isVerified: false,
      });
      mockInvitationDAO.countDocuments.mockResolvedValue(4);
      const csvPath = writeCsv([
        'inviteeEmail,firstName,lastName,role',
        't1@example.com,Tee,One,tenant',
        't2@example.com,Tee,Two,tenant',
      ]);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.validInvitations.map((i) => i.inviteeEmail)).toEqual(['t1@example.com']);
      expect(result.errors).toEqual([
        { rowNumber: 2, errors: [{ field: 'role', error: expect.any(String) }] },
      ]);
    });
  });
});
