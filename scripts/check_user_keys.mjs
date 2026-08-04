import { prisma } from "../src/lib/prisma.js";

async function checkUserKeys() {
  const users = await prisma.user.findMany();
  console.log("Registered DB Users:", users.map(u => ({
    id: u.id,
    name: u.name,
    credits: u.credits,
    hasFalKey: Boolean(u.falKey && !u.falKey.includes("placeholder")),
    hasUgckey: Boolean(u.customApiKey && !u.customApiKey.includes("placeholder"))
  })));
}

checkUserKeys().catch(console.error);
