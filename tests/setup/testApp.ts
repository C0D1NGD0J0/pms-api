import jwt from 'jsonwebtoken';
import { App } from '@root/app';
import { container } from '@di/index';
import { envVariables } from '@shared/config';
import express, { Application } from 'express';
import { DatabaseService } from '@database/index';

/**
 * Creates a test Express application for integration testing
 * This sets up the full Express app with all middleware and routes
 * but without starting the HTTP server
 */
export const createTestApp = (): Application => {
  const expApp = express();

  // Get database service from container
  const dbService = container.resolve<DatabaseService>('dbService');

  // Initialize the app with all middleware and routes
  const app = new App(expApp, dbService);
  app.initConfig();

  return expApp;
};

/**
 * Helper to create an auth token for testing
 * Generates a properly signed JWT token for authenticated requests
 * that matches what the authentication middleware expects
 */
export const createAuthToken = (user: any): string => {
  const activeCuid = user.activecuid;
  const clientInfo = user.cuids.find((c: any) => c.cuid === activeCuid);

  // Must match the shape AuthTokenService.generateToken produces:
  // jwt.sign({ data: payload }, secret, options)
  // verifyJwtToken reads decoded.data.sub and decoded.data.cuid
  const data = {
    uid: user.uid,
    sub: user._id.toString(),
    email: user.email,
    cuid: activeCuid,
    rememberMe: false,
    client: {
      cuid: activeCuid,
      role: clientInfo?.roles[0] || 'staff',
    },
  };

  const secret = envVariables.JWT.SECRET || 'WeAreUnited4Life';
  return jwt.sign({ data }, secret, { expiresIn: '1h' });
};

/**
 * Returns a supertest-compatible cookie header string for the given token.
 * The auth middleware reads from req.cookies['accessToken'] only —
 * Authorization headers are not supported.
 */
export const authCookie = (token: string): string => `accessToken=${token}`;
