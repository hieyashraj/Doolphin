import { spawn } from 'child_process';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config();

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const API_BASE = 'http://localhost:3000/api';
const MOCK_USER_ID = 'doolphin-default-user';

async function waitForServer() {
  console.log('Testing connection to Next.js server on http://localhost:3000...');
  const res = await fetch('http://localhost:3000/api/health').catch(() => fetch('http://localhost:3000'));
  if (res.status !== 200 && res.status !== 404) {
    throw new Error('Server returned unexpected status');
  }
}

async function testGenerate(presetId, category, type) {
  console.log(`\n--- Testing POST /api/generate for ${category} (${presetId}) ---`);
  
  const payload = {
    modelId: 'happy-horse',
    provider: 'MUAPI',
    prompt: `Test prompt for ${category}`,
    presetId,
    presetCategory: category,
    generationType: type,
    settings: { duration: 5, aspect_ratio: '16:9' },
    voiceoverText: 'Test voiceover'
  };

  try {
    const res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-user-id': MOCK_USER_ID
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log(`POST /api/generate response status: ${res.status}`);
    
    if (![200, 202].includes(res.status)) {
      console.error('Failed to start generation:', data);
      return { success: false, error: 'Invalid status code' };
    }

    if (!data.creationId) {
      console.error('Missing creationId in response:', data);
      return { success: false, error: 'No creationId' };
    }

    console.log(`Generation started successfully. Creation ID: ${data.creationId}`);
    return { success: true, creationId: data.creationId };
  } catch (err) {
    console.error(`Error making POST request for ${category}:`, err);
    return { success: false, error: err.message };
  }
}

async function testGetCreation(creationId) {
  console.log(`\n--- Testing GET /api/creations/${creationId} ---`);
  try {
    const res = await fetch(`${API_BASE}/creations/${creationId}`, {
      headers: {
        'x-mock-user-id': MOCK_USER_ID
      }
    });

    const data = await res.json();
    console.log(`GET /api/creations/[id] response status: ${res.status}`);

    if (res.status !== 200) {
      console.error('Failed to get creation:', data);
      return { success: false, error: 'Invalid status code' };
    }

    if (data.id !== creationId) {
      console.error('Creation ID mismatch in response:', data);
      return { success: false, error: 'ID mismatch' };
    }

    console.log('GET API returned successfully with valid creation object.');
    return { success: true };
  } catch (err) {
    console.error(`Error making GET request for ${creationId}:`, err);
    return { success: false, error: err.message };
  }
}

async function verifyDbPersistence(creationId) {
  console.log(`\n--- Verifying DB Persistence for ${creationId} ---`);
  try {
    const creation = await prisma.creation.findUnique({
      where: { id: creationId }
    });
    
    if (!creation) {
      console.error(`Creation ${creationId} not found in database.`);
      return { success: false, error: 'Not found in DB' };
    }

    console.log(`Successfully verified creation ${creationId} is stored in DB. Stage: ${creation.stage}`);
    return { success: true };
  } catch (err) {
    console.error('DB Verification failed:', err);
    return { success: false, error: err.message };
  }
}

async function main() {
  try {
    await waitForServer();

    const tests = [
      { presetId: 'preset-01', category: 'app', type: 'APP_STUDIO' },
      { presetId: 'preset-03', category: 'product', type: 'PRODUCT_AD' },
      { presetId: 'preset-05', category: 'video', type: 'VIDEO_MAKER' }
    ];

    let errors = 0;

    for (const test of tests) {
      const generateResult = await testGenerate(test.presetId, test.category, test.type);
      if (!generateResult.success) {
        errors++;
        continue;
      }

      const getResult = await testGetCreation(generateResult.creationId);
      if (!getResult.success) {
        errors++;
      }

      const dbResult = await verifyDbPersistence(generateResult.creationId);
      if (!dbResult.success) {
        errors++;
      }
    }

    if (errors > 0) {
      console.error(`\nPipeline tests failed with ${errors} errors.`);
      process.exit(1);
    } else {
      console.log(`\nAll pipeline tests passed successfully with 0 errors!`);
      process.exit(0);
    }
  } catch (err) {
    console.error('Pipeline test crashed:', err);
    process.exit(1);
  }
}

main();
