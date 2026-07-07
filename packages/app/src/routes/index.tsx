// The session-gated app shell (member-app-shell P0: hello-world). The loader's whoami
// is the boot check — a 401 (no/expired session, or a revoked member failing the
// allowlist re-check) redirects to /login; reloading an authenticated page keeps the
// member signed in (cookie session). P1 replaces the placeholder body with the member
// core; the gate + logout seam stay as-is.
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@grocery-agent/ui";
import { api, APP_BUILD } from "../lib/api";

export const Route = createFileRoute("/")({
  loader: async () => {
    const res = await api.api.session.$get();
    if (res.status === 401) throw redirect({ to: "/login" });
    if (!res.ok) throw new Error(`whoami failed (${res.status})`);
    return res.json();
  },
  component: Home,
});

function Home() {
  const { tenant } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();

  // The Worker side of the version-skew contract, read through TanStack Query — the
  // comparison UI (update prompt) is P5; the shell already sees both build ids.
  const version = useQuery({
    queryKey: ["version"],
    queryFn: async () => (await api.api.version.$get()).json(),
  });

  async function logout() {
    await api.api.session.$delete();
    router.clearCache();
    void navigate({ to: "/login" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="app-shell">
          Hello, {tenant.id}
        </h1>
        <Button variant="outline" onClick={logout} data-testid="logout">
          Log out
        </Button>
      </header>
      <p className="text-muted-foreground">
        You're signed in to the member app. Recipes, planning, and the rest land here next.
      </p>
      <footer className="mt-auto text-xs text-muted-foreground">
        build {APP_BUILD}
        {version.data && version.data.build !== APP_BUILD ? ` (server ${version.data.build})` : ""}
      </footer>
    </main>
  );
}
