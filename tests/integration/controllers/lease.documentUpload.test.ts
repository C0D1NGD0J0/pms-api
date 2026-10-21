import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { Types } from 'mongoose';
import { asValue } from 'awilix';
import { Application } from 'express';
import { QueueFactory } from '@services/queue';
import { S3Service } from '@services/fileUpload/awsS3';
import { EventListenerSetup, container } from '@di/index';
import GuestPassModel from '@models/guestPass/guestpass.model';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { Subscription, PropertyUnit, Property, Lease, User } from '@models/index';
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

// The lease API validates public ids in the production shape (12-char short uids)
const TEST_PID = 'DOCUPLOADP01';
const TEST_PUID = 'DOCUPLOADU01';
const TEST_TENANT_UID = 'DOCUPLOADT01';

describe('Lease document upload (create/update) — saved during the request', () => {
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

    // External services only: S3 echoes back results like S3Service does. The upload queue is
    // captured to prove user uploads never go through it.
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
    // pid/puid/uid are immutable on the models, so set them on the raw collections
    await Property.collection.updateOne({ _id: testProperty._id }, { $set: { pid: TEST_PID } });
    await Property.findByIdAndUpdate(testProperty._id, {
      approvalStatus: 'approved',
      owner: { type: 'company_owned' },
      authorization: { isActive: true },
    });
    testUnit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
      status: 'available',
      unitNumber: '101',
    });
    await PropertyUnit.collection.updateOne({ _id: testUnit._id }, { $set: { puid: TEST_PUID } });
    await User.collection.updateOne({ _id: testTenant._id }, { $set: { uid: TEST_TENANT_UID } });
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

  const postLeaseWithDocument = (originalName: string, pid: string) =>
    request(app)
      .post(`/api/v1/leases/${testClient.cuid}`)
      .set('Cookie', authCookie(managerToken))
      .set('idempotency-key', `create-upload-${Date.now()}`)
      .field('tenantInfo.uid', TEST_TENANT_UID)
      .field('property.pid', pid)
      .field('property.puid', TEST_PUID)
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

  it('POST with leaseDocument[0].file saves the document with the new lease and returns it', async () => {
    const originalName = `signed-lease-${Date.now()}.pdf`;

    const response = await postLeaseWithDocument(originalName, TEST_PID);

    expect({ status: response.status, body: response.body }).toMatchObject({ status: 200 });
    const created = response.body.data.data;
    expect(response.body.fileUpload).toBeUndefined();
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
    expect(addToUploadQueue).not.toHaveBeenCalled();
    expect(tempFilesNamed(originalName)).toHaveLength(0);

    const expectedKey = `lease/${created._id}/${uploadFilesSpy.mock.calls[0][0][0].fileName}`;
    expect(created.leaseDocuments).toEqual([
      expect.objectContaining({
        filename: originalName,
        key: expectedKey,
        status: 'active',
        documentType: 'lease_agreement',
        url: expect.any(String),
      }),
    ]);
    // The same signed, role-filtered list the lease detail GET returns
    expect(response.body.data.documents).toEqual([
      expect.objectContaining({
        filename: originalName,
        key: expectedKey,
        url: expect.any(String),
      }),
    ]);
    const lease = await Lease.findById(created._id).lean();
    expect(lease!.leaseDocuments![0]).toMatchObject({
      filename: originalName,
      key: expectedKey,
      status: 'active',
      documentType: 'lease_agreement',
    });
  });

  it('PATCH with leaseDocument[0].file attaches the document before responding', async () => {
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
    expect(addToUploadQueue).not.toHaveBeenCalled();
    expect(response.body.data.lease.leaseDocuments).toEqual([
      expect.objectContaining({ filename: originalName, status: 'active' }),
    ]);
    expect(response.body.data.documents).toEqual([
      expect.objectContaining({ filename: originalName, url: expect.any(String) }),
    ]);
    const lease = await Lease.findById(draftLease._id).lean();
    expect(lease!.leaseDocuments!.map((doc) => doc.filename)).toEqual([originalName]);
  });

  describe('uploaded document type follows the first signature', () => {
    const SIGNED_AGREEMENT_KEY = 'lease/existing/signed-agreement.pdf';

    const createLeaseWithAgreement = async () =>
      Lease.create({
        luid: `lease-doc-type-${Date.now()}`,
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
        leaseNumber: `LEASE-DOCTYPE-${Date.now()}`,
        createdBy: testTenant._id,
        leaseDocuments: [
          {
            documentType: 'lease_agreement',
            status: 'active',
            filename: 'signed-agreement.pdf',
            url: 'https://mock-bucket.s3.amazonaws.com/signed-agreement.pdf',
            key: SIGNED_AGREEMENT_KEY,
            uploadedBy: testTenant._id,
          },
        ],
      });

    // Mirrors markAsManualySigned (a direct update, as the service does)
    const markLeaseSigned = (leaseId: Types.ObjectId) =>
      Lease.updateOne(
        { _id: leaseId },
        {
          $set: { status: LeaseStatus.ACTIVE, signingMethod: 'manual', signedDate: new Date() },
          $push: {
            signatures: {
              userId: testTenant._id,
              role: 'tenant',
              signatureMethod: 'manual',
              signedAt: new Date(),
            },
          },
        }
      );

    const documentsOf = async (leaseId: Types.ObjectId) =>
      (await Lease.findById(leaseId).lean())!.leaseDocuments!;

    const patchWithDocument = (luid: string, originalName: string) =>
      request(app)
        .patch(`/api/v1/leases/${testClient.cuid}/${luid}`)
        .set('Cookie', authCookie(managerToken))
        .set('idempotency-key', `update-doctype-${Date.now()}`)
        .attach('leaseDocument[0].file', PDF_BYTES, {
          filename: originalName,
          contentType: 'application/pdf',
        });

    const postStandaloneDocument = (luid: string, originalName: string) =>
      request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${luid}/document`)
        .set('Cookie', authCookie(managerToken))
        .set('idempotency-key', `standalone-doctype-${Date.now()}`)
        .attach('document', PDF_BYTES, { filename: originalName, contentType: 'application/pdf' });

    it('an upload before signing becomes the active lease_agreement and retires the previous one', async () => {
      const lease = await createLeaseWithAgreement();
      const originalName = `replacement-${Date.now()}.pdf`;

      const response = await patchWithDocument(lease.luid, originalName);
      expect(response.status).toBe(200);

      const docs = await documentsOf(lease._id);
      expect(docs.find((doc) => doc.filename === originalName)).toMatchObject({
        documentType: 'lease_agreement',
        status: 'active',
      });
      expect(docs.find((doc) => doc.key === SIGNED_AGREEMENT_KEY)!.status).toBe('inactive');
    });

    it('POST /:luid/document replaces the agreement before signing', async () => {
      const lease = await createLeaseWithAgreement();
      const originalName = `standalone-unsigned-${Date.now()}.pdf`;

      const response = await postStandaloneDocument(lease.luid, originalName);

      expect(response.status).toBe(200);
      const docs = await documentsOf(lease._id);
      expect(docs.find((doc) => doc.filename === originalName)).toMatchObject({
        documentType: 'lease_agreement',
        status: 'active',
      });
      expect(docs.find((doc) => doc.key === SIGNED_AGREEMENT_KEY)!.status).toBe('inactive');
    });

    it('POST /:luid/document after signing stores other and leaves the agreement active', async () => {
      const lease = await createLeaseWithAgreement();
      await markLeaseSigned(lease._id);
      const originalName = `standalone-signed-${Date.now()}.pdf`;

      const response = await postStandaloneDocument(lease.luid, originalName);

      expect(response.status).toBe(200);
      const docs = await documentsOf(lease._id);
      expect(docs.find((doc) => doc.filename === originalName)).toMatchObject({
        documentType: 'other',
        status: 'active',
      });
      expect(docs.find((doc) => doc.key === SIGNED_AGREEMENT_KEY)).toMatchObject({
        documentType: 'lease_agreement',
        status: 'active',
      });
    });
  });

  it('does not upload anything and removes the temp file when the lease write is rejected', async () => {
    const originalName = `rejected-${Date.now()}.pdf`;

    const response = await postLeaseWithDocument(originalName, 'MISSINGPROP1');

    expect(response.status).toBe(400);
    expect(uploadFilesSpy).not.toHaveBeenCalled();
    expect(addToUploadQueue).not.toHaveBeenCalled();
    expect(await waitFor(async () => tempFilesNamed(originalName).length === 0)).toBe(true);
    expect(await Lease.countDocuments({ cuid: testClient.cuid })).toBe(0);
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
