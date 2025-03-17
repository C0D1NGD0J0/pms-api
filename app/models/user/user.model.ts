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

    cids: [
      {
        roles: [{ type: String, required: true }],
        displayName: { type: String, required: true },
        cid: { type: String, required: true, index: true },
        isConnected: { type: Boolean, required: true, default: false },
        _id: false,
      },
    ],
    activationToken: { type: String, default: '' },
    isActive: { type: Boolean, default: false },
    passwordResetToken: { type: String, default: '' },
    activeCid: { type: String, required: true, index: true },
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
    // Hashing Password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

UserSchema.pre<Query<any, IUser>>('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() as UpdateQuery<IUser>;
  // Check if password is being updated
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

UserSchema.virtual('fullName').get(function () {
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
