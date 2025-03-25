import {
  AccountActivationSchema,
  ResendActivationSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  UserSignupSchema,
  LoginSchema,
} from './schemas';

export class AuthValidations {
  static activationToken = AccountActivationSchema;
  static resendActivation = ResendActivationSchema;
  static emailValidation = ForgotPasswordSchema;
  static resetPassword = ResetPasswordSchema;
  static signup = UserSignupSchema;
  static login = LoginSchema;
}
