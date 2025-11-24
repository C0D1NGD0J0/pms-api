import { Readable } from 'stream';
import { createHmac } from 'crypto';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { DocumentSigner, DocumentApi, SendForSign } from 'boldsign';
import {
  IBoldSignDocumentResponse,
  ISendDocumentParams,
  IDocumentStatus,
} from '@interfaces/esignature.interface';

export class BoldSignService {
  private readonly log = createLogger('BoldSignService');
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly webhookSecret: string;
  private readonly documentApi: DocumentApi;

  constructor() {
    this.apiKey = envVariables.BOLDSIGN.API_KEY;
    this.apiUrl = envVariables.BOLDSIGN.API_URL;
    this.webhookSecret = envVariables.BOLDSIGN.WEBHOOK_SECRET;

    this.documentApi = new DocumentApi();
    this.documentApi.setApiKey(this.apiKey);
  }

  /**
   * Send document for signature via BoldSign
   */
  async sendDocumentForSignature(params: ISendDocumentParams): Promise<IBoldSignDocumentResponse> {
    try {
      this.log.info('Sending document to BoldSign', {
        title: params.title,
        signerCount: params.signers.length,
      });

      // Create DocumentSigner objects for each signer
      const documentSigners: DocumentSigner[] = params.signers.map((signer) => {
        const documentSigner = new DocumentSigner();
        documentSigner.name = signer.name;
        documentSigner.emailAddress = signer.email;
        documentSigner.signerType = DocumentSigner.SignerTypeEnum.Signer;
        return documentSigner;
      });

      // Create SendForSign object
      const sendForSign = new SendForSign();
      sendForSign.title = params.title;
      sendForSign.message = params.message || 'Please review and sign this document.';
      sendForSign.signers = documentSigners;

      // Convert Buffer to ReadableStream for file upload
      // BoldSign SDK expects fs.ReadStream or RequestDetailedFile
      const fileStream = Readable.from(params.pdfBuffer);
      // Cast to any since we need to add path property for the SDK to recognize it
      (fileStream as any).path = params.pdfFileName;
      sendForSign.files = [fileStream as any];

      // Optional settings
      sendForSign.expiryDays = params.expiryDays || 30;
      sendForSign.reminderSettings = {
        reminderDays: 5,
        reminderCount: 3,
      };
      sendForSign.enableSigningOrder = false;

      // Send document using BoldSign SDK
      const response = await this.documentApi.sendDocument(sendForSign);

      this.log.info('Document sent successfully', {
        documentId: response.documentId,
        title: params.title,
      });

      // DocumentCreated response only has documentId, no signers array
      return {
        documentId: response.documentId || '',
        signers: [], // BoldSign doesn't return signers in the response
      };
    } catch (error: any) {
      this.log.error('Failed to send document to BoldSign', {
        error: error.message,
        title: params.title,
      });
      throw new Error(`BoldSign API Error: ${error.message}`);
    }
  }

  /**
   * Get document status from BoldSign
   */
  async getDocumentStatus(documentId: string): Promise<IDocumentStatus> {
    try {
      this.log.info('Fetching document status', { documentId });

      const response = await this.documentApi.getProperties(documentId);

      return {
        documentId: response.documentId || '',
        status: (response.status as any) || 'Draft',
        signers:
          response.signerDetails?.map((signer) => ({
            name: signer.signerName || '',
            email: signer.signerEmail || '',
            status: (signer.status as any) || 'NotStarted',
            signedDate: undefined, // BoldSign doesn't provide signedDate in getProperties response
          })) || [],
      };
    } catch (error: any) {
      this.log.error('Failed to get document status', {
        error: error.message,
        documentId,
      });
      throw new Error(`BoldSign API Error: ${error.message}`);
    }
  }

  /**
   * Download signed document from BoldSign
   */
  async downloadSignedDocument(documentId: string): Promise<Buffer> {
    try {
      this.log.info('Downloading signed document', { documentId });

      // downloadDocument returns a Buffer directly
      const buffer = await this.documentApi.downloadDocument(documentId);

      this.log.info('Document downloaded successfully', {
        documentId,
        size: buffer.length,
      });

      return buffer;
    } catch (error: any) {
      this.log.error('Failed to download document', {
        error: error.message,
        documentId,
      });
      throw new Error(`BoldSign API Error: ${error.message}`);
    }
  }

  /**
   * Validate webhook signature from BoldSign
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    try {
      const computedSignature = createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      return computedSignature === signature;
    } catch (error: any) {
      this.log.error('Webhook signature validation failed', {
        error: error.message,
      });
      return false;
    }
  }
}
