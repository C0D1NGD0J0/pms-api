import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  ExpensePaymentMethod,
  IExpenseDocument,
  ExpenseCategory,
} from '@interfaces/expense.interface';

const ExpenseSchema = new Schema<IExpenseDocument>(
  {
    expuid: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      default: () => generateShortUID(),
    },
    clientId: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
      index: true,
    },
    propertyId: {
      type: Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property is required'],
      index: true,
    },
    unitId: {
      type: Schema.Types.ObjectId,
      ref: 'PropertyUnit',
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be at least 1 cent'],
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
    },
    category: {
      type: String,
      enum: Object.values(ExpenseCategory),
      required: [true, 'Category is required'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: 500,
    },
    vendor: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(ExpensePaymentMethod),
      required: [true, 'Payment method is required'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ExpenseSchema.index({ clientId: 1, date: -1 });
ExpenseSchema.index({ clientId: 1, propertyId: 1, date: -1 });
ExpenseSchema.index({ clientId: 1, category: 1, date: -1 });

const ExpenseModel = model<IExpenseDocument>('Expense', ExpenseSchema);
if (process.env.SYNC_EXPENSE_INDEXES === 'true') {
  ExpenseModel.syncIndexes().catch((error) => {
    console.error('Failed to sync Expense indexes:', error);
  });
}

export default ExpenseModel;
