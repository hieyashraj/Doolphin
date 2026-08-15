/**
 * Mock session provider for development environment.
 * NextAuth has been decommissioned in favor of Supabase Auth.
 */
export async function getMockSession() {
  if (process.env.NODE_ENV !== "development") return null;

  return {
    user: {
      id: "doolphin-default-user",
      name: "Doolphin Admin",
      email: "admin@doolphin.ai",
      isDevelopmentSession: true,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
