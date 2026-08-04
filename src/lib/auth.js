import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";

const adapterFunc = typeof PrismaAdapter === "function" ? PrismaAdapter : (PrismaAdapter?.PrismaAdapter || PrismaAdapter);
const getProvider = (p) => (typeof p === "function" ? p : (p?.default || p));

const Google = getProvider(GoogleProvider);
const Credentials = getProvider(CredentialsProvider);

export const authOptions = {
  adapter: typeof adapterFunc === "function" ? adapterFunc(prisma) : undefined,
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "placeholder_google_id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "placeholder_google_secret",
    }),
    Credentials({
      id: "credentials",
      name: "API Key",
      credentials: {
        apiKey: { label: "MuAPI Key", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.apiKey) {
          throw new Error("API Key is required");
        }
        const apiKey = credentials.apiKey.trim();
        if (apiKey.length < 5) {
          throw new Error("Invalid API key format");
        }

        const dummyEmail = `apikey_${apiKey.slice(-8)}@muapi.local`;
        let dbUser = await prisma.user.findFirst({
          where: {
            OR: [
              { customApiKey: apiKey },
              { email: dummyEmail }
            ]
          }
        });

        if (!dbUser) {
          dbUser = await prisma.user.create({
            data: {
              name: "API Key User",
              email: dummyEmail,
              customApiKey: apiKey,
              credits: 0,
            }
          });
        } else if (!dbUser.customApiKey) {
          dbUser = await prisma.user.update({
            where: { id: dbUser.id },
            data: { customApiKey: apiKey }
          });
        }

        return {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          image: dbUser.image || null,
          credits: dbUser.credits,
          customApiKey: dbUser.customApiKey || apiKey,
          isApiKeyUser: true,
        };
      }
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.credits = user.credits;
        token.customApiKey = user.customApiKey;
        token.falKey = user.falKey;
        token.elevenLabsKey = user.elevenLabsKey;
        token.isApiKeyUser = user.isApiKeyUser || false;
      }
      if (trigger === "update" && session) {
        if (session.customApiKey !== undefined) token.customApiKey = session.customApiKey;
        if (session.falKey !== undefined) token.falKey = session.falKey;
        if (session.elevenLabsKey !== undefined) token.elevenLabsKey = session.elevenLabsKey;
        if (session.credits !== undefined) token.credits = session.credits;
      }
      const userId = token.id || token.sub;
      if (userId) {
        token.id = userId;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { credits: true, customApiKey: true, falKey: true, elevenLabsKey: true }
          });
          if (dbUser) {
            token.credits = dbUser.credits;
            token.customApiKey = dbUser.customApiKey;
            token.falKey = dbUser.falKey;
            token.elevenLabsKey = dbUser.elevenLabsKey;
          }
        } catch (err) {}
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id || token.sub;
        session.user.credits = token.credits;
        session.user.customApiKey = token.customApiKey;
        session.user.falKey = token.falKey;
        session.user.elevenLabsKey = token.elevenLabsKey;
        session.user.isApiKeyUser = Boolean(token.customApiKey || token.falKey);
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
};

export default authOptions;
