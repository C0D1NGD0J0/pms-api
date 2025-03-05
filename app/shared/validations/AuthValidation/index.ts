import {
  UserSignupSchema,
  ResetPasswordSchema,
  LoginSchema,
  ForgotPasswordSchema,
  AccountActivationSchema,
} from './schemas';

export class AuthValidations {
  static activationToken = AccountActivationSchema;
  static forgotPassword = ForgotPasswordSchema;
  static resetPassword = ResetPasswordSchema;
  static signup = UserSignupSchema;
  static login = LoginSchema;
}
