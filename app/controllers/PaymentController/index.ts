import { Response } from 'express';
import { createLogger } from '@utils/index';
import { PaymentService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  paymentService: PaymentService;
}

export class PaymentController {
  private readonly log = createLogger('PaymentController');
  private readonly paymentService: PaymentService;

  constructor({ paymentService }: IConstructor) {
    this.paymentService = paymentService;
  }

  async listPayments(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;
      const filters = {
        status: req.query.status as string,
        type: req.query.type as string,
        tenantId: req.query.tenantId as string,
        leaseId: req.query.leaseId as string,
        skip: req.query.skip ? Number(req.query.skip) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      };

      const result = await this.paymentService.listPayments(cuid, filters);

      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error listing payments', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to list payments',
      });
    }
  }

  async getPayment(req: AppRequest, res: Response) {
    try {
      const { cuid, pytuid } = req.params;

      const result = await this.paymentService.getPaymentByUid(cuid, pytuid);

      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error fetching payment', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to fetch payment',
      });
    }
  }

  async createPayment(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;

      const result = await this.paymentService.createRentPayment(cuid, req.body);

      return res.status(201).json(result);
    } catch (error) {
      this.log.error('Error creating payment', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to create payment',
      });
    }
  }

  async createConnectAccount(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;
      const { email, country } = req.body;

      const result = await this.paymentService.createConnectAccount(cuid, {
        email,
        country,
      });

      return res.status(201).json(result);
    } catch (error) {
      this.log.error('Error creating Connect account', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to create Connect account',
      });
    }
  }

  async getOnboardingLink(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;

      const result = await this.paymentService.getKycOnboardingLink(cuid);

      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error getting onboarding link', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to get onboarding link',
      });
    }
  }

  async getLoginLink(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;

      const result = await this.paymentService.getExternalDashboardLoginLink(cuid);
      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error getting login link', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to get login link',
      });
    }
  }

  async getPaymentStats(req: AppRequest, res: Response) {
    try {
      const { cuid } = req.params;

      const result = await this.paymentService.getPaymentStats(cuid);

      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error getting payment stats', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to get payment stats',
      });
    }
  }

  async cancelPayment(req: AppRequest, res: Response) {
    try {
      const { cuid, pytuid } = req.params;
      const { reason } = req.body;

      const result = await this.paymentService.cancelPayment(cuid, pytuid, reason);

      return res.status(200).json(result);
    } catch (error) {
      this.log.error('Error cancelling payment', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Failed to cancel payment',
      });
    }
  }
}
