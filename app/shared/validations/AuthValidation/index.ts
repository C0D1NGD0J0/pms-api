import {
  completeOnboardingSchema,
  AccountActivationSchema,
  ResendActivationSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  ConsentBodySchema,
  UserSignupSchema,
  LoginSchema,
} from './schemas';

export class AuthValidations {
  static activationToken = AccountActivationSchema;
  static consentBody = ConsentBodySchema;
  static resendActivation = ResendActivationSchema;
  static emailValidation = ForgotPasswordSchema;
  static resetPassword = ResetPasswordSchema;
  static signup = UserSignupSchema;
  static login = LoginSchema;
  static completeOnboarding = completeOnboardingSchema;
}

export { completeOnboardingSchema };
