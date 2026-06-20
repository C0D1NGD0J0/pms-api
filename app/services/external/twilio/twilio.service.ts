import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import Twilio, { validateRequest } from 'twilio';

export class TwilioService {
  private readonly log: Logger;
  private readonly client: Twilio.Twilio;
  private readonly authToken: string;
  private readonly verifyServiceSid: string;
  private readonly messagingServiceSid: string;

  constructor() {
    this.log = createLogger('TwilioService');

    const { ACCOUNT_SID, AUTH_TOKEN, MESSAGING_SERVICE_SID, VERIFY_SERVICE_SID } =
      envVariables.TWILIO;

    if (envVariables.FEATURES.SMS_ENABLED) {
      const missing = [
        !ACCOUNT_SID && 'TWILIO_ACCOUNT_SID',
        !AUTH_TOKEN && 'TWILIO_AUTH_TOKEN',
        !VERIFY_SERVICE_SID && 'TWILIO_VERIFY_SERVICE_SID',
        !MESSAGING_SERVICE_SID && 'TWILIO_MESSAGING_SERVICE_SID',
      ].filter(Boolean);

      if (missing.length) {
        throw new Error(`${missing.join(', ')} required when SMS feature is enabled`);
      }
    }

    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      this.log.warn('Twilio credentials not configured — SMS features will be unavailable');
    }

    this.authToken = AUTH_TOKEN || '';
    this.verifyServiceSid = VERIFY_SERVICE_SID;
    this.messagingServiceSid = MESSAGING_SERVICE_SID;
    this.client = Twilio(ACCOUNT_SID || 'missing', AUTH_TOKEN || 'missing');
  }

  /**
   * Send an SMS via Twilio Messaging Service.
   * Twilio auto-selects the best sender from the pool.
   */
  async sendSMS(to: string, body: string): Promise<{ sid: string; status: string }> {
    try {
      const apiBaseUrl = process.env.API_BASE_URL;
      const statusCallback = apiBaseUrl ? `${apiBaseUrl}/api/v1/webhooks/twilio/status` : undefined;

      const message = await this.client.messages.create({
        messagingServiceSid: this.messagingServiceSid,
        to,
        body,
        ...(statusCallback && { statusCallback }),
      });

      this.log.info({ sid: message.sid, to }, 'SMS sent successfully');
      return { sid: message.sid, status: message.status };
    } catch (error: any) {
      this.log.error({ error, to }, 'Failed to send SMS');
      throw new Error(`Twilio API Error: ${error.message}`);
    }
  }

  /**
   * Send an OTP verification code via Twilio Verify API.
   * Twilio manages OTP generation, delivery, and 10-minute expiry.
   */
  async sendOTP(to: string): Promise<{ sid: string; status: string }> {
    try {
      const verification = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({ to, channel: 'sms' });

      this.log.info({ sid: verification.sid, to }, 'OTP sent successfully');
      return { sid: verification.sid, status: verification.status };
    } catch (error: any) {
      this.log.error({ error, to }, 'Failed to send OTP');
      throw new Error(`Twilio API Error: ${error.message}`);
    }
  }

  /**
   * Verify an OTP code via Twilio Verify API.
   */
  async verifyOTP(to: string, code: string): Promise<{ valid: boolean; status: string }> {
    try {
      const check = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({ to, code });

      this.log.info({ to, valid: check.valid }, 'OTP verification check completed');
      return { valid: check.valid, status: check.status };
    } catch (error: any) {
      this.log.error({ error, to }, 'Failed to verify OTP');
      throw new Error(`Twilio API Error: ${error.message}`);
    }
  }

  /**
   * Validate an incoming Twilio webhook request using X-Twilio-Signature.
   */
  isValidWebhookSignature(
    twilioSignature: string,
    url: string,
    params: Record<string, any>
  ): boolean {
    if (!this.authToken) return false;
    return validateRequest(this.authToken, twilioSignature, url, params);
  }
}
