import { ROLES } from '@shared/constants/roles.constants';
import { EventTypes } from '@interfaces/events.interface';
import { UploadResult } from '@interfaces/utils.interface';
import { PropertyService } from '@services/property/property.service';
import { PropertyApprovalStatusEnum } from '@interfaces/property.interface';
import { PermissionService } from '@services/permission/permission.service';
import { PropertyStatsService } from '@services/property/propertyStats.service';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { PropertyUnit, Property, Profile, Client, Lease, User } from '@models/index';
import { PropertyApprovalService } from '@services/property/propertyApproval.service';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import {
  createTestProperty,
  clearTestDatabase,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

const mockMediaUploadService = {
  handleMediaDeletion: jest.fn().mockResolvedValue(undefined),
  removeUploadedFiles: jest.fn().mockResolvedValue(undefined),
  uploadRequestFiles: jest.fn(),
} as any;

const mockNotificationService = {
  handlePropertyUpdateNotifications: jest.fn().mockResolvedValue({ success: true }),
  notifyPendingChangesOverridden: jest.fn().mockResolvedValue({ success: true }),
  notifyApprovalDecision: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCache = {
  invalidateProperty: jest.fn().mockResolvedValue({ success: true }),
  invalidatePropertyLists: jest.fn().mockResolvedValue({ success: true }),
  invalidatePropertyDetail: jest.fn().mockResolvedValue({ success: true }),
  invalidateLeaseableProperties: jest.fn().mockResolvedValue({ success: true }),
} as any;

describe('Property staff edits with file uploads (pending media)', () => {
  let propertyService: PropertyService;
  let approvalService: PropertyApprovalService;

  let client: any;
  let adminUser: any;
  let staffUser: any;
  let property: any;

  const asUser = (user: any, role: string) => ({
    sub: user._id.toString(),
    displayName: user.firstName,
    fullname: `${user.firstName} ${user.lastName}`,
    client: { cuid: client.cuid, role },
  });

  const scannedFile = { fieldName: 'images[0].file', path: '/tmp/front.png' };

  const staffEdit = (updateData: Record<string, unknown>, uploads: UploadResult[] = []) => {
    mockMediaUploadService.uploadRequestFiles.mockResolvedValueOnce(uploads);
    return propertyService.updateClientProperty(
      {
        cuid: client.cuid,
        pid: property.pid,
        currentuser: asUser(staffUser, ROLES.STAFF),
        newFiles: uploads.length ? [scannedFile] : undefined,
      } as any,
      updateData as any
    );
  };

  const imageUpload = (name: string): UploadResult => ({
    fieldName: 'images',
    resourceId: property.pid,
    resourceName: 'property',
    publicuid: `pub-${name}`,
    filename: name,
    key: `property/${name}`,
    url: `https://s3.test/property/${name}`,
    mediatype: 'image',
    actorId: staffUser._id.toString(),
  });

  const documentUpload = (name: string, documentType: string): UploadResult => ({
    fieldName: 'documents',
    resourceId: property.pid,
    resourceName: 'property',
    publicuid: `pub-${name}`,
    filename: name,
    documentName: name,
    documentType,
    key: `property/${name}`,
    url: `https://s3.test/property/${name}`,
    mediatype: 'document',
    actorId: staffUser._id.toString(),
  });

  const reload = () => Property.findById(property._id).lean() as Promise<any>;

  beforeAll(() => {
    const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });

    approvalService = new PropertyApprovalService({
      propertyDAO,
      propertyUnitDAO,
      mediaUploadService: mockMediaUploadService,
      propertyCache: mockPropertyCache,
      notificationService: mockNotificationService,
    });

    propertyService = new PropertyService({
      s3Service: {
        signFileUrls: jest.fn(async (items: any[]) => {
          items.forEach((item) => (item.url = `signed:${item.key}`));
          return items;
        }),
      } as any,
      propertyVerificationService: {} as any,
      propertyDAO,
      propertyUnitDAO,
      clientDAO: new ClientDAO({ clientModel: Client, userModel: User }),
      profileDAO: new ProfileDAO({ profileModel: Profile }),
      userDAO: new UserDAO({ userModel: User }),
      leaseDAO: new LeaseDAO({ leaseModel: Lease }),
      queueFactory: mockQueueFactory as any,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitter as any,
      geoCoderService: {} as any,
      propertyCsvProcessor: {} as any,
      mediaUploadService: mockMediaUploadService,
      propertyApprovalService: approvalService,
      propertyStatsService: new PropertyStatsService({ propertyUnitDAO, propertyDAO }),
      notificationService: mockNotificationService,
      permissionService: new PermissionService(),
      subscriptionDAO: {} as any,
      paymentDAO: {} as any,
      maintenanceRequestDAO: {} as any,
      inspectionDAO: {} as any,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();

    client = await createTestClient();
    adminUser = await createTestUser(client.cuid, {
      roles: [ROLES.ADMIN],
      email: `admin-${Date.now()}@test.com`,
    });
    staffUser = await createTestUser(client.cuid, {
      roles: [ROLES.STAFF],
      email: `staff-${Date.now()}@test.com`,
    });
    property = await createTestProperty(client.cuid, client._id, { name: 'Media Target' });
    await Property.findByIdAndUpdate(property._id, {
      approvalStatus: PropertyApprovalStatusEnum.APPROVED,
      images: [],
      documents: [],
    });
  });

  it('holds staff uploads in pendingChanges instead of attaching them to the property', async () => {
    const result = await staffEdit({ name: 'Staff Name' }, [
      imageUpload('front.png'),
      documentUpload('deed.pdf', 'deed'),
    ]);

    expect(result.data.pendingChanges.pendingMedia).toEqual({
      images: [expect.objectContaining({ key: 'property/front.png' })],
      documents: [expect.objectContaining({ key: 'property/deed.pdf', documentType: 'deed' })],
    });
    const saved = await reload();
    expect(saved.name).toBe('Media Target');
    expect(saved.images).toHaveLength(0);
    expect(saved.documents).toHaveLength(0);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_COMPLETED,
      expect.objectContaining({ resourceName: 'property', resourceId: property.pid })
    );

    const { data: detail } = await propertyService.getClientProperty(
      client.cuid,
      property.pid,
      asUser(staffUser, ROLES.STAFF) as any
    );
    const preview = (detail.property as any).pendingChangesPreview;
    expect(preview.updatedFields).toEqual(['name']);
    expect(preview.pendingMedia).toEqual({
      images: [expect.objectContaining({ key: 'property/front.png', filename: 'front.png' })],
      documents: [expect.objectContaining({ key: 'property/deed.pdf' })],
    });
  });

  it('attaches the pending files after any edited media list when the changes are approved', async () => {
    await Property.findByIdAndUpdate(property._id, {
      images: [
        { key: 'property/old-a.png', url: 'https://s3.test/a', uploadedBy: staffUser._id },
        { key: 'property/old-b.png', url: 'https://s3.test/b', uploadedBy: staffUser._id },
      ],
    });
    const current = await reload();
    await staffEdit({ name: 'Staff Name', images: [current.images[1]] }, [imageUpload('new.png')]);

    await approvalService.approveProperty(
      client.cuid,
      property.pid,
      asUser(adminUser, ROLES.ADMIN) as any
    );

    const saved = await reload();
    expect(saved.name).toBe('Staff Name');
    expect(saved.pendingChanges).toBeNull();
    expect(saved.images.map((image: any) => image.key)).toEqual([
      'property/old-b.png',
      'property/new.png',
    ]);
    expect(mockMediaUploadService.removeUploadedFiles).not.toHaveBeenCalled();
  });

  it('deletes the pending files and attaches nothing when the changes are rejected', async () => {
    await staffEdit({ name: 'Staff Name' }, [imageUpload('front.png')]);

    await approvalService.rejectProperty(
      client.cuid,
      property.pid,
      asUser(adminUser, ROLES.ADMIN) as any,
      'Blurry photo'
    );

    const saved = await reload();
    expect(saved.images).toHaveLength(0);
    expect(saved.pendingChanges).toBeNull();
    expect(mockMediaUploadService.removeUploadedFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ key: 'property/front.png' })],
      { deleteAssets: true }
    );
  });

  const adminEdit = (updateData: Record<string, unknown>, uploads: UploadResult[] = []) => {
    mockMediaUploadService.uploadRequestFiles.mockResolvedValueOnce(uploads);
    return propertyService.updateClientProperty(
      {
        cuid: client.cuid,
        pid: property.pid,
        currentuser: asUser(adminUser, ROLES.ADMIN),
        newFiles: uploads.length ? [scannedFile] : undefined,
      } as any,
      updateData as any
    );
  };

  it('saves files from an admin edit on the property in the same write, with no queue step', async () => {
    const result = await adminEdit({ name: 'Admin Name' }, [
      imageUpload('admin.png'),
      documentUpload('deed.pdf', 'deed'),
    ]);

    expect(result.data.pendingChanges ?? null).toBeNull();
    const saved = await reload();
    expect(saved.name).toBe('Admin Name');
    expect(saved.images.map((image: any) => image.key)).toEqual(['property/admin.png']);
    expect(saved.documents).toEqual([
      expect.objectContaining({ key: 'property/deed.pdf', documentType: 'deed', status: 'active' }),
    ]);
    // The response carries the new media with URLs the client can open (signed like reads)
    expect(result.data.images).toEqual([
      expect.objectContaining({
        key: 'property/admin.png',
        url: 'signed:property/admin.png',
        filename: 'admin.png',
        uploadedAt: expect.any(Date),
      }),
    ]);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_COMPLETED,
      expect.objectContaining({ resourceName: 'property', resourceId: property.pid })
    );
    expect(mockPropertyCache.invalidateProperty).toHaveBeenCalled();
    expect(mockPropertyCache.invalidatePropertyDetail).toHaveBeenCalledWith(
      client.cuid,
      property.pid
    );
    expect(mockPropertyCache.invalidatePropertyLists).toHaveBeenCalledWith(client.cuid);
    expect(mockPropertyCache.invalidateLeaseableProperties).toHaveBeenCalledWith(client.cuid);
  });

  it('puts an admin upload after an edited image list in that same write', async () => {
    await Property.findByIdAndUpdate(property._id, {
      images: [
        { key: 'property/old-a.png', url: 'https://s3.test/a', uploadedBy: adminUser._id },
        { key: 'property/old-b.png', url: 'https://s3.test/b', uploadedBy: adminUser._id },
      ],
    });
    const current = await reload();

    await adminEdit({ images: [current.images[1]] }, [imageUpload('new.png')]);

    const saved = await reload();
    expect(saved.images.map((image: any) => image.key)).toEqual([
      'property/old-b.png',
      'property/new.png',
    ]);
  });

  it('appends an admin upload to the stored list when the edit leaves the list alone', async () => {
    await Property.findByIdAndUpdate(property._id, {
      images: [{ key: 'property/old-a.png', url: 'https://s3.test/a', uploadedBy: adminUser._id }],
    });

    await adminEdit({ name: 'Renamed' }, [imageUpload('new.png')]);

    const saved = await reload();
    expect(saved.images.map((image: any) => image.key)).toEqual([
      'property/old-a.png',
      'property/new.png',
    ]);
  });

  it('removes the uploaded files and emits no UPLOAD_COMPLETED when the admin write fails', async () => {
    const uploads = [imageUpload('admin.png')];
    const update = jest.spyOn(PropertyDAO.prototype, 'update').mockResolvedValueOnce(null as any);

    try {
      await expect(adminEdit({ name: 'Admin Name' }, uploads)).rejects.toThrow();
    } finally {
      update.mockRestore();
    }

    expect(mockMediaUploadService.removeUploadedFiles).toHaveBeenCalledWith(uploads);
    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      EventTypes.UPLOAD_COMPLETED,
      expect.anything()
    );
  });
});
