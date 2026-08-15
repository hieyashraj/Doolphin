import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  let cookieStore = { getAll: () => [], set: () => {} };
  try {
    const { cookies } = await import("next/headers");
    cookieStore = await cookies();
  } catch {}

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
  });
}
