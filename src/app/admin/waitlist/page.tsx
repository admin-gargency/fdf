import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WaitlistRow = {
  id: string;
  email: string;
  source: string | null;
  confirmed_at: string | null;
  created_at: string;
};

export default async function AdminWaitlistPage() {
  const admin = getAdminClient();

  if (!admin) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 font-mono text-sm">
        <h1 className="mb-2 text-xl font-semibold">Waitlist · admin</h1>
        <p className="rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-900">
          Supabase env non configurato — set
          <code className="mx-1 rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>
          e
          <code className="mx-1 rounded bg-amber-100 px-1">SUPABASE_SERVICE_ROLE_KEY</code>
          su Vercel.
        </p>
      </main>
    );
  }

  const { data, error, count } = await admin
    .from("waitlist")
    .select("id, email, source, confirmed_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12 font-mono text-sm">
        <h1 className="mb-2 text-xl font-semibold">Waitlist · admin</h1>
        <p className="rounded-md border border-red-400 bg-red-50 p-3 text-red-900">
          Errore Supabase: <code>{error.code}</code> — {error.message}
        </p>
      </main>
    );
  }

  const rows = (data ?? []) as WaitlistRow[];
  const total = count ?? rows.length;
  const confirmed = rows.filter((r) => r.confirmed_at).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 font-mono text-sm">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Waitlist · admin</h1>
        <div className="flex gap-4 text-zinc-600">
          <span>
            total: <strong>{total}</strong>
          </span>
          <span>
            confirmed: <strong>{confirmed}</strong>
          </span>
          <a
            className="underline underline-offset-2 hover:text-zinc-900"
            href="/api/admin/waitlist?format=csv"
          >
            CSV ↓
          </a>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-zinc-500">Nessuna iscrizione ancora.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500">
              <th className="py-2 pr-4">#</th>
              <th className="py-2 pr-4">email</th>
              <th className="py-2 pr-4">confirmed</th>
              <th className="py-2 pr-4">source</th>
              <th className="py-2">created_at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                className="border-b border-zinc-100 align-top"
              >
                <td className="py-2 pr-4 text-zinc-400">{idx + 1}</td>
                <td className="py-2 pr-4">{row.email}</td>
                <td className="py-2 pr-4 text-zinc-600">
                  {row.confirmed_at
                    ? new Date(row.confirmed_at).toISOString().slice(0, 16) + "Z"
                    : "—"}
                </td>
                <td className="py-2 pr-4 text-zinc-500">{row.source ?? "—"}</td>
                <td className="py-2 text-zinc-500">
                  {new Date(row.created_at).toISOString().slice(0, 16) + "Z"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
