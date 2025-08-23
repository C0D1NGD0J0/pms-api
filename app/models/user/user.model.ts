import bcrypt from 'bcryptjs';
import uniqueValidator from 'mongoose-unique-validator';
import { UpdateQuery, Schema, Query, model } from 'mongoose';
import { IUserDocument, IUser } from '@interfaces/user.interface';

const UserSchema = new Schema<IUserDocument>(
  {
    password: {
      type: String,
      required: [true, 'Password is required.'],
      minlength: 6,
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email address.'],
      unique: true,
      index: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please add a valid email'],
    },

    cuids: [
      {
        roles: [{ type: String, required: true }],
        clientDisplayName: { type: String, required: true },
        cuid: { type: String, required: true, index: true },
        linkedVendorId: { type: String, trim: true, default: null }, // Optional, for if the user is linked to a vendor
        isConnected: { type: Boolean, required: true, default: false },
        _id: false,
      },
    ],
    activationToken: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    passwordResetToken: { type: String, default: '' },
    activecuid: { type: String, required: true, index: true },
    uid: { type: String, required: true, index: true },
    deletedAt: { type: Date, default: null, select: false },
    activationTokenExpiresAt: { type: Date, default: null },
    passwordResetTokenExpiresAt: { type: Number, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

UserSchema.pre('save', async function (this: IUserDocument, next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

UserSchema.pre<Query<any, IUser>>('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() as UpdateQuery<IUser>;
  if (update.password) {
    const salt = await bcrypt.genSalt(10);
    update.password = await bcrypt.hash(update.password, salt);
  }

  next();
});

UserSchema.virtual('profile', {
  ref: 'Profile',
  localField: '_id',
  foreignField: 'user',
  justOne: true,
});

UserSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

UserSchema.virtual('fullname').get(function () {
  if (this.profile && this.profile.personalInfo) {
    return `${this.profile.personalInfo.firstName} ${this.profile.personalInfo.lastName}`;
  }
  return null;
});

UserSchema.methods.validatePassword = async function (pwd: string): Promise<boolean> {
  return await bcrypt.compare(pwd, this.password);
};

const UserModel = model<IUserDocument>('User', UserSchema);

UserModel.syncIndexes();

export default UserModel;
