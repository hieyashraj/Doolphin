import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('Testing DATABASE_URL...');
  const client1 = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client1.connect();
    console.log('DATABASE_URL connection successful!');
    await client1.end();
  } catch(e) {
    console.error('DATABASE_URL error:', e.message);
  }

  console.log('\nTesting DIRECT_URL...');
  const client2 = new Client({ connectionString: process.env.DIRECT_URL });
  try {
    await client2.connect();
    console.log('DIRECT_URL connection successful!');
    await client2.end();
  } catch(e) {
    console.error('DIRECT_URL error:', e.message);
  }
}

main();
