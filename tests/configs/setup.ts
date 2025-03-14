import { db } from '@tests/configs/db.config';
// import { getServerInstance } from '@root/server';

const setup = async () => {
  console.log('Start!');
  db.connectTestDB();
};

export default setup;
