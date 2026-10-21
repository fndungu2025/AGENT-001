import { createClient } from "@supabase/supabase-js";

export class MissingEnvError extends Error {
  constructor(names: readonly string[]) {
    super(
      `Missing required environment variable(s): ${names.join(", ")}. ` +
        "Copy apps/web/.env.example to apps/web/.env.local and fill in the values.",
    );
    this.name = "MissingEnvError";
  }
}

interface SupabaseEnv {
  readonly VITE_SUPABASE_URL?: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
}

/** Create a browser Supabase client. Throws a MissingEnvError if config is absent. */
export function createSupabaseClient(env: SupabaseEnv = import.meta.env) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing: string[] = [];
  if (!url) missing.push("VITE_SUPABASE_URL");
  if (!key) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new MissingEnvError(missing);
  return createClient(url, key);
}

export type BrowserSupabaseClient = ReturnType<typeof createSupabaseClient>;

let client: BrowserSupabaseClient | undefined;

/** Lazily created singleton, so importing this module never throws. */
export function getSupabase(): BrowserSupabaseClient {
  client ??= createSupabaseClient();
  return client;
}
