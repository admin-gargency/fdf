/**
 * server.ts — Supabase SSR client per route handlers e Server Components.
 *
 * Usa @supabase/ssr con pattern getAll/setAll (Next.js 16 App Router).
 * NON usare getAdminClient() da admin.ts qui — questo client è
 * autenticato con la sessione utente (anon key + RLS).
 *
 * Ownership: backend-dev (AGENTS.md §File ownership convention).
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ritorna un SupabaseClient SSR autenticato con la sessione cookie dell'utente.
 * Ritorna `null` se le env vars sono assenti (build-time safety).
 *
 * Uso:
 * ```ts
 * const supabase = await getServerSupabaseClient();
 * if (!supabase) return NextResponse.json({ error: "Service unavailable", code: "INIT_ERROR" }, { status: 500 });
 * ```
 */
export async function getServerSupabaseClient(): Promise<SupabaseClient | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  // Next.js 16: cookies() è async, await obbligatorio
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // In Server Components (read-only) set lancia; silenzio sicuro
          // perché il middleware gestisce il refresh della sessione.
        }
      },
    },
  });
}
