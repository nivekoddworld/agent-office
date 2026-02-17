const BASE = "";

/** Typed fetch wrapper with cookie auth and CSRF headers. */
export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as Record<string, string>).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Authenticate: check existing session cookie first, then try bootstrap token. */
export async function authenticate(): Promise<boolean> {
  // 1. Check if we already have a valid session (survives page refresh)
  try {
    const res = await fetch("/api/state", { credentials: "same-origin" });
    if (res.ok) return true;
  } catch {
    // no existing session — fall through to token exchange
  }

  // 2. Try bootstrap token from URL fragment (first-time load)
  const hash = window.location.hash;
  const match = hash.match(/token=([^&]+)/);
  if (!match) return false;

  const token = match[1]!;
  // Clear fragment to avoid token leaking in history
  window.history.replaceState(null, "", window.location.pathname);

  try {
    await apiFetch("/api/auth", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    return true;
  } catch {
    return false;
  }
}
