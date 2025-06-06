import { db } from '@tests/configs/db.config';

const teardown = async () => {
  console.log('done!');
  await db.clearTestDB();
  await db.disconnectTestDB();
  process.exit(1);
};

export default teardown;
