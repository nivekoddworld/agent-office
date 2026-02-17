import { useState, useEffect, useCallback } from "react";
import { Center, Loader, Text, Stack } from "@mantine/core";
import { authenticate } from "./api/client.js";
import { useBootstrapState } from "./api/use-state.js";
import { useSSE } from "./api/use-events.js";
import { pushEvent } from "./store/event-store.js";
import { AppLayout } from "./components/layout/AppLayout.js";

type AuthState = "checking" | "authenticated" | "failed";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    authenticate().then((ok) => setAuth(ok ? "authenticated" : "failed"));
  }, []);

  const handleAuthExpired = useCallback(() => setAuth("failed"), []);
  const authed = auth === "authenticated";

  // Gate SSE + state fetch on auth
  useSSE(authed, (type, data) => pushEvent(type, data), handleAuthExpired);

  const { data: state, isLoading } = useBootstrapState(authed);

  if (auth === "failed") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="xs">
          <Text size="lg" fw={600}>Session Expired</Text>
          <Text c="dimmed" size="sm">
            Run the "ui" command in your REPL to get a fresh link.
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!authed || isLoading || !state) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return <AppLayout state={state} />;
}
