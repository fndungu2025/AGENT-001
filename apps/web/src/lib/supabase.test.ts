import { describe, expect, it } from "vitest";
import { createSupabaseClient, MissingEnvError } from "./supabase.ts";

describe("createSupabaseClient", () => {
  it("fails clearly when both variables are missing", () => {
    expect(() => createSupabaseClient({})).toThrow(MissingEnvError);
    expect(() => createSupabaseClient({})).toThrow(
      /VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
  });

  it("treats blank values as missing", () => {
    expect(() =>
      createSupabaseClient({
        VITE_SUPABASE_URL: "http://localhost:54321",
        VITE_SUPABASE_PUBLISHABLE_KEY: " ",
      }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("creates a client when configured", () => {
    const client = createSupabaseClient({
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    expect(typeof client.from).toBe("function");
  });
});
