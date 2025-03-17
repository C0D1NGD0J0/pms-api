import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { TokenType } from '@interfaces/utils.interface';
import { JWT_KEY_NAMES, createLogger } from '@utils/index';
import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';

export class AuthTokenService {
  private jwtRefreshExpiresIn: string | number;
  private jwtExpiresIn: string | number;
  private jwtRefreshSecret: string;
  private jwtSecret: string;
  private logger: Logger;

  constructor() {
    this.logger = createLogger('AuthTokenService');
    this.jwtExpiresIn = envVariables.JWT.EXPIREIN;
    this.jwtSecret = envVariables.JWT.SECRET;

    this.jwtRefreshSecret = envVariables.JWT.REFRESH.SECRET;
    this.jwtRefreshExpiresIn = envVariables.JWT.REFRESH.EXPIRESIN;
  }

  private generateToken(payload: any, secret: string, options: SignOptions): string {
    return jwt.sign({ data: payload }, secret, options);
  }

  async verifyJwtToken(
    tokenType: TokenType,
    token: string
  ): Promise<{ success: boolean; data?: string | JwtPayload; error?: string }> {
    if (tokenType !== JWT_KEY_NAMES.ACCESS_TOKEN && tokenType !== JWT_KEY_NAMES.REFRESH_TOKEN) {
      throw { success: false, error: 'Invalid token type.' };
    }
    try {
      let secret: string;
      if (tokenType === JWT_KEY_NAMES.REFRESH_TOKEN) {
        secret = this.jwtRefreshSecret;
      } else {
        secret = this.jwtSecret;
      }

      const decoded = jwt.verify(token, secret) as JwtPayload;
      return { success: true, data: decoded.data };
    } catch (error) {
      this.logger.error('JWT verification failed: ', (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  createJwtTokens(payload: any): { accessToken: string; refreshToken: string } {
    const at = this.generateToken(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn as any });
    const rt = this.generateToken(payload, this.jwtRefreshSecret, {
      expiresIn: this.jwtRefreshExpiresIn as any,
    });

    return {
      accessToken: at,
      refreshToken: rt,
    };
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
}
