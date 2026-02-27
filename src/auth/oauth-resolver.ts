import { getOAuthApiKey, getOAuthProvider } from "@mariozechner/pi-ai";
import { loadCredentials, saveCredentials } from "./oauth-store.js";

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
    const result = await getOAuthApiKey(oauthProvider, {
      [oauthProvider]: creds,
    });
    if (!result) {
      throw new Error(
        `Failed to get API key for OAuth provider "${oauthProvider}"`,
      );
    }
    if (result.newCredentials !== creds) {
      saveCredentials(officeDir, oauthProvider, result.newCredentials);
    }
    return result.apiKey;
  };
}

/**
 * Resolve OAuth API key synchronously for sandbox agents.
 * Uses the provider's getApiKey() which just returns creds.access.
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
  const provider = getOAuthProvider(oauthProvider);
  if (!provider) {
    throw new Error(`Unknown OAuth provider "${oauthProvider}"`);
  }
  return provider.getApiKey(creds);
}
