import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "./prisma.js";

const adapterFunc = typeof PrismaAdapter === "function" ? PrismaAdapter : (PrismaAdapter?.PrismaAdapter || PrismaAdapter);
const getProvider = (p) => (typeof p === "function" ? p : (p?.default || p));

const Google = getProvider(GoogleProvider);

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
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
      }
      const userId = token.id || token.sub;
      if (userId) {
        token.id = userId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id || token.sub;
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
