import { createInterface } from "node:readline";
import { getOAuthProvider } from "@mariozechner/pi-ai";
import {
  saveCredentials,
  credentialsPath,
  loadCredentials,
} from "../auth/oauth-store.js";
import { unlinkSync } from "node:fs";

/**
 * Run interactive OAuth login for a provider.
 * Opens browser, waits for callback or prompts for code, saves credentials.
 */
export async function oauthLogin(
  officeDir: string,
  providerId: string,
): Promise<void> {
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(
      `Unknown OAuth provider "${providerId}". Available: anthropic, openai-codex, github-copilot, google-gemini-cli, google-antigravity`,
    );
  }

  console.log(`[oauth] Logging in to ${provider.name}...`);

  const creds = await provider.login({
    onAuth: (info) => {
      console.log(`[oauth] Open this URL to authenticate:\n  ${info.url}`);
      if (info.instructions) console.log(`\n${info.instructions}`);
    },
    onPrompt: async (prompt) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      return new Promise<string>((resolve) => {
        rl.question(
          prompt.message +
            (prompt.placeholder ? ` (${prompt.placeholder})` : "") +
            ": ",
          (answer) => {
            rl.close();
            resolve(answer || (prompt.allowEmpty ? "" : answer));
          },
        );
      });
    },
    onProgress: (msg) => console.log(`[oauth] ${msg}`),
  });

  saveCredentials(officeDir, providerId, creds);
  console.log(`[oauth] Credentials saved for ${provider.name}.`);
}

const ALL_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai-codex", name: "OpenAI" },
  { id: "github-copilot", name: "GitHub Copilot" },
  { id: "google-gemini-cli", name: "Google Gemini CLI" },
  { id: "google-antigravity", name: "Antigravity" },
];

/**
 * List all OAuth providers and their credential status.
 */
export function oauthList(officeDir: string, officeId: string): void {
  for (const p of ALL_PROVIDERS) {
    const authed = loadCredentials(officeDir, p.id) !== null;
    const status = authed ? "\x1b[32m✓\x1b[0m" : "\x1b[90m✗\x1b[0m";
    console.log(`  ${status} ${p.id.padEnd(22)} ${p.name}`);
  }
  console.log();
  console.log(`  Login:   pnpm dev oauth login <provider> --office ${officeId}`);
  console.log(`  Logout:  pnpm dev oauth logout <provider> --office ${officeId}`);
}

/**
 * Remove OAuth credentials for a provider.
 */
export function oauthLogout(officeDir: string, providerId: string): void {
  try {
    unlinkSync(credentialsPath(officeDir, providerId));
    console.log(`[oauth] Credentials removed for "${providerId}".`);
  } catch {
    console.log(`[oauth] No credentials found for "${providerId}".`);
  }
}
