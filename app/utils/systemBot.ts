import { Types } from 'mongoose';
import UserModel from '@models/user/user.model';

const SYSTEM_BOT_UID = 'SYSTEM_BOT_01';
let cachedId: Types.ObjectId | null = null;

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
