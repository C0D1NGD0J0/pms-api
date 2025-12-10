import { Readable } from 'stream';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { DocumentSigner, RevokeDocument, DocumentApi, SendForSign } from 'boldsign';
import {
  IBoldSignDocumentResponse,
  ISendDocumentParams,
  IDocumentStatus,
} from '@interfaces/esignature.interface';

export interface ProcessedWebhookData {
  recentSigner?: ProcessedSignerInfo;
  completedSignerEmails: string[];
  documentId: string;
}

export interface ProcessedSignerInfo {
  signedAt: Date;
  email: string;
  name: string;
}

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

    this.documentApi = new DocumentApi(this.apiUrl);
    this.documentApi.setApiKey(this.apiKey);
  }

  /**
   * Send document for signature via BoldSign
   */
  async sendDocumentForSignature(params: ISendDocumentParams): Promise<IBoldSignDocumentResponse> {
    try {
      const documentSigners: DocumentSigner[] = params.signers.map((signer) => {
        const documentSigner = new DocumentSigner();
        documentSigner.name = signer.name;
        documentSigner.emailAddress = signer.email;
        documentSigner.signerType = DocumentSigner.SignerTypeEnum.Signer;
        return documentSigner;
      });

      const sendForSign = new SendForSign();
      sendForSign.title = params.title;
      sendForSign.message = params.message || 'Please review and sign this document.';
      sendForSign.signers = documentSigners;
      sendForSign.useTextTags = true;

      // BoldSign SDK expects fs.ReadStream or RequestDetailedFile, so we convert Buffer accordingly
      // cast to any since we need to add path property for the SDK to recognize it
      const fileStream = Readable.from(params.pdfBuffer);
      (fileStream as any).path = params.pdfFileName;
      sendForSign.files = [fileStream as any];

      sendForSign.expiryDays = params.expiryDays || 30;
      sendForSign.reminderSettings = {
        reminderDays: 5,
        reminderCount: 3,
      };
      sendForSign.enableSigningOrder = false;

      if (params.senderInfo) {
        sendForSign.onBehalfOf = params.senderInfo.email;
      }

      const response = await this.documentApi.sendDocument(sendForSign);
      return {
        documentId: response.documentId || '',
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
      const response = await this.documentApi.getProperties(documentId);

      return {
        documentId: response.documentId || '',
        status: (response.status as any) || 'Draft',
        signers:
          response.signerDetails?.map((signer) => ({
            name: signer.signerName || '',
            email: signer.signerEmail || '',
            status: (signer.status as any) || 'NotStarted',
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
      const buffer = await this.documentApi.downloadDocument(documentId);

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
   * Process BoldSign webhook data to extract relevant information
   * @param webhookPayload - Raw webhook payload from BoldSign
   * @returns Processed data with recent signer and completed signer emails
   */
  processWebhookData(webhookPayload: any): ProcessedWebhookData {
    const { data } = webhookPayload;

    const completedSigners = (data.signerDetails || []).filter(
      (s: any) => s.status === 'Completed' && s.isViewed
    );

    // find most recent signer (highest lastActivityDate timestamp)
    const recentSigner = completedSigners
      .filter((s: any) => s.lastActivityDate)
      .sort((a: any, b: any) => b.lastActivityDate - a.lastActivityDate)[0];

    return {
      documentId: data.documentId,
      recentSigner: recentSigner
        ? {
            email: recentSigner.signerEmail,
            name: recentSigner.signerName,
            signedAt: new Date(recentSigner.lastActivityDate * 1000), // convert Unix timestamp to Date
          }
        : undefined,
      completedSignerEmails: completedSigners.map((s: any) => s.signerEmail),
    };
  }

  async revokeDocument(documentId: string, reason: string) {
    try {
      const revokeDocumentRequest = new RevokeDocument();
      revokeDocumentRequest.message = reason;
      revokeDocumentRequest.onBehalfOf = envVariables.BOLDSIGN.DEFAULT_SENDER_EMAIL; // this should be onbehalf email used to send
      const result = await this.documentApi.revokeDocument(documentId, revokeDocumentRequest);
      return result;
    } catch (error: any) {
      this.log.error('Failed to revoke document', {
        error: error.message,
        documentId,
      });
      throw new Error(`BoldSign API Error: ${error.message}`);
    }
  }
}
