const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

const commands = [
  "npm ci",
  "npx prisma validate",
  "npx prisma generate",
  "npx prisma migrate status",
  "npm run typecheck",
  "npm run lint",
  "npm test",
  "npm run build"
];

async function runCommands() {
  const results = [];
  for (const cmd of commands) {
    const start = Date.now();
    const startString = new Date(start).toISOString();
    let stdout = "";
    let stderr = "";
    let code = 0;
    try {
      const { stdout: out, stderr: err } = await execPromise(cmd, { cwd: "/Users/yashraj/Desktop/Lembda", maxBuffer: 1024 * 1024 * 50 });
      stdout = out;
      stderr = err;
    } catch (e) {
      stdout = e.stdout || "";
      stderr = e.stderr || e.message;
      code = e.code || 1;
    }
    const end = Date.now();
    const endString = new Date(end).toISOString();
    results.push({
      command: cmd,
      start: startString,
      end: endString,
      duration_ms: end - start,
      exit_code: code,
      stdout,
      stderr
    });
  }
  fs.writeFileSync("/Users/yashraj/Desktop/Lembda/verify_report.json", JSON.stringify(results, null, 2));
  console.log("Done");
}

runCommands().catch(console.error);
