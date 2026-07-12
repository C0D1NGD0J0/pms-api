jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock MaintenanceController
const mockMaintenanceController = {
  createRequest: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.CREATED).json({
      success: true,
      message: 'Maintenance request created successfully',
      data: {
        mruid: `MR-${faker.string.alphanumeric(8).toUpperCase()}`,
        title: faker.lorem.sentence(),
        status: 'open',
        priority: 'medium',
        category: 'plumbing',
      },
    });
  }),

  listRequests: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          mruid: `MR-${faker.string.alphanumeric(8).toUpperCase()}`,
          title: faker.lorem.sentence(),
          status: 'open',
          priority: 'medium',
          category: 'plumbing',
          createdAt: new Date().toISOString(),
        },
      ],
      pagination: { total: 1, page: 1, pages: 1, limit: 20 },
    });
  }),

  getStats: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        total: 10,
        byStatus: { open: 3, assigned: 2, in_progress: 2, completed: 3 },
        byPriority: { urgent: 1, high: 2, medium: 4, low: 3 },
      },
    });
  }),

  getRequest: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        mruid: `MR-${faker.string.alphanumeric(8).toUpperCase()}`,
        title: faker.lorem.sentence(),
        status: 'open',
        priority: 'medium',
        category: 'plumbing',
      },
    });
  }),

  assignVendor: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.CREATED).json({
      success: true,
      message: 'Vendor assigned successfully',
      data: { status: 'assigned' },
    });
  }),

  respondToAssignment: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Assignment accepted',
      data: { status: 'in_progress' },
    });
  }),

  updateStatus: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Status updated',
      data: { status: 'in_progress' },
    });
  }),

  completeRequest: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Request completed',
      data: { status: 'completed' },
    });
  }),

  cancelRequest: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Request cancelled',
      data: { status: 'cancelled' },
    });
  }),

  submitInvoice: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Invoice submitted',
      data: { invoice: { status: 'pending', amountInCents: 50000 } },
    });
  }),

  reviewInvoice: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Invoice approved',
      data: { invoice: { status: 'approved' } },
    });
  }),

  submitWorkOrder: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.CREATED).json({
      success: true,
      message: 'Work order submitted successfully',
      data: {
        workOrder: {
          status: 'pending_review',
          scope: 'Replace water heater',
          estimatedCostInCents: 75000,
        },
      },
    });
  }),

  reviewWorkOrder: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Work order approved',
      data: { workOrder: { status: 'approved' } },
    });
  }),

  acceptAISuggestion: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'AI suggestion applied',
      data: { category: 'plumbing', priority: 'high' },
    });
  }),

  dismissAISuggestion: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'AI suggestion dismissed',
      data: {},
    });
  }),

  scanInvoice: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        extracted: {
          description: 'Plumbing repair',
          amountInCents: 18500,
          currency: 'USD',
          lineItems: [],
          confidence: 0.92,
        },
      },
    });
  }),

  handleWebhook: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { invoice: { status: 'pending' } },
    });
  }),
};

const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'maintenanceController':
        return mockMaintenanceController;
      default:
        return {};
    }
  }),
};

