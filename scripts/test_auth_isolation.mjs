import 'dotenv/config';
import { createClient } from '@libsql/client';
import { exec } from 'child_process';
import path from 'path';

const dbPath = path.resolve(process.cwd(), "dev.db");
const client = createClient({ url: `file:${dbPath}` });

async function run() {
  console.log("Setting up DB with LibSQL...");
  
  // Clean up
  await client.execute("DELETE FROM Session WHERE userId IN ('user_a', 'user_b')");
  await client.execute("DELETE FROM Creation WHERE userId IN ('user_a', 'user_b')");
  await client.execute("DELETE FROM Workspace WHERE ownerUserId IN ('user_a', 'user_b')");
  await client.execute("DELETE FROM User WHERE id IN ('user_a', 'user_b')");

  // Insert Users
  await client.execute({ sql: "INSERT INTO User (id, name, email, status, updatedAt) VALUES (?, ?, ?, ?, ?)", args: ["user_a", "User A", "a@test.com", "ACTIVE", new Date().toISOString()] });
  await client.execute({ sql: "INSERT INTO User (id, name, email, status, updatedAt) VALUES (?, ?, ?, ?, ?)", args: ["user_b", "User B", "b@test.com", "ACTIVE", new Date().toISOString()] });

  // Insert Workspaces
  await client.execute({ sql: "INSERT INTO Workspace (id, name, ownerUserId, status, updatedAt) VALUES (?, ?, ?, ?, ?)", args: ["workspace_a", "Workspace A", "user_a", "ACTIVE", new Date().toISOString()] });
  await client.execute({ sql: "INSERT INTO Workspace (id, name, ownerUserId, status, updatedAt) VALUES (?, ?, ?, ?, ?)", args: ["workspace_b", "Workspace B", "user_b", "ACTIVE", new Date().toISOString()] });

  // Insert Sessions
  const expires = new Date();
  expires.setDate(expires.getDate() + 1);
  await client.execute({ sql: "INSERT INTO Session (id, sessionToken, userId, expires) VALUES (?, ?, ?, ?)", args: ["session_a", "token_a", "user_a", expires.toISOString()] });
  await client.execute({ sql: "INSERT INTO Session (id, sessionToken, userId, expires) VALUES (?, ?, ?, ?)", args: ["session_b", "token_b", "user_b", expires.toISOString()] });

  // Insert Creation for User B
  await client.execute({ sql: "INSERT INTO Creation (id, workspaceId, userId, generationType, presetId, status, idempotencyKey, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: ["creation_b", "workspace_b", "user_b", "APP_STUDIO", "preset_1", "DRAFT", "idem_b", new Date().toISOString()] });
  
  console.log("Starting Next.js server...");
  const server = exec('npx next dev -p 3001 -H 0.0.0.0');
  
  await new Promise(resolve => setTimeout(resolve, 8000));
  
  console.log("Running fetch tests...");
  
  const endpoints = [
    { method: "GET", path: `/api/creations/creation_b` },
    { method: "GET", path: `/api/creations/creation_b/preview` },
    { method: "GET", path: `/api/creations/creation_b/download` },
    { method: "POST", path: `/api/creations/creation_b/cancel` }
  ];

  for (const ep of endpoints) {
    const url = `http://0.0.0.0:3001${ep.path}`;
    
    // User A
    const resA = await fetch(url, {
      method: ep.method,
      headers: {
        "x-mock-user-id": "user_a",
        "cookie": "next-auth.session-token=token_a"
      }
    });
    console.log(`[${ep.method}] ${ep.path} as User A -> HTTP ${resA.status}`);
    
    // User B
    const resB = await fetch(url, {
      method: ep.method,
      headers: {
        "x-mock-user-id": "user_b",
        "cookie": "next-auth.session-token=token_b"
      }
    });
    console.log(`[${ep.method}] ${ep.path} as User B -> HTTP ${resB.status}`);
  }

  server.kill();
  process.exit(0);
}

run().catch(console.error);
