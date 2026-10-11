import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { asValue } from 'awilix';
import { Application } from 'express';
import { QueueFactory } from '@services/queue';
import { UploadWorker } from '@workers/upload.worker';
import { S3Service } from '@services/fileUpload/awsS3';
import { EventListenerSetup, container } from '@di/index';
import GuestPassModel from '@models/guestPass/guestpass.model';
import { LeasePdfService } from '@services/lease/leasePdf.service';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { Subscription, PropertyUnit, Property, Lease } from '@models/index';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/subscription.interface';

import { createAuthToken, createTestApp, authCookie } from '../../setup/testApp';
import {
  createTestPropertyUnit,
  setupAllExternalMocks,
  createTestManagerUser,
  createTestTenantUser,
  createTestProperty,
  createTestClient,
} from '../../helpers';

// Minimal file with a PDF signature so the magic-byte check accepts it
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const tempFilesNamed = (originalName: string) =>
  fs.existsSync(UPLOAD_DIR)
    ? fs.readdirSync(UPLOAD_DIR).filter((name) => name.endsWith(`_${originalName}`))
    : [];

const waitFor = async (check: () => Promise<boolean>, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

describe('Lease document upload (create/update) — property-documents pipeline', () => {
  let app: Application;
  let testClient: any;
  let testTenant: any;
  let testProperty: any;
  let testUnit: any;
  let managerToken: string;
  let uploadFilesSpy: jest.SpyInstance;
  let addToUploadQueue: jest.Mock;

  beforeAll(async () => {
    setupAllExternalMocks();
    await Lease.init();
    await Property.init();

    container.register({ GuestPassModel: asValue(GuestPassModel) });
    container.register({
      idempotencyCache: asValue({
        claimRouteRequest: async () => 'claimed',
        finalizeRouteRequest: async () => ({ success: true }),
        releaseRouteClaim: async () => ({ success: true }),
      }),
      subscriptionCache: asValue({
        getEntitlements: async () => ({ success: false, data: null }),
        cacheEntitlements: async () => ({ success: true }),
        invalidate: async () => ({ success: true }),
      }),
    });

    // External services only: S3 echoes back results like S3Service does, the upload queue is captured
    const s3Service = container.resolve<S3Service>('s3Service');
    uploadFilesSpy = jest
      .spyOn(s3Service, 'uploadFiles')
      .mockImplementation(async (files, resource) =>
        files.map((file) => ({
          resourceId: resource.resourceId,
          resourceName: resource.resourceName,
          publicuid: resource.resourceId,
          url: `https://mock-bucket.s3.amazonaws.com/${file.fileName}`,
          key: `lease/${resource.resourceId}/${file.fileName}`,
          fieldName: file.fieldName.split('.')[0] || file.fieldName,
          filename: file.originalFileName || file.fileName,
          size: file.fileSize,
          mimeType: file.mimeType,
          mediatype: 'document' as const,
        }))
      );

    addToUploadQueue = jest.fn();
    const queueFactory = container.resolve<QueueFactory>('queueFactory');
    const getQueue = queueFactory.getQueue.bind(queueFactory);
    jest
      .spyOn(queueFactory, 'getQueue')
      .mockImplementation(((name: string) =>
        name === 'uploadQueue' ? { addToUploadQueue } : getQueue(name as any)) as any);

    // Temp-file clean-up (error handler → DELETE_LOCAL_ASSET) as registered at API start-up
    EventListenerSetup.registerInfrastructureListeners(container);
    // Persistence runs in the worker process: upload worker → UPLOAD_COMPLETED → LeasePdfService
    container.resolve<LeasePdfService>('leasePdfService').registerEventListeners();

    app = createTestApp();

    testClient = await createTestClient({ isVerified: true });
    await Subscription.create({
      cuid: testClient.cuid,
      suid: `test-suid-${Date.now()}`,
      client: testClient._id,
      planName: 'portfolio',
      status: ISubscriptionStatus.ACTIVE,
      billing: { customerId: 'none', provider: IPaymentGatewayProvider.NONE, planId: 'none' },
      billingInterval: 'monthly',
      totalMonthlyPrice: 0,
      resourceTracker: { propertyCount: 0, unitCount: 0, seatCount: 1 },
      seats: { additional: 0, additionalCost: 0 },
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      entitlements: { eSignature: true, leaseTemplates: true },
    });

    const testManager = await createTestManagerUser(testClient.cuid, testClient._id);
    testTenant = await createTestTenantUser(testClient.cuid, testClient._id);
    testProperty = await createTestProperty(testClient.cuid, testClient._id, {
      propertyType: 'apartment',
      maxAllowedUnits: 10,
    });
    await Property.findByIdAndUpdate(testProperty._id, {
      approvalStatus: 'approved',
      owner: { type: 'company_owned' },
      authorization: { isActive: true },
    });
    testUnit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
      status: 'available',
      unitNumber: '101',
    });
    managerToken = createAuthToken(testManager);
  });

  beforeEach(async () => {
    await Lease.deleteMany({});
    await PropertyUnit.updateMany({}, { $set: { status: 'available' } });
    uploadFilesSpy.mockClear();
    addToUploadQueue.mockClear();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const runUploadWorkerOnQueuedJob = async () => {
    expect(addToUploadQueue).toHaveBeenCalledTimes(1);
    const [, jobData] = addToUploadQueue.mock.calls[0];
    const uploadWorker = container.resolve<UploadWorker>('uploadWorker');
    await uploadWorker.uploadAsset({ data: jobData, progress: jest.fn() } as any);
  };

  const postLeaseWithDocument = (originalName: string, propertyId: string) =>
    request(app)
      .post(`/api/v1/leases/${testClient.cuid}`)
      .set('Cookie', authCookie(managerToken))
      .set('idempotency-key', `create-upload-${Date.now()}`)
      .field('tenantInfo.id', testTenant._id.toString())
      .field('property.id', propertyId)
      .field('property.unitId', testUnit._id.toString())
      .field('duration.startDate', '2026-01-01')
      .field('duration.endDate', '2026-12-31')
      .field('fees.rentAmount', '1500')
      .field('fees.securityDeposit', '1500')
      .field('fees.rentDueDay', '1')
      .field('fees.currency', 'USD')
      .field('fees.acceptedPaymentMethod', 'e-transfer')
      .field('type', LeaseType.FIXED_TERM)
      .attach('leaseDocument[0].file', PDF_BYTES, {
        filename: originalName,
        contentType: 'application/pdf',
      });

  it('POST with leaseDocument[0].file uploads to S3 and persists it onto lease.leaseDocuments', async () => {
    const originalName = `signed-lease-${Date.now()}.pdf`;

    const response = await postLeaseWithDocument(originalName, testProperty._id.toString());

    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    const created = response.body.data.data;
    expect(response.body.fileUpload).toMatch(/1 file\(s\) queued/);
    expect(uploadFilesSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          fieldName: 'leaseDocument[0].file',
          mimeType: 'application/pdf',
        }),
      ],
      expect.objectContaining({
        resourceName: 'lease',
        resourceId: created._id,
        fieldName: 'leaseDocument',
      })
    );
    expect(tempFilesNamed(originalName)).toHaveLength(0);

    await runUploadWorkerOnQueuedJob();

    const persisted = await waitFor(async () => {
      const lease = await Lease.findById(created._id).lean();
      return (lease?.leaseDocuments?.length ?? 0) > 0;
    });
    expect(persisted).toBe(true);
    const lease = await Lease.findById(created._id).lean();
    expect(lease!.leaseDocuments![0]).toMatchObject({
      filename: originalName,
      key: `lease/${created._id}/${uploadFilesSpy.mock.calls[0][0][0].fileName}`,
      status: 'active',
      documentType: 'lease_agreement',
    });
  });

  it('PATCH with leaseDocument[0].file attaches the document to an existing lease', async () => {
    const draftLease = await Lease.create({
      luid: `lease-draft-${Date.now()}`,
      cuid: testClient.cuid,
      tenantId: testTenant._id,
      property: {
        id: testProperty._id,
        unitId: testUnit._id,
        address: testProperty.address.fullAddress,
      },
      duration: { startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
      fees: {
        rentAmount: 150000,
        securityDeposit: 150000,
        rentDueDay: 1,
        currency: 'USD',
        acceptedPaymentMethod: 'e-transfer',
      },
      status: LeaseStatus.DRAFT,
      approvalStatus: 'approved',
      type: LeaseType.FIXED_TERM,
      leaseNumber: `LEASE-DRAFT-${Date.now()}`,
      createdBy: testTenant._id,
    });
    const originalName = `addendum-${Date.now()}.pdf`;

    const response = await request(app)
      .patch(`/api/v1/leases/${testClient.cuid}/${draftLease.luid}`)
      .set('Cookie', authCookie(managerToken))
      .set('idempotency-key', `update-upload-${Date.now()}`)
      .attach('leaseDocument[0].file', PDF_BYTES, {
        filename: originalName,
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(uploadFilesSpy).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ resourceName: 'lease', resourceId: draftLease._id.toString() })
    );

    await runUploadWorkerOnQueuedJob();

    const persisted = await waitFor(async () => {
      const lease = await Lease.findById(draftLease._id).lean();
      return lease?.leaseDocuments?.some((doc) => doc.filename === originalName) ?? false;
    });
    expect(persisted).toBe(true);
  });

  it('does not upload anything and removes the temp file when the lease write is rejected', async () => {
    const originalName = `rejected-${Date.now()}.pdf`;

    const response = await postLeaseWithDocument(originalName, '507f1f77bcf86cd799439011');

    expect(response.status).toBe(400);
    expect(uploadFilesSpy).not.toHaveBeenCalled();
    expect(addToUploadQueue).not.toHaveBeenCalled();
    expect(await waitFor(async () => tempFilesNamed(originalName).length === 0)).toBe(true);
  });

  it('rejects the old `document` field and non-PDF lease documents', async () => {
    const oldField = await request(app)
      .post(`/api/v1/leases/${testClient.cuid}`)
      .set('Cookie', authCookie(managerToken))
      .set('idempotency-key', `create-oldfield-${Date.now()}`)
      .attach('document', PDF_BYTES, { filename: 'lease.pdf', contentType: 'application/pdf' });
    const docx = await request(app)
      .post(`/api/v1/leases/${testClient.cuid}`)
      .set('Cookie', authCookie(managerToken))
      .set('idempotency-key', `create-docx-${Date.now()}`)
      .attach('leaseDocument[0].file', Buffer.from('PK\u0003\u0004'), {
        filename: 'lease.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

    expect(oldField.status).toBe(400);
    expect(docx.status).toBe(400);
    expect(uploadFilesSpy).not.toHaveBeenCalled();
  });
});