describe('Maintenance Request Routes', () => {
  const baseUrl = '/api/v1/maintenance';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockMruid = `MR-${faker.string.alphanumeric(8).toUpperCase()}`;

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: any) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Public webhook route (no auth)
      testApp.post(`${baseUrl}/webhooks/invoice/:source`, mockMaintenanceController.handleWebhook);

      // Authenticated routes
      testApp.post(`${baseUrl}/:cuid`, mockMaintenanceController.createRequest);
      testApp.get(`${baseUrl}/:cuid`, mockMaintenanceController.listRequests);
      testApp.get(`${baseUrl}/:cuid/stats`, mockMaintenanceController.getStats);
      testApp.get(`${baseUrl}/:cuid/:mruid`, mockMaintenanceController.getRequest);
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/vendor_assignment`,
        mockMaintenanceController.assignVendor
      );
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/assignment`,
        mockMaintenanceController.respondToAssignment
      );
      testApp.patch(`${baseUrl}/:cuid/:mruid/status`, mockMaintenanceController.updateStatus);
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/complete_request`,
        mockMaintenanceController.completeRequest
      );
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/cancel_request`,
        mockMaintenanceController.cancelRequest
      );
      testApp.post(
        `${baseUrl}/:cuid/:mruid/create_invoice`,
        mockMaintenanceController.submitInvoice
      );
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/invoice_review`,
        mockMaintenanceController.reviewInvoice
      );
      testApp.post(`${baseUrl}/:cuid/:mruid/work_order`, mockMaintenanceController.submitWorkOrder);
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/work_order_review`,
        mockMaintenanceController.reviewWorkOrder
      );
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/ai_suggestion/accept`,
        mockMaintenanceController.acceptAISuggestion
      );
      testApp.patch(
        `${baseUrl}/:cuid/:mruid/ai_suggestion/dismiss`,
        mockMaintenanceController.dismissAISuggestion
      );
      testApp.post(`${baseUrl}/:cuid/:mruid/scan_invoice`, mockMaintenanceController.scanInvoice);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Public Webhook ────────────────────────────────────────────────────────

  describe('POST /webhooks/invoice/:source (public)', () => {
    it('should accept a quickbooks webhook payload', async () => {
      const payload = {
        mruid: mockMruid,
        amount: 15000,
        currency: 'usd',
        description: 'Plumbing repair',
        externalInvoiceId: 'QB-INV-001',
        source: 'quickbooks',
        rawPayload: {},
      };

      const response = await request(app)
        .post(`${baseUrl}/webhooks/invoice/quickbooks`)
        .send(payload)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockMaintenanceController.handleWebhook).toHaveBeenCalled();
    });

    it('should accept a manual webhook payload', async () => {
      const payload = {
        mruid: mockMruid,
        amount: 8000,
        currency: 'usd',
        description: 'Parts and labor',
        externalInvoiceId: 'MAN-001',
        source: 'manual',
        rawPayload: {},
      };

      const response = await request(app)
        .post(`${baseUrl}/webhooks/invoice/manual`)
        .send(payload)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return error on webhook service failure', async () => {
      mockMaintenanceController.handleWebhook.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res
            .status(httpStatusCodes.NOT_FOUND)
            .json({ success: false, message: 'Maintenance request not found' });
        }
      );

      await request(app)
        .post(`${baseUrl}/webhooks/invoice/quickbooks`)
        .send({
          mruid: 'MR-NOTFOUND',
          amount: 5000,
          currency: 'usd',
          description: 'Test',
          externalInvoiceId: 'X-001',
          source: 'quickbooks',
        })
        .expect(httpStatusCodes.NOT_FOUND);
    });
  });

  // ─── Create Request ────────────────────────────────────────────────────────

  describe('POST /:cuid (create request)', () => {
    const validBody = {
      pid: faker.string.uuid(),
      title: 'Leaking faucet in kitchen',
      description: { text: 'The kitchen faucet has been leaking for two days.' },
      category: 'plumbing',
      permissionToEnter: true,
    };

    it('should create a maintenance request and return 201', async () => {
      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}`)
        .send(validBody)
        .expect(httpStatusCodes.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.mruid).toBeDefined();
      expect(response.body.data.status).toBe('open');
      expect(mockMaintenanceController.createRequest).toHaveBeenCalled();
    });

    it('should return 400 for validation failure', async () => {
      mockMaintenanceController.createRequest.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Validation failed',
            errors: ['pid is required'],
          });
        }
      );

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}`)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when tenant has no active lease', async () => {
      mockMaintenanceController.createRequest.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You do not have an active lease for this property',
          });
        }
      );

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}`)
        .send(validBody)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── List Requests ─────────────────────────────────────────────────────────

  describe('GET /:cuid (list requests)', () => {
    it('should return paginated list of requests', async () => {
      const response = await request(app).get(`${baseUrl}/${mockCuid}`).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(mockMaintenanceController.listRequests).toHaveBeenCalled();
    });

    it('should support status filter', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ status: 'open' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support pagination query params', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}`)
        .query({ page: '1', limit: '10' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────────

  describe('GET /:cuid/stats', () => {
    it('should return maintenance statistics', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBeDefined();
      expect(response.body.data.byStatus).toBeDefined();
      expect(mockMaintenanceController.getStats).toHaveBeenCalled();
    });
  });

  // ─── Get Single Request ────────────────────────────────────────────────────

  describe('GET /:cuid/:mruid', () => {
    it('should return a single maintenance request', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockMruid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.mruid).toBeDefined();
      expect(mockMaintenanceController.getRequest).toHaveBeenCalled();
    });

    it('should return 404 when request not found', async () => {
      mockMaintenanceController.getRequest.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res
            .status(httpStatusCodes.NOT_FOUND)
            .json({ success: false, message: 'Maintenance request not found' });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/MR-NOTFOUND`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── Assign Vendor ─────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/vendor_assignment', () => {
    it('should assign a vendor successfully', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/vendor_assignment`)
        .send({ vuid: faker.string.uuid() })
        .expect(httpStatusCodes.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('assigned');
      expect(mockMaintenanceController.assignVendor).toHaveBeenCalled();
    });

    it('should return 404 when vendor not found', async () => {
      mockMaintenanceController.assignVendor.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res
            .status(httpStatusCodes.NOT_FOUND)
            .json({ success: false, message: 'Vendor not found' });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/vendor_assignment`)
        .send({ vuid: 'VENDOR-NOTFOUND' })
        .expect(httpStatusCodes.NOT_FOUND);
    });
  });

  // ─── Respond to Assignment (accept/decline) ────────────────────────────────

  describe('PATCH /:cuid/:mruid/assignment', () => {
    it('should accept an assignment and forward full body to controller', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/assignment`)
        .send({ action: 'accept', technician: { name: 'Jane Tech', phone: '555-1234' } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('in_progress');
      expect(mockMaintenanceController.respondToAssignment).toHaveBeenCalled();
    });

    it('should decline an assignment and forward full body to controller', async () => {
      mockMaintenanceController.respondToAssignment.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            message: 'Assignment declined',
            data: { status: 'open' },
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/assignment`)
        .send({ action: 'decline', reason: 'Unavailable this week' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('open');
      expect(mockMaintenanceController.respondToAssignment).toHaveBeenCalled();
    });

    it('should return 403 when vendor is not the assigned vendor', async () => {
      mockMaintenanceController.respondToAssignment.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You are not the assigned vendor for this request',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/assignment`)
        .send({ action: 'accept' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  // ─── Update Status ─────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/status', () => {
    it('should update request status', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/status`)
        .send({ status: 'in_progress' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockMaintenanceController.updateStatus).toHaveBeenCalled();
    });

    it('should return 400 on invalid transition', async () => {
      mockMaintenanceController.updateStatus.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid status transition',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/status`)
        .send({ status: 'completed' })
        .expect(httpStatusCodes.BAD_REQUEST);
    });
  });

  // ─── Complete Request ──────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/complete_request', () => {
    it('should complete a maintenance request', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/complete_request`)
        .send({ completionNotes: 'Faucet replaced', actualCost: 25000 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('completed');
      expect(mockMaintenanceController.completeRequest).toHaveBeenCalled();
    });
  });

  // ─── Cancel Request ────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/cancel_request', () => {
    it('should cancel a maintenance request', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/cancel_request`)
        .send({ reason: 'Tenant resolved issue independently' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('cancelled');
      expect(mockMaintenanceController.cancelRequest).toHaveBeenCalled();
    });
  });

  // ─── Submit Invoice ────────────────────────────────────────────────────────

  describe('POST /:cuid/:mruid/create_invoice', () => {
    const validInvoice = {
      amount: 50000,
      currency: 'usd',
      description: 'Replaced faucet and fixed pipe',
    };

    it('should submit an invoice successfully', async () => {
      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/create_invoice`)
        .send(validInvoice)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice.status).toBe('pending');
      expect(mockMaintenanceController.submitInvoice).toHaveBeenCalled();
    });

    it('should return 403 when vendor is not the assigned vendor', async () => {
      mockMaintenanceController.submitInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You are not the assigned vendor for this request',
          });
        }
      );

      await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/create_invoice`)
        .send(validInvoice)
        .expect(httpStatusCodes.FORBIDDEN);
    });
  });

  // ─── Review Invoice ────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/invoice_review', () => {
    it('should approve an invoice and forward full body to controller', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/invoice_review`)
        .send({ action: 'approve', isBillable: true })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice.status).toBe('approved');
      expect(mockMaintenanceController.reviewInvoice).toHaveBeenCalled();
    });

    it('should reject an invoice and forward full body to controller', async () => {
      mockMaintenanceController.reviewInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            message: 'Invoice rejected',
            data: { invoice: { status: 'rejected' } },
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/invoice_review`)
        .send({ action: 'reject', rejectionReason: 'Amount does not match estimate' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice.status).toBe('rejected');
      expect(mockMaintenanceController.reviewInvoice).toHaveBeenCalled();
    });

    it('should return 400 when no invoice exists', async () => {
      mockMaintenanceController.reviewInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No invoice has been submitted for this request',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/invoice_review`)
        .send({ action: 'approve' })
        .expect(httpStatusCodes.BAD_REQUEST);
    });
  });

  // ─── Submit Work Order ──────────────────────────────────────────────────────

  describe('POST /:cuid/:mruid/work_order', () => {
    const validWorkOrder = {
      scope: 'Replace water heater and all related fittings',
      estimatedCostInCents: 75000,
    };

    it('should submit a work order and return 201', async () => {
      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/work_order`)
        .send(validWorkOrder)
        .expect(httpStatusCodes.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workOrder.status).toBe('pending_review');
      expect(mockMaintenanceController.submitWorkOrder).toHaveBeenCalled();
    });

    it('should submit a work order with line items', async () => {
      const withLineItems = {
        ...validWorkOrder,
        lineItems: [
          {
            description: 'Water heater unit',
            quantity: 1,
            unitPriceInCents: 60000,
            amountInCents: 60000,
          },
          { description: 'Labour', quantity: 2, unitPriceInCents: 7500, amountInCents: 15000 },
        ],
        notes: 'Customer requested same-day service',
      };

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/work_order`)
        .send(withLineItems)
        .expect(httpStatusCodes.CREATED);

      expect(response.body.success).toBe(true);
      expect(mockMaintenanceController.submitWorkOrder).toHaveBeenCalled();
    });

    it('should return 400 when work order is already pending review', async () => {
      mockMaintenanceController.submitWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Work order is pending PM review — cannot start work yet',
          });
        }
      );

      await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/work_order`)
        .send(validWorkOrder)
        .expect(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 403 when non-vendor tries to submit', async () => {
      mockMaintenanceController.submitWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only the PM/manager can review work orders',
          });
        }
      );

      await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/work_order`)
        .send(validWorkOrder)
        .expect(httpStatusCodes.FORBIDDEN);
    });
  });

  // ─── Review Work Order ──────────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/work_order_review', () => {
    it('should approve a work order', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/work_order_review`)
        .send({ action: 'approve' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workOrder.status).toBe('approved');
      expect(mockMaintenanceController.reviewWorkOrder).toHaveBeenCalled();
    });

    it('should reject a work order with a reason', async () => {
      mockMaintenanceController.reviewWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            message: 'Work order rejected',
            data: { workOrder: { status: 'rejected', rejectionReason: 'Estimated cost too high' } },
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/work_order_review`)
        .send({ action: 'reject', rejectionReason: 'Estimated cost too high, please revise' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.workOrder.status).toBe('rejected');
    });

    it('should return 400 when no work order exists', async () => {
      mockMaintenanceController.reviewWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No work order found on this request',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/work_order_review`)
        .send({ action: 'approve' })
        .expect(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 400 when work order is not pending review', async () => {
      mockMaintenanceController.reviewWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Work order is not in pending review status',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/work_order_review`)
        .send({ action: 'approve' })
        .expect(httpStatusCodes.BAD_REQUEST);
    });

    it('should return 403 when vendor tries to review their own work order', async () => {
      mockMaintenanceController.reviewWorkOrder.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only the PM/manager can review work orders',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/work_order_review`)
        .send({ action: 'approve' })
        .expect(httpStatusCodes.FORBIDDEN);
    });
  });

  // ─── AI Suggestion — accept ────────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/ai_suggestion/accept', () => {
    it('should accept AI suggestion as a manager and return 200', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/ai_suggestion/accept`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.category).toBe('plumbing');
      expect(mockMaintenanceController.acceptAISuggestion).toHaveBeenCalled();
    });

    it('should return 403 when a vendor tries to accept AI suggestion', async () => {
      mockMaintenanceController.acceptAISuggestion.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only managers can accept AI suggestions',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/ai_suggestion/accept`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('manager');
    });

    it('should return 400 when no AI suggestion is available', async () => {
      mockMaintenanceController.acceptAISuggestion.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No AI suggestion available to accept',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/ai_suggestion/accept`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 when request is not found', async () => {
      mockMaintenanceController.acceptAISuggestion.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Maintenance request not found',
          });
        }
      );

      await request(app)
        .patch(`${baseUrl}/${mockCuid}/MR-NOTFOUND/ai_suggestion/accept`)
        .expect(httpStatusCodes.NOT_FOUND);
    });
  });

  // ─── AI Suggestion — dismiss ───────────────────────────────────────────────

  describe('PATCH /:cuid/:mruid/ai_suggestion/dismiss', () => {
    it('should dismiss AI suggestion as a manager and return 200', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/ai_suggestion/dismiss`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('AI suggestion dismissed');
      expect(mockMaintenanceController.dismissAISuggestion).toHaveBeenCalled();
    });

    it('should return 403 when a vendor tries to dismiss AI suggestion', async () => {
      mockMaintenanceController.dismissAISuggestion.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only managers can dismiss AI suggestions',
          });
        }
      );

      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockMruid}/ai_suggestion/dismiss`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('manager');
    });
  });

  // ─── Scan Invoice (AI) ─────────────────────────────────────────────────────

  describe('POST /:cuid/:mruid/scan_invoice', () => {
    it('should return extracted invoice data on success', async () => {
      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/scan_invoice`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.extracted).toBeDefined();
      expect(response.body.data.extracted.amountInCents).toBe(18500);
      expect(mockMaintenanceController.scanInvoice).toHaveBeenCalled();
    });

    it('should return 422 when AI extraction fails', async () => {
      mockMaintenanceController.scanInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(422).json({
            success: false,
            message: 'AI invoice scanning is disabled or failed to extract data',
          });
        }
      );

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/scan_invoice`)
        .expect(422);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when no file is uploaded', async () => {
      mockMaintenanceController.scanInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(400).json({
            success: false,
            message: 'No invoice file uploaded',
          });
        }
      );

      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/scan_invoice`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 when vendor is not the assigned vendor', async () => {
      mockMaintenanceController.scanInvoice.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You are not the assigned vendor for this request',
          });
        }
      );

      await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockMruid}/scan_invoice`)
        .expect(httpStatusCodes.FORBIDDEN);
    });
  });
});
