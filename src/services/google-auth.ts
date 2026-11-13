import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export type GoogleAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleOAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
  userId?: string;
  sessionTokenHash?: string;
};

export type GoogleIdentityProfile = {
  googleUserId: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
};

export type GoogleCodeVerifier = (input: {
  code: string;
  nonce: string;
  codeVerifier: string;
  config: GoogleAuthConfig;
}) => Promise<GoogleIdentityProfile>;

export function createGoogleOAuthState(input: { now?: Date; userId?: string; sessionTokenHash?: string } = {}): GoogleOAuthState {
  return {
    state: randomBytes(32).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    codeVerifier: randomBytes(48).toString('base64url'),
    createdAt: (input.now ?? new Date()).getTime(),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.sessionTokenHash ? { sessionTokenHash: input.sessionTokenHash } : {})
  };
}

export function googleAuthorizationUrl(config: GoogleAuthConfig, state: GoogleOAuthState): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state.state);
  url.searchParams.set('nonce', state.nonce);
  url.searchParams.set('code_challenge', createHash('sha256').update(state.codeVerifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeAndVerifyGoogleCode(input: {
  code: string;
  nonce: string;
  codeVerifier: string;
  config: GoogleAuthConfig;
}): Promise<GoogleIdentityProfile> {
  const client = new OAuth2Client(input.config.clientId, input.config.clientSecret, input.config.redirectUri);
  const { tokens } = await client.getToken({ code: input.code, codeVerifier: input.codeVerifier });
  if (!tokens.id_token) throw new Error('missing_id_token');
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: input.config.clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || payload.nonce !== input.nonce) throw new Error('invalid_id_token');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') throw new Error('invalid_issuer');
  return {
    googleUserId: payload.sub,
    displayName: payload.name,
    avatarUrl: payload.picture,
    email: payload.email && payload.email_verified ? payload.email : undefined
  };
}
