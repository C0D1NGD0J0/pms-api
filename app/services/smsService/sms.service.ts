import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ISuccessReturnData } from '@interfaces/index';
import { ICurrentUser } from '@interfaces/user.interface';

export class SMSService {
  private readonly log: Logger;

  constructor() {
    this.log = createLogger('SMSService');
  }

  async sendOTP(
    cuid: string,
    currentUser: ICurrentUser,
    data: { phoneNumber: string }
  ): Promise<ISuccessReturnData<undefined>> {
    this.log.info({ cuid, currentUser: currentUser?.sub, data }, 'SMSService.sendOTP called');
    return { success: true, data: undefined, message: '' };
  }

  async verifyOTP(
    cuid: string,
    currentUser: ICurrentUser,
    data: { phoneNumber: string; otp: string }
  ): Promise<ISuccessReturnData<undefined>> {
    this.log.info({ cuid, currentUser: currentUser?.sub, data }, 'SMSService.verifyOTP called');
    return { success: true, data: undefined, message: '' };
  }

  async updateSMSConsent(
    cuid: string,
    currentUser: ICurrentUser,
    data: { consent: boolean }
  ): Promise<ISuccessReturnData<undefined>> {
    this.log.info(
      { cuid, currentUser: currentUser?.sub, data },
      'SMSService.updateSMSConsent called'
    );
    return { success: true, data: undefined, message: '' };
  }

  async getQuotaStatus(
    cuid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<{ remainingQuota: number; totalQuota: number }>> {
    this.log.info({ cuid, currentUser: currentUser?.sub }, 'SMSService.getQuotaStatus called');
    return { success: true, data: { remainingQuota: 100, totalQuota: 1000 }, message: '' };
  }

  async getSMSHistory(
    cuid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<{ phoneNumber: string; timestamp: string; status: string }[]>> {
    this.log.info({ cuid, currentUser: currentUser?.sub }, 'SMSService.getSMSHistory called');
    return {
      success: true,
      data: [
        { phoneNumber: '+1234567890', timestamp: new Date().toISOString(), status: 'sent' },
        { phoneNumber: '+1234567890', timestamp: new Date().toISOString(), status: 'delivered' },
      ],
      message: '',
    };
  }
}
