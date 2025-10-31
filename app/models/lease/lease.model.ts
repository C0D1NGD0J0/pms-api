import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import { ILeaseDocument, LeaseStatus, LeaseType } from '@interfaces/lease.interface';

const logger = createLogger('LeaseModel');

const LeaseSchema = new Schema<ILeaseDocument>(
  {
    luid: {
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
      index: true,
      immutable: true,
    },
    leaseNumber: {
      type: String,
      unique: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(LeaseStatus),
      default: LeaseStatus.DRAFT,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(LeaseType),
      default: LeaseType.FIXED_TERM,
      required: [true, 'Lease type is required'],
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Tenant ID is required'],
      index: true,
    },
    useInvitationIdAsTenantId: {
      type: Boolean,
      default: false,
      index: true,
    },
    property: {
      id: {
        type: Schema.Types.ObjectId,
        ref: 'Property',
        required: [true, 'Property ID is required'],
        index: true,
      },
      unitId: {
        type: Schema.Types.ObjectId,
        ref: 'PropertyUnit',
        index: true,
      },
      address: {
        type: String,
        required: [true, 'Property address is required'],
        trim: true,
      },
    },
    duration: {
      startDate: {
        type: Date,
        required: [true, 'Lease start date is required'],
        index: true,
      },
      endDate: {
        type: Date,
        required: [true, 'Lease end date is required'],
        index: true,
        validate: {
          validator: function (this: ILeaseDocument, value: Date) {
            return !this.duration?.startDate || value > this.duration.startDate;
          },
          message: 'End date must be after start date',
        },
      },
      moveInDate: {
        type: Date,
        validate: {
          validator: function (this: ILeaseDocument, value: Date) {
            return !this.duration?.startDate || value >= this.duration.startDate;
          },
          message: 'Move-in date cannot be before start date',
        },
      },
      moveOutDate: {
        type: Date,
        validate: {
          validator: function (this: ILeaseDocument, value: Date) {
            return !this.duration?.endDate || value <= this.duration.endDate;
          },
          message: 'Move-out date cannot be after end date',
        },
      },
      terminationDate: {
        type: Date,
      },
    },
    fees: {
      monthlyRent: {
        type: Number,
        required: [true, 'Monthly rent is required'],
        min: [0, 'Monthly rent cannot be negative'],
      },
      securityDeposit: {
        type: Number,
        required: [true, 'Security deposit is required'],
        min: [0, 'Security deposit cannot be negative'],
        default: 0,
      },
      rentDueDay: {
        type: Number,
        required: [true, 'Rent due day is required'],
        min: [1, 'Rent due day must be between 1-31'],
        max: [31, 'Rent due day must be between 1-31'],
        default: 1,
      },
      currency: {
        type: String,
        required: [true, 'Currency is required'],
        default: 'USD',
        uppercase: true,
        trim: true,
      },
      lateFeeAmount: {
        type: Number,
        min: 0,
        default: 0,
      },
      lateFeeDays: {
        type: Number,
        min: 1,
        default: 5,
      },
      lateFeeType: {
        type: String,
        enum: ['fixed', 'percentage'],
        default: 'fixed',
      },
      lateFeePercentage: {
        type: Number,
        min: 0,
        max: 100,
      },
      acceptedPaymentMethod: {
        type: String,
        enum: ['e-transfer', 'credit_card', 'crypto'],
      },
    },
    coTenants: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        email: {
          type: String,
          required: true,
          trim: true,
          lowercase: true,
          match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
        },
        phone: {
          type: String,
          required: true,
          trim: true,
        },
        occupation: {
          type: String,
          trim: true,
        },
        _id: false,
      },
    ],
    utilitiesIncluded: [
      {
        type: String,
        enum: [
          'water',
          'gas',
          'electricity',
          'internet',
          'cable',
          'trash',
          'sewer',
          'heating',
          'cooling',
        ],
      },
    ],
    petPolicy: {
      allowed: {
        type: Boolean,
        required: true,
        default: false,
      },
      deposit: {
        type: Number,
        min: 0,
        default: 0,
      },
      types: [
        {
          type: String,
          trim: true,
        },
      ],
      maxPets: {
        type: Number,
        min: 0,
        default: 0,
      },
    },
    legalTerms: {
      text: {
        type: String,
        trim: true,
      },
      html: {
        type: String,
      },
      url: {
        type: String,
        trim: true,
      },
    },
    renewalOptions: {
      autoRenew: {
        type: Boolean,
        default: false,
      },
      renewalTermMonths: {
        type: Number,
        min: 1,
        max: 24,
      },
      noticePeriodDays: {
        type: Number,
        min: 1,
        default: 30,
      },
    },
    leaseDocument: [
      {
        documentType: {
          type: String,
          enum: ['lease_agreement', 'addendum', 'amendment', 'renewal', 'termination', 'other'],
          default: 'lease_agreement',
        },
        url: {
          type: String,
          required: true,
        },
        key: {
          type: String,
          required: true,
        },
        filename: {
          type: String,
          required: true,
        },
        mimeType: {
          type: String,
          default: 'application/pdf',
        },
        size: {
          type: Number,
          min: 0,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        uploadedBy: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        _id: false,
      },
    ],
    signingMethod: {
      type: String,
      enum: ['manual', 'electronic', 'pending'],
      default: 'pending',
      required: true,
    },
    signedDate: {
      type: Date,
      index: true,
    },
    eSignature: {
      provider: {
        type: String,
        enum: ['hellosign', 'docusign', 'pandadoc', 'boldsign', 'signwell', 'zoho'],
        required: false,
      },
      envelopeId: {
        type: String,
        trim: true,
      },
      status: {
        type: String,
        enum: ['draft', 'sent', 'signed', 'declined', 'voided'],
        default: 'draft',
      },
      sentAt: {
        type: Date,
      },
      completedAt: {
        type: Date,
      },
      signingUrl: {
        type: String,
        trim: true,
      },
      declinedReason: {
        type: String,
        trim: true,
      },
    },
    signatures: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        role: {
          type: String,
          enum: ['tenant', 'co_tenant', 'landlord', 'property_manager'],
          required: true,
        },
        signedAt: {
          type: Date,
          required: true,
          default: Date.now,
        },
        signatureMethod: {
          type: String,
          enum: ['manual', 'electronic'],
          required: true,
        },
        ipAddress: {
          type: String,
          trim: true,
        },
        providerSignatureId: {
          type: String,
          trim: true,
        },
        _id: false,
      },
    ],
    terminationReason: {
      type: String,
      trim: true,
    },
    internalNotes: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator user ID is required'],
      index: true,
    },
    lastModifiedBy: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        name: {
          type: String,
          required: true,
          trim: true,
        },
        date: {
          type: Date,
          required: true,
          default: Date.now,
        },
        action: {
          type: String,
          enum: ['created', 'updated', 'activated', 'terminated', 'cancelled', 'renewed'],
          required: true,
        },
        _id: false,
      },
    ],
    approvalStatus: {
      type: String,
      enum: ['approved', 'rejected', 'pending', 'draft'],
      default: 'draft',
      index: true,
    },
    approvalDetails: [
      {
        action: {
          type: String,
          enum: ['created', 'submitted', 'approved', 'rejected', 'updated', 'overridden'],
          required: true,
        },
        actor: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        timestamp: {
          type: Date,
          required: true,
          default: Date.now,
        },
        notes: {
          type: String,
          trim: true,
        },
        _id: false,
      },
    ],
    pendingChanges: {
      type: Schema.Types.Mixed,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

LeaseSchema.index({ cuid: 1, status: 1 });
LeaseSchema.index({ cuid: 1, tenantId: 1 });
LeaseSchema.index({ cuid: 1, useInvitationIdAsTenantId: 1, tenantId: 1 });
LeaseSchema.index({ cuid: 1, 'property.id': 1 });
LeaseSchema.index({ cuid: 1, 'property.unitId': 1 });
LeaseSchema.index({ cuid: 1, 'duration.endDate': 1, status: 1 });
LeaseSchema.index({ cuid: 1, 'duration.startDate': 1, 'duration.endDate': 1 });
LeaseSchema.index({ cuid: 1, createdAt: -1 });
LeaseSchema.index({ cuid: 1, approvalStatus: 1 });

/**
 * remaining days until lease expiration
 */
LeaseSchema.virtual('daysUntilExpiry').get(function (this: ILeaseDocument) {
  if (!this.duration?.endDate) return null;
  const today = new Date();
  const endDate = new Date(this.duration.endDate);
  const diffTime = endDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

/**
 * lease duration in months
 */
LeaseSchema.virtual('durationMonths').get(function (this: ILeaseDocument) {
  if (!this.duration?.startDate || !this.duration?.endDate) return null;
  const start = new Date(this.duration.startDate);
  const end = new Date(this.duration.endDate);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return months;
});

/**
 * returns true if lease expires within 60 days
 */
LeaseSchema.virtual('isExpiringSoon').get(function (this: ILeaseDocument) {
  const daysUntilExpiry = this.daysUntilExpiry;
  return daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 60;
});

LeaseSchema.virtual('isActive').get(function (this: ILeaseDocument) {
  return this.status === LeaseStatus.ACTIVE;
});

/**
 * calculates total monthly fees including rent and pet fees
 */
LeaseSchema.virtual('totalMonthlyFees').get(function (this: ILeaseDocument) {
  let total = this.fees?.monthlyRent || 0;
  if (this.petPolicy?.monthlyFee) {
    total += this.petPolicy.monthlyFee;
  }
  return total;
});

LeaseSchema.pre('save', async function (this: ILeaseDocument, next) {
  try {
    // Generate lease number on new document
    if (this.isNew && !this.leaseNumber) {
      const year = new Date().getFullYear();
      const shortId = generateShortUID(5);
      this.leaseNumber = `L${year}-${shortId}`;
    }

    // Validate late fee configuration
    if (this.fees?.lateFeeType === 'percentage' && !this.fees?.lateFeePercentage) {
      throw new Error('Late fee percentage is required when late fee type is percentage');
    }

    // Validate renewal options
    if (this.renewalOptions?.autoRenew && !this.renewalOptions?.renewalTermMonths) {
      throw new Error('Renewal term months is required when auto-renew is enabled');
    }

    // Validate pet policy
    if (this.petPolicy?.allowed && this.petPolicy.maxPets === 0) {
      throw new Error('Maximum number of pets must be specified when pets are allowed');
    }

    next();
  } catch (error) {
    logger.error('Pre-save validation error:', error);
    next(error as Error);
  }
});

LeaseSchema.pre('validate', function (this: ILeaseDocument, next) {
  try {
    // Validate eSignature provider is required when signingMethod is 'electronic'
    if (this.signingMethod === 'electronic') {
      if (!this.eSignature?.provider) {
        throw new Error(
          'E-signature provider is required when signing method is electronic. Please specify a provider (boldsign, hellosign, docusign, etc.)'
        );
      }
    }

    // Validate that active/pending_signature leases are approved
    if ([LeaseStatus.PENDING_SIGNATURE, LeaseStatus.ACTIVE].includes(this.status)) {
      if (this.approvalStatus !== 'approved') {
        throw new Error(
          `Cannot set lease status to '${this.status}'. Lease must be approved first. Current approval status: '${this.approvalStatus || 'draft'}'`
        );
      }
    }

    // Validate that active/pending_signature leases have required documents
    if ([LeaseStatus.PENDING_SIGNATURE, LeaseStatus.ACTIVE].includes(this.status)) {
      if (!this.leaseDocument || this.leaseDocument.length === 0) {
        throw new Error('Lease document is required for active or pending signature leases');
      }
    }

    if (this.status === LeaseStatus.ACTIVE) {
      if (!this.signedDate) {
        throw new Error('Signed date is required for active leases');
      }

      // Must have signing method set (not 'pending')
      if (!this.signingMethod || this.signingMethod === 'pending') {
        throw new Error(
          'Signing method must be set to manual or electronic before activating lease'
        );
      }

      // If electronic signing, must have completed e-signature
      if (this.signingMethod === 'electronic') {
        if (!this.eSignature?.status || this.eSignature.status !== 'signed') {
          throw new Error(
            'Electronic signature must be completed (status: signed) before activating lease'
          );
        }
      }

      if (!this.signatures || this.signatures.length === 0) {
        throw new Error('At least one signature (tenant) is required to activate lease');
      }

      const tenantSigned = this.signatures.some(
        (sig) => sig.userId.toString() === this.tenantId.toString() && sig.role === 'tenant'
      );
      if (!tenantSigned) {
        throw new Error('Tenant must sign the lease before it can be activated');
      }
    }

    if (this.status === LeaseStatus.TERMINATED) {
      if (!this.duration?.terminationDate) {
        throw new Error('Termination date is required for terminated leases');
      }
      if (!this.terminationReason) {
        throw new Error('Termination reason is required for terminated leases');
      }
    }

    next();
  } catch (error) {
    next(error as Error);
  }
});

/**
 * checks for overlapping leases
 */
LeaseSchema.methods.hasOverlap = function (startDate: Date, endDate: Date): boolean {
  if (!this.duration?.startDate || !this.duration?.endDate) return false;
  const leaseStart = new Date(this.duration.startDate);
  const leaseEnd = new Date(this.duration.endDate);
  return leaseStart <= endDate && leaseEnd >= startDate;
};

LeaseSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

const LeaseModel = model<ILeaseDocument>('Lease', LeaseSchema);

LeaseModel.syncIndexes()
  .then(() => logger.info('Lease model indexes synced successfully'))
  .catch((err) => logger.error('Error syncing Lease model indexes:', err));

export default LeaseModel;
