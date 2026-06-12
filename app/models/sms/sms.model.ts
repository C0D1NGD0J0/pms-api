import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import { ISMSLogDocument, SMSMessageType, SMSStatus } from '@interfaces/index';

const SMSLogSchema = new Schema<ISMSLogDocument>(
  {
    smsuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
    },
    recipientPhone: {
      type: String,
      required: [true, 'Recipient phone is required'],
    },
    messageType: {
      type: String,
      enum: Object.values(SMSMessageType),
      required: [true, 'Message type is required'],
    },
    status: {
      type: String,
      enum: Object.values(SMSStatus),
      default: SMSStatus.QUEUED,
      required: true,
    },
    twilioSid: { type: String },
    errorCode: { type: String },
    sentBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SMSLogSchema.index({ cuid: 1, createdAt: -1 });
SMSLogSchema.index({ cuid: 1, messageType: 1, sentAt: -1 });
// Auto-purge after 2 years (63,072,000 seconds)
SMSLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 63072000 });

const SMSLogModel = model<ISMSLogDocument>('SMSLog', SMSLogSchema);
SMSLogModel.syncIndexes();

export default SMSLogModel;
