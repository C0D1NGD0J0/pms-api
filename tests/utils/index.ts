import supertest from 'supertest';
import { getServerInstance } from '@root/server';

const { appInstance } = getServerInstance();
export const appRequest = supertest(appInstance);
