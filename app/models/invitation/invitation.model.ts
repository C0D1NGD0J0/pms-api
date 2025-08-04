import { Schema, model, Types } from 'mongoose';
import { ConflictError } from '@shared/customErrors';
import { IUserRole } from '@interfaces/user.interface';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import { IInvitationDocument } from '@interfaces/invitation.interface';

const logger = createLogger('InvitationModel');

const InvitationSchema = new Schema<IInvitationDocument>(
  {
    iuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: 'User',
      index: true,
    },
    inviteeEmail: {
      type: String,
      required: [true, 'Invitee email is required'],
      trim: true,
      lowercase: true,
      index: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    clientId: {
      index: true,
      ref: 'Client',
      type: Schema.Types.ObjectId,
      required: [true, 'Client ID is required'],
    },
    role: {
      type: String,
      required: [true, 'Role is required'],
      enum: Object.values(IUserRole),
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'pending', 'accepted', 'expired', 'revoked', 'sent'],
      default: 'pending',
      index: true,
    },
    invitationToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    },
    personalInfo: {
      firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        maxlength: 50,
      },
      lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        maxlength: 50,
      },
      phoneNumber: {
        type: String,
        trim: true,
        validate: {
          validator: function (v: string) {
            if (!v) return true;
            // Basic phone number validation
            return /^\+?[\d\s\-()]+$/.test(v);
          },
          message: 'Please provide a valid phone number',
        },
      },
    },
    metadata: {
      inviteMessage: {
        type: String,
        trim: true,
        maxlength: 500,
      },
      expectedStartDate: {
        type: Date,
      },
      employeeInfo: {
        type: Schema.Types.Mixed,
        default: undefined,
      },
      vendorInfo: {
        type: Schema.Types.Mixed,
        default: undefined,
      },
      remindersSent: {
        type: Number,
        default: 0,
        min: 0,
      },
      lastReminderSent: {
        type: Date,
      },
    },
    acceptedAt: {
      type: Date,
    },
    acceptedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    revokedAt: {
      type: Date,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    revokeReason: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    linkedVendorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

InvitationSchema.index({ clientId: 1, status: 1 });
InvitationSchema.index({ inviteeEmail: 1, clientId: 1 });
InvitationSchema.index({ expiresAt: 1 });

InvitationSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

InvitationSchema.virtual('inviteeFullName').get(function (this: IInvitationDocument) {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

InvitationSchema.pre('save', async function (this: IInvitationDocument, next) {
  try {
    if (this.isNew && ['pending', 'draft', 'sent'].includes(this.status)) {
      const InvitationModel = model<IInvitationDocument>('Invitation');

      const existingInvitation = await InvitationModel.findOne({
        inviteeEmail: this.inviteeEmail,
        clientId: this.clientId,
        status: { $in: ['draft', 'pending', 'sent'] },
        expiresAt: { $gt: new Date() },
      });

      if (existingInvitation) {
        return next(
          new ConflictError({
            message: 'An active invitation already exists for this email and client',
          })
        );
      }
    }

    if (['pending', 'sent'].includes(this.status) && this.expiresAt <= new Date()) {
      this.status = 'expired';
      logger.info(`Auto-expired invitation ${this.iuid}`);
    }

    next();
  } catch (error) {
    logger.error('Error in invitation pre-save hook:', error);
    next(error);
  }
});

InvitationSchema.methods.isValid = function (this: IInvitationDocument): boolean {
  return ['pending', 'draft', 'sent'].includes(this.status) && this.expiresAt > new Date();
};

InvitationSchema.methods.expire = function (
  this: IInvitationDocument
): Promise<IInvitationDocument> {
  this.status = 'expired';
  return this.save();
};

InvitationSchema.methods.revoke = function (
  this: IInvitationDocument,
  revokedBy: string,
  reason?: string
): Promise<IInvitationDocument> {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedBy = new Types.ObjectId(revokedBy);
  if (reason) this.revokeReason = reason;
  return this.save();
};

InvitationSchema.methods.accept = function (
  this: IInvitationDocument,
  acceptedBy: string
): Promise<IInvitationDocument> {
  this.status = 'accepted';
  this.acceptedAt = new Date();
  this.acceptedBy = new Types.ObjectId(acceptedBy);
  return this.save();
};

const InvitationModel = model<IInvitationDocument>('Invitation', InvitationSchema);

InvitationModel.syncIndexes();

export default InvitationModel;
