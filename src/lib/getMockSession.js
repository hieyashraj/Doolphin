import { prisma } from "./prisma";
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
          customApiKey: process.env.MUAPI_API_KEY || process.env.MUAPI_API_KEY_SANDBOX || "",
          falKey: process.env.FAL_KEY || "",
          elevenLabsKey: process.env.ELEVENLABS_API_KEY || ""
        }
      });
    } catch (createErr) {
      console.error("Failed to create default user in database:", createErr);
      // Fallback in-memory user if DB write fails
      user = {
        id: defaultUserId,
        name: "Doolphin Admin",
        email: "admin@doolphin.ai",
        credits: 9999,
        customApiKey: "",
        falKey: "",
        elevenLabsKey: ""
      };
    }
  }
  
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      credits: user.credits,
      customApiKey: user.customApiKey || null,
      falKey: user.falKey || null,
      elevenLabsKey: user.elevenLabsKey || null,
      image: null,
      isApiKeyUser: true
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
}
