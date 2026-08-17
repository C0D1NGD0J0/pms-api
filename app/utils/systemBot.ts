import { Types } from 'mongoose';
import UserModel from '@models/user/user.model';
import { IRequestContext, RequestSource } from '@interfaces/utils.interface';

const SYSTEM_BOT_UID = 'SYSTEM_BOT_01';
let cachedId: Types.ObjectId | null = null;

/**
 * Builds a minimal IRequestContext for system-initiated operations (cron, event handlers)
 * that call service methods requiring a request context (e.g., leaseService.terminateLease).
 */
export async function buildSystemRequestContext(cuid: string): Promise<IRequestContext | null> {
  const botId = await getSystemBotUserId();
  if (!botId) return null;

  return {
    currentuser: {
      sub: botId.toString(),
      email: 'system@internal',
      preferences: { lang: 'en' },
      client: {
        cuid,
        displayname: 'System',
        role: 'super-admin',
        isVerified: true,
      },
    } as IRequestContext['currentuser'],
    userAgent: { isMobile: false, isBot: true },
    request: { path: '/system/offboarding', method: 'POST', params: {}, url: '', query: {} },
    langSetting: { lang: 'en' },
    timing: { startTime: Date.now() },
    service: { env: process.env.NODE_ENV || 'production' },
    source: RequestSource.API,
    requestId: `sys-closure-${cuid}-${Date.now()}`,
    timestamp: new Date(),
  };
}

/**
 * Returns the ObjectId of the system bot user, cached after first lookup.
 * The bot must be seeded via `scripts/seeds/seed-system-bot.ts` before first use.
 * Returns null if the bot user doesn't exist (e.g., in test environments).
 */
export async function getSystemBotUserId(): Promise<Types.ObjectId | null> {
  if (cachedId) return cachedId;

  const bot = await UserModel.findOne({ uid: SYSTEM_BOT_UID }).select('_id').lean();
  if (bot) {
    cachedId = bot._id as Types.ObjectId;
  }
  return cachedId;
}
