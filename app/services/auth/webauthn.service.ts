import crypto from 'crypto';
import Logger from 'bunyan';
import { AuthCache } from '@caching/index';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { ProfileDAO, UserDAO } from '@dao/index';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { IPasskeyCredential, IUserDocument } from '@interfaces/user.interface';
import { UnauthorizedError, BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

interface IConstructor {
  profileDAO: ProfileDAO;
  authCache: AuthCache;
  userDAO: UserDAO;
}

export class WebAuthnService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly authCache: AuthCache;
  private readonly profileDAO: ProfileDAO;

  constructor({ userDAO, authCache, profileDAO }: IConstructor) {
    this.log = createLogger('WebAuthnService');
    this.userDAO = userDAO;
    this.authCache = authCache;
    this.profileDAO = profileDAO;
  }

  private get rpID(): string {
    return envVariables.WEBAUTHN.RP_ID;
  }

  private get rpName(): string {
    return envVariables.WEBAUTHN.RP_NAME;
  }

  private get rpOrigin(): string {
    return envVariables.WEBAUTHN.RP_ORIGIN;
  }

  async generateRegistrationOptions(
    userId: string
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.userDAO.getUserById(userId);
    if (!user) {
      throw new NotFoundError({ message: 'User not found' });
    }

    const profile = await this.profileDAO.findFirst({ user: user._id });
    const displayName = profile?.personalInfo
      ? `${profile.personalInfo.firstName} ${profile.personalInfo.lastName}`
      : user.email;

    const existingPasskeys = await this.userDAO.getUserPasskeys(userId);

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: user.email,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports,
      })),
    });

    await this.authCache.saveWebAuthnRegChallenge(userId, options.challenge);

    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    friendlyName: string
  ): Promise<Omit<IPasskeyCredential, 'publicKey'>> {
    const expectedChallenge = await this.authCache.getAndDeleteWebAuthnRegChallenge(userId);
    if (!expectedChallenge) {
      throw new BadRequestError({
        message: 'Registration challenge expired or not found. Please try again.',
      });
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.rpOrigin,
      expectedRPID: this.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestError({ message: 'Passkey registration verification failed.' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const passkeyCredential: IPasskeyCredential = {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports,
      friendlyName,
      createdAt: new Date(),
      lastUsedAt: null,
    };

    await this.userDAO.addPasskey(userId, passkeyCredential);

    this.log.info({ userId, credentialId: credential.id }, 'Passkey registered');

    const { publicKey: _pk, ...safeCredential } = passkeyCredential;
    return safeCredential;
  }

  async generateAuthenticationOptions(
    email: string
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const user = await this.userDAO.getActiveUserByEmail(email);
    if (!user) {
      throw new NotFoundError({ message: 'User not found' });
    }

    const passkeys = await this.userDAO.getUserPasskeys(user._id.toString());
    if (passkeys.length === 0) {
      throw new BadRequestError({ message: 'No passkeys registered for this account.' });
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports,
      })),
      userVerification: 'preferred',
    });

    await this.authCache.saveWebAuthnAuthChallenge(email, options.challenge);

    return options;
  }

  async verifyAuthentication(
    email: string,
    response: AuthenticationResponseJSON
  ): Promise<IUserDocument> {
    const expectedChallenge = await this.authCache.getAndDeleteWebAuthnAuthChallenge(email);
    if (!expectedChallenge) {
      throw new BadRequestError({
        message: 'Authentication challenge expired or not found. Please try again.',
      });
    }

    const credentialId = response.id;
    const user = await this.userDAO.findByPasskeyCredentialId(credentialId);
    if (!user) {
      throw new UnauthorizedError({ message: 'Passkey not recognized.' });
    }

    const storedPasskey = user.passkeys?.find((pk) => pk.credentialId === credentialId);
    if (!storedPasskey) {
      throw new UnauthorizedError({ message: 'Passkey not recognized.' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.rpOrigin,
      expectedRPID: [this.rpID],
      credential: {
        id: storedPasskey.credentialId,
        publicKey: isoBase64URL.toBuffer(storedPasskey.publicKey),
        counter: storedPasskey.counter,
        transports: storedPasskey.transports,
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedError({ message: 'Passkey authentication failed.' });
    }

    await this.userDAO.updatePasskeyCounter(
      user._id.toString(),
      credentialId,
      verification.authenticationInfo.newCounter
    );

    this.log.info({ userId: user._id, credentialId }, 'Passkey authentication successful');

    return user;
  }

  async generateDiscoverableAuthOptions(): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    sessionId: string;
  }> {
    const sessionId = crypto.randomBytes(32).toString('hex');

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
      // No allowCredentials — browser discovers resident credentials on device
    });

    await this.authCache.saveWebAuthnAuthChallenge(sessionId, options.challenge);

    return { options, sessionId };
  }

  async verifyDiscoverableAuthentication(
    sessionId: string,
    response: AuthenticationResponseJSON
  ): Promise<IUserDocument> {
    const expectedChallenge = await this.authCache.getAndDeleteWebAuthnAuthChallenge(sessionId);
    if (!expectedChallenge) {
      throw new BadRequestError({
        message: 'Authentication challenge expired or not found. Please try again.',
      });
    }

    const credentialId = response.id;
    const user = await this.userDAO.findByPasskeyCredentialId(credentialId);
    if (!user) {
      throw new UnauthorizedError({ message: 'Passkey not recognized.' });
    }

    const storedPasskey = user.passkeys?.find((pk) => pk.credentialId === credentialId);
    if (!storedPasskey) {
      throw new UnauthorizedError({ message: 'Passkey not recognized.' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.rpOrigin,
      expectedRPID: [this.rpID],
      credential: {
        id: storedPasskey.credentialId,
        publicKey: isoBase64URL.toBuffer(storedPasskey.publicKey),
        counter: storedPasskey.counter,
        transports: storedPasskey.transports,
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedError({ message: 'Passkey authentication failed.' });
    }

    await this.userDAO.updatePasskeyCounter(
      user._id.toString(),
      credentialId,
      verification.authenticationInfo.newCounter
    );

    this.log.info(
      { userId: user._id, credentialId },
      'Discoverable passkey authentication successful'
    );

    return user;
  }

  async deletePasskey(userId: string, credentialId: string): Promise<void> {
    await this.userDAO.removePasskey(userId, credentialId);

    const remaining = await this.userDAO.getUserPasskeys(userId);
    if (remaining.length === 0) {
      const profile = await this.profileDAO.findFirst({ user: userId });
      if (profile?.settings?.loginType === 'passkey') {
        await this.profileDAO.updateById(profile._id.toString(), {
          'settings.loginType': 'password',
        });
      }
    }

    this.log.info({ userId, credentialId }, 'Passkey deleted');
  }
}
