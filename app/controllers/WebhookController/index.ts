import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { LeaseService } from '@services/lease/lease.service';
import { BoldSignService } from '@services/esignature/boldSign.service';

interface IConstructor {
  boldSignService: BoldSignService;
  leaseService: LeaseService;
}

export class WebhookController {
  private leaseService: LeaseService;
  private boldSignService: BoldSignService;
  private log: Logger;

  constructor({ leaseService, boldSignService }: IConstructor) {
    this.leaseService = leaseService;
    this.boldSignService = boldSignService;
    this.log = createLogger('WebhookController');
  }

  /**
   * Handle BoldSign webhook events
   * Receives webhook notifications from BoldSign for document events
   * POST /api/webhooks/boldsign
   */
  handleBoldSignWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { event, data } = req.body;

      if (event.eventType == 'Verification') {
        return res.status(200).json({ success: true, message: 'Verification event ignored' });
      }

      const eventType = event?.eventType;
      const documentId = data?.documentId;
      if (!eventType || !documentId) {
        this.log.warn('Invalid webhook payload - missing eventType or documentId', req.body);
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: event.eventType, data.documentId',
        });
      }

      const processedData = this.boldSignService.processWebhookData(req.body);
      await this.leaseService.handleESignatureWebhook(eventType, documentId, data, processedData);

      return res.status(200).json({ success: true, message: 'Webhook processed successfully' });
    } catch (error: any) {
      this.log.error('Error processing BoldSign webhook', {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  };
}
