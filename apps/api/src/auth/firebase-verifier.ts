import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppConfig } from '../config/config.module';

export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Key source for Firebase ID tokens; tests swap in a local JWKS. */
export const FIREBASE_JWKS = Symbol('FIREBASE_JWKS');

export const firebaseJwksProvider = {
  provide: FIREBASE_JWKS,
  useFactory: (): JWTVerifyGetKey => createRemoteJWKSet(new URL(FIREBASE_JWKS_URL)),
};

export interface FirebaseIdentity {
  uid: string;
  email: string | null;
  name: string | null;
}

export class InvalidTokenError extends Error {}

/**
 * Verifies Firebase ID tokens against Google's public keys — only the project
 * id is needed, no service account. Unsigned emulator tokens are accepted only
 * when FIREBASE_AUTH_EMULATOR_HOST is set outside production.
 */
@Injectable()
export class FirebaseVerifier {
  private readonly projectId: string;
  private readonly issuer: string;

  constructor(
    private readonly config: AppConfig,
    @Inject(FIREBASE_JWKS) private readonly jwks: JWTVerifyGetKey,
  ) {
    this.projectId = config.env.FIREBASE_PROJECT_ID;
    this.issuer = `https://securetoken.google.com/${this.projectId}`;
  }

  async verify(token: string): Promise<FirebaseIdentity> {
    let payload: JWTPayload;
    try {
      payload = this.isEmulatorToken(token) ? this.verifyEmulator(token) : await this.verifySigned(token);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw err;
      throw new InvalidTokenError((err as Error).message);
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new InvalidTokenError('Token has no subject');
    return {
      uid: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : null,
    };
  }

  private isEmulatorToken(token: string): boolean {
    if (!this.config.firebaseEmulator) return false;
    try {
      return decodeProtectedHeader(token).alg === 'none';
    } catch {
      return false;
    }
  }

  private async verifySigned(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.projectId,
      algorithms: ['RS256'],
    });
    return payload;
  }

  /** The Auth emulator signs nothing; still check audience, issuer and expiry. */
  private verifyEmulator(token: string): JWTPayload {
    const payload = decodeJwt(token);
    if (payload.aud !== this.projectId) throw new InvalidTokenError('Wrong audience');
    if (payload.iss !== this.issuer) throw new InvalidTokenError('Wrong issuer');
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) throw new InvalidTokenError('Token expired');
    return payload;
  }
}
