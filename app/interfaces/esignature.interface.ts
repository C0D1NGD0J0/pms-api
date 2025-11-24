import { Types } from 'mongoose';

export interface IBoldSignWebhookPayload {
  signers: Array<{
    signerName: string;
    signerEmail: string;
    signerType: string;
    signerStatus: string;
    signedDate?: string;
    ipAddress?: string;
  }>;
  event: 'Sent' | 'Viewed' | 'Signed' | 'Completed' | 'Declined' | 'Reassigned' | 'Expired';
  completedDate?: string;
  declineReason?: string;
  createdDate: string;
  expiryDate?: string;
  documentId: string;
  webhookId: string;
  status: string;
  title: string;
}

export interface IDocumentStatus {
  signers: Array<{
    name: string;
    email: string;
    status: 'NotStarted' | 'InProgress' | 'Completed' | 'Declined';
    signedDate?: string;
  }>;
  status: 'Draft' | 'Sent' | 'InProgress' | 'Completed' | 'Declined' | 'Expired';
  documentId: string;
}

export interface ISendDocumentParams {
  pdfFileName: string;
  expiryDays?: number;
  signers: ISigner[];
  pdfBuffer: Buffer;
  message?: string;
  title: string;
}

export interface IBoldSignDocumentResponse {
  signers: Array<{
    signerEmail: string;
    signerOrder: number;
    signLink: string;
  }>;
  documentId: string;
}

export interface ISigner {
  role: 'tenant' | 'co_tenant' | 'landlord' | 'property_manager';
  userId?: Types.ObjectId;
  email: string;
  name: string;
}
