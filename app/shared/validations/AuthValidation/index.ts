import {
  SwitchClientAccountSchema,
  SetupPaymentIntentSchema,
  completeOnboardingSchema,
  AccountActivationSchema,
  ResendActivationSchema,
  PasskeyRegVerifySchema,
  ForgotPasswordSchema,
  ChangePasswordSchema,
  ResetPasswordSchema,
  PasskeyDeleteSchema,
  ConsentBodySchema,
  UserSignupSchema,
  LoginSchema,
} from './schemas';

export class AuthValidations {
  static activationToken = AccountActivationSchema;
  static consentBody = ConsentBodySchema;
  static resendActivation = ResendActivationSchema;
  static switchClientAccount = SwitchClientAccountSchema;
  static setupPaymentIntent = SetupPaymentIntentSchema;
  static emailValidation = ForgotPasswordSchema;
  static resetPassword = ResetPasswordSchema;
  static changePassword = ChangePasswordSchema;
  static signup = UserSignupSchema;
  static login = LoginSchema;
  static passkeyRegVerify = PasskeyRegVerifySchema;
  static passkeyDelete = PasskeyDeleteSchema;
  static completeOnboarding = completeOnboardingSchema;
}

export { completeOnboardingSchema };
