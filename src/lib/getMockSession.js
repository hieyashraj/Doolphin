import { prisma } from "./prisma.js";
import { headers } from "next/headers";

import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";

export async function getMockSession() {
  try {
    const realSession = await getServerSession(authOptions);
    if (realSession?.user) {
      return realSession;
    }
  } catch (e) {
    // If NextAuth session check throws outside context, proceed to dev fallback
  }

  // Public deployments must never manufacture a shared administrator session.
  if (process.env.NODE_ENV !== "development") return null;

  let defaultUserId = "doolphin-default-user";
  try {
    const headersList = await headers();
    const mockUserId = headersList.get('x-mock-user-id');
    if (mockUserId) {
      defaultUserId = mockUserId;
    }
  } catch (e) {
    // Ignore error if headers() is called outside request context
  }
  
  // Ensure the default user exists in the DB
  let user;
  try {
    user = await prisma.user.findUnique({
      where: { id: defaultUserId }
    });
  } catch (err) {
    console.error("Database query failed during mock user check, attempting to connect/reconnect...", err);
  }

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          id: defaultUserId,
          name: "Doolphin Admin",
          email: "admin@doolphin.ai",
        }
      });
    } catch (createErr) {
      console.error("Failed to create default user in database:", createErr);
      return null;
    }
  }
  
  return {
    user: {
      id: user?.id || defaultUserId,
      name: user?.name || "Doolphin Admin",
      email: user?.email || "admin@doolphin.ai",
      image: user?.image || null,
      isDevelopmentSession: true
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
}
