/**
 * Runs before any module is loaded (jest `setupFiles`), so these values win over `.env`
 * (dotenv never overrides variables that are already set).
 *
 * Tests use their own Redis database: a developer's running `npm run dev` worker reads
 * database 0, and would otherwise pick up and process jobs the tests enqueue — including
 * sending their emails.
 */
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379/15';
