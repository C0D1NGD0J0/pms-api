import { envVariables } from '@shared/config';

/**
 * Stripe redirects the tenant to these URLs after checkout, so they must stay inside the app:
 * either a same-origin relative path ("/tenants/...") or an absolute URL on the configured
 * frontend origin (FRONTEND_URL). Protocol-relative ("//host") and backslash tricks are refused.
 */
export const isAllowedCheckoutReturnUrl = (value: string): boolean => {
  if (value.startsWith('/')) {
    return !value.startsWith('//') && !value.includes('\\');
  }
  try {
    const frontendOrigin = new URL(envVariables.FRONTEND.URL).origin;
    return new URL(value).origin === frontendOrigin;
  } catch {
    return false;
  }
};
