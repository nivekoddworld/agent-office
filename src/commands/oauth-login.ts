import { createInterface } from "node:readline";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { getOAuthProvider } from "../auth/oauth-resolver.js";
import {
  saveCredentials,
  credentialsPath,
  loadCredentials,
} from "../auth/oauth-store.js";
import { unlinkSync } from "node:fs";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptUser(prompt: AuthPrompt): Promise<string> {
  if (prompt.type === "select") {
    console.log(prompt.message);
    prompt.options.forEach((o, i) =>
      console.log(
        `  ${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`,
      ),
    );
    const answer = await ask("Choose a number: ");
    const option = prompt.options[Number(answer) - 1];
    if (!option) throw new Error(`Invalid selection "${answer}"`);
    return option.id;
  }
  return ask(
    prompt.message +
      (prompt.placeholder ? ` (${prompt.placeholder})` : "") +
      ": ",
  );
}

function notifyUser(event: AuthEvent): void {
  switch (event.type) {
    case "auth_url":
      console.log(`[oauth] Open this URL to authenticate:\n  ${event.url}`);
      if (event.instructions) console.log(`\n${event.instructions}`);
      break;
    case "device_code":
      console.log(
        `[oauth] Open ${event.verificationUri} and enter code: ${event.userCode}`,
      );
      break;
    case "info":
    case "progress":
      console.log(`[oauth] ${event.message}`);
      break;
  }
}

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
      `Unknown OAuth provider "${providerId}". Available: ${ALL_PROVIDERS.map((p) => p.id).join(", ")}`,
    );
  }

  console.log(`[oauth] Logging in to ${provider.name}...`);

  const creds = await provider.login({
    signal: new AbortController().signal,
    prompt: promptUser,
    notify: notifyUser,
  });

  saveCredentials(officeDir, providerId, creds);
  console.log(`[oauth] Credentials saved for ${provider.name}.`);
}

const ALL_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai-codex", name: "OpenAI" },
  { id: "github-copilot", name: "GitHub Copilot" },
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
  console.log(
    `  Login:   pnpm dev oauth login <provider> --office ${officeId}`,
  );
  console.log(
    `  Logout:  pnpm dev oauth logout <provider> --office ${officeId}`,
  );
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
