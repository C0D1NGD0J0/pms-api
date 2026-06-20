import dayjs from 'dayjs';
import crypto from 'crypto';
import { Readable } from 'stream';
import { envVariables } from '@shared/config';
import { ForbiddenError } from '@shared/customErrors';
import { CircuitBreaker, createLogger } from '@utils/index';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
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
  private readonly featureFlagService: FeatureFlagService;
  private readonly breaker: CircuitBreaker;

  constructor({ featureFlagService }: { featureFlagService: FeatureFlagService }) {
    this.apiKey = envVariables.BOLDSIGN.API_KEY;
    this.apiUrl = envVariables.BOLDSIGN.API_URL;
    this.webhookSecret = envVariables.BOLDSIGN.WEBHOOK_SECRET;
    this.featureFlagService = featureFlagService;

    this.documentApi = new DocumentApi(this.apiUrl);
    this.documentApi.setApiKey(this.apiKey);

    this.breaker = new CircuitBreaker({
      name: 'boldsign',
      failureThreshold: 5,
      cooldownMs: 60_000,
      isFailure: (err) => {
        const status = (err as any)?.statusCode ?? (err as any)?.status;
        return !status || status >= 500;
      },
      logger: this.log,
    });
  }

  /**
   * Send document for signature via BoldSign
   */
  async sendDocumentForSignature(params: ISendDocumentParams): Promise<IBoldSignDocumentResponse> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.ESIGNATURE)) {
      throw new ForbiddenError({ message: 'E-signature feature is currently unavailable.' });
    }
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

      sendForSign.expiryDays = params.expiryDays || 3;
      sendForSign.reminderSettings = {
        reminderDays: 5,
        reminderCount: 3,
      };
      sendForSign.enableSigningOrder = false;

      if (params.senderInfo) {
        sendForSign.onBehalfOf = params.senderInfo.email;
      }

      const response = await this.breaker.exec(() => this.documentApi.sendDocument(sendForSign));
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
      const response = await this.breaker.exec(() => this.documentApi.getProperties(documentId));

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
      const buffer = await this.breaker.exec(() => this.documentApi.downloadDocument(documentId));

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

  verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string): void {
    if (!signatureHeader) {
      throw new Error('Missing BoldSign signature header');
    }

    const parts: { timestamp: string; signatures: string[] } = { timestamp: '', signatures: [] };
    for (const part of signatureHeader.split(',')) {
      const [key, value] = part.trim().split('=', 2);
      if (key === 't') parts.timestamp = value;
      else if (key === 's0' || key === 's1') parts.signatures.push(value);
    }

    if (!parts.timestamp || parts.signatures.length === 0) {
      throw new Error('Invalid BoldSign signature header format');
    }

    const payload = `${parts.timestamp}.${rawBody.toString()}`;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload, 'utf8')
      .digest('hex');

    const isValid = parts.signatures.some((sig) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
      } catch {
        return false;
      }
    });

    if (!isValid) {
      throw new Error('BoldSign webhook signature verification failed');
    }

    const timestamp = parseInt(parts.timestamp, 10);
    if (!Number.isFinite(timestamp)) {
      throw new Error('BoldSign webhook timestamp is invalid');
    }
    const age = dayjs().unix() - timestamp;
    if (age < 0 || age > 300) {
      throw new Error('BoldSign webhook timestamp outside allowed window');
    }
  }

  async revokeDocument(documentId: string, reason: string) {
    try {
      const revokeDocumentRequest = new RevokeDocument();
      revokeDocumentRequest.message = reason;
      revokeDocumentRequest.onBehalfOf = envVariables.BOLDSIGN.DEFAULT_SENDER_EMAIL; // this should be onbehalf email used to send
      const result = await this.breaker.exec(() =>
        this.documentApi.revokeDocument(documentId, revokeDocumentRequest)
      );
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
