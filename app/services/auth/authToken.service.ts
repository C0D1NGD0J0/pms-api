import Logger from 'bunyan';
import { Request } from 'express';
import { envVariables } from '@shared/config';
import { TokenType } from '@interfaces/utils.interface';
import { JWT_KEY_NAMES, createLogger } from '@utils/index';
import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { number } from 'zod';

export class AuthTokenService {
  private jwtRefreshExpiresIn: string | number;
  private jwtExpiresIn: string | number;
  private jwtRefreshSecret: string;
  private jwtSecret: string;
  private logger: Logger;
  private extendedAccessTokenExpiry: string | number;
  private extendedRefreshTokenExpiry: string | number;

  constructor() {
    this.logger = createLogger('AuthTokenService');
    this.jwtExpiresIn = envVariables.JWT.EXPIREIN;
    this.jwtSecret = envVariables.JWT.SECRET;
    this.jwtRefreshSecret = envVariables.JWT.REFRESH.SECRET;
    this.jwtRefreshExpiresIn = envVariables.JWT.REFRESH.EXPIRESIN;
    this.extendedAccessTokenExpiry = envVariables.JWT.EXTENDED_ACCESS_TOKEN_EXPIRY;
    this.extendedRefreshTokenExpiry = envVariables.JWT.EXTENDED_REFRESH_TOKEN_EXPIRY;
  }

  createJwtTokens(payload: { sub: string; rememberMe: boolean; csub: string }): {
    accessToken: string;
    refreshToken: string;
  } {
    const accessExpiry = payload.rememberMe ? this.extendedAccessTokenExpiry : this.jwtExpiresIn;
    const refreshExpiry = payload.rememberMe
      ? this.extendedRefreshTokenExpiry
      : this.jwtRefreshExpiresIn;

    const at = this.generateToken(payload, this.jwtSecret, { expiresIn: accessExpiry as any });
    const rt = this.generateToken(payload, this.jwtRefreshSecret, {
      expiresIn: refreshExpiry as any,
    });

    return {
      accessToken: at,
      refreshToken: rt,
    };
  }

  async verifyJwtToken(
    tokenType: TokenType,
    token: string
  ): Promise<{
    success: boolean;
    data: {
      sub: string;
      csub: string;
      iat: number;
      exp: number;
    };
    error?: string;
  }> {
    if (tokenType !== JWT_KEY_NAMES.ACCESS_TOKEN && tokenType !== JWT_KEY_NAMES.REFRESH_TOKEN) {
      throw { success: false, error: 'Invalid token type.' };
    }
    try {
      const secret: string =
        tokenType === JWT_KEY_NAMES.REFRESH_TOKEN ? this.jwtRefreshSecret : this.jwtSecret;
      const decoded = jwt.verify(token, secret) as JwtPayload;
      return {
        success: true,
        data: {
          sub: decoded.data.sub,
          csub: decoded.data.csub,
          iat: decoded.iat as number,
          exp: decoded.exp as number,
        },
      };
    } catch (error) {
      this.logger.error('JWT verification failed: ', (error as Error).message);
      throw error;
    }
  }

  decodeJwt(token: string) {
    if (!token) {
      return { success: false };
    }

    const resp = jwt.decode(token);
    if (!resp) {
      return { success: false };
    }

    return {
      success: true,
      data: resp as {
        data: any;
        iat: number;
        exp: number;
      },
    };
  }

  extractTokenFromRequest(req: Request): string | undefined {
    let token: string | undefined = req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN];
    if (token && token.startsWith('Bearer ')) {
      token = token.split(' ')[1];
    }

    return token;
  }

  private generateToken(payload: { sub: string }, secret: string, options: SignOptions): string {
    return jwt.sign({ data: payload }, secret, options);
  }
}
