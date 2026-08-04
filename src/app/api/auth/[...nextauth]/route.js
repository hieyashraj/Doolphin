import NextAuth from "next-auth";
import authOptions from "@/lib/auth";

const nextAuthFunc = typeof NextAuth === "function" ? NextAuth : NextAuth.default;
const handler = nextAuthFunc(authOptions);

export { handler as GET, handler as POST };

