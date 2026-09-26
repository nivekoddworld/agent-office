import type { OAuthAuth } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { loadCredentials, saveCredentials } from "./oauth-store.js";

/** Refresh tokens that expire within this window (matches Pi's default). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Look up the OAuth flow for a built-in provider (e.g. "anthropic"). */
export function getOAuthProvider(providerId: string): OAuthAuth | undefined {
  return builtinProviders().find((p) => p.id === providerId)?.auth.oauth;
}

/**
 * Create a dynamic getApiKey callback for in-process agents using OAuth.
 * Automatically refreshes expired tokens and persists updated credentials.
 */
export function createOAuthGetApiKey(
  officeDir: string,
  oauthProvider: string,
): (provider: string) => Promise<string | undefined> {
  return async () => {
    const creds = loadCredentials(officeDir, oauthProvider);
    if (!creds) {
      throw new Error(
        `No OAuth credentials for "${oauthProvider}". Run: agent-office oauth login ${oauthProvider} --office <id>`,
      );
    }
    const provider = getOAuthProvider(oauthProvider);
    if (!provider) {
      throw new Error(`Unknown OAuth provider "${oauthProvider}"`);
    }
    let credential = { ...creds, type: "oauth" as const };
    if (Date.now() >= credential.expires - REFRESH_MARGIN_MS) {
      try {
        credential = await provider.refresh(
          credential,
          AbortSignal.timeout(60_000),
        );
      } catch {
        throw new Error(`Failed to refresh OAuth token for ${oauthProvider}`);
      }
      saveCredentials(officeDir, oauthProvider, credential);
    }
    const { apiKey } = await provider.toAuth(credential);
    if (!apiKey) {
      throw new Error(
        `Failed to get API key for OAuth provider "${oauthProvider}"`,
      );
    }
    return apiKey;
  };
}

/**
 * Resolve OAuth API key synchronously for sandbox agents.
 * The access token is the API key for every supported provider.
 * No refresh — tokens last ~1h, containers restart.
 */
export function resolveOAuthKeySync(
  officeDir: string,
  oauthProvider: string,
): string {
  const creds = loadCredentials(officeDir, oauthProvider);
  if (!creds) {
    throw new Error(
      `No OAuth credentials for "${oauthProvider}". Run: agent-office oauth login ${oauthProvider} --office <id>`,
    );
  }
  if (!getOAuthProvider(oauthProvider)) {
    throw new Error(`Unknown OAuth provider "${oauthProvider}"`);
  }
  return creds.access;
}
