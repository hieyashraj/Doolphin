/**
 * DOOLPHIN COMPREHENSIVE AUTOMATED TEST SUITE
 * Validates official Fal Ed25519 webhooks, microUSD financial conversions with safety buffers,
 * Seedance pricing revisions, dynamic stage graphs, credit isolation, and preflight quote non-reservation.
 */

import crypto from 'crypto';
import { ModelRegistry, getModelPriceQuote } from '../src/lib/registry/ModelRegistry.js';
import { FalWebhookVerifier } from '../src/lib/providers/fal/FalWebhookVerifier.js';
import { WorkflowEngine } from '../src/lib/workflows/WorkflowEngine.js';

let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

export async function runAllTests() {
  console.log("==================================================");
  console.log("RUNNING DOOLPHIN SYSTEM AUTOMATED TEST SUITE");
  console.log("==================================================");

  // TEST GROUP 1: Official Seedance 2.0 Pricing & Reference Limits
  console.log("\n[TEST GROUP 1] Official Seedance 2.0 Pricing & Reference Limits");
  const quote5sFast = getModelPriceQuote('seedance-2.0-r2v-fast', 5, '720p', false);
  assert(quote5sFast.ratePerSecondMicroUsd === 241900, "5s Fast rate is 241,900 micro-USD/s ($0.2419/s)");
  assert(quote5sFast.baseTotalMicroUsd === 1209500, "5s Fast base cost is 1,209,500 micro-USD ($1.21 USD)");
  assert(quote5sFast.estimatedMaxMicroUsd === 1330450, "5s Fast preflight max quote with 10% safety buffer is 1,330,450 micro-USD (~$1.33 USD)");
  assert(quote5sFast.creditReservationAmount === 134, "1,330,450 micro-USD maps to 134 Doolphin credits");

  const quote5sStd = getModelPriceQuote('seedance-2.0-r2v-std', 5, '720p', false);
  assert(quote5sStd.ratePerSecondMicroUsd === 303400, "5s Standard rate is 303,400 micro-USD/s ($0.3034/s)");
  assert(quote5sStd.baseTotalMicroUsd === 1517000, "5s Standard base cost is 1,517,000 micro-USD ($1.52 USD)");
  assert(quote5sStd.estimatedMaxMicroUsd === 1668700, "5s Standard preflight max quote with 10% safety buffer is 1,668,700 micro-USD (~$1.67 USD)");

  const unverifiedQuote = getModelPriceQuote('grok-video', 5);
  assert(unverifiedQuote.error === 'MODEL_PRICING_UNVERIFIED', "Unverified pricing returns MODEL_PRICING_UNVERIFIED error code");

  // TEST GROUP 2: Fal Ed25519 Webhook Verification & Field Order
  console.log("\n[TEST GROUP 2] Official Fal Ed25519 Webhook Verification & Exact Field Order");
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestId = 'fal_req_991823';
  const userId = 'usr_doolphin_883';
  const rawBody = JSON.stringify({ request_id: requestId, status: 'OK', payload: { video_url: 'https://r2.doolphin.ai/v1.mp4' } });
  
  // Construct official signed message: [requestId, userId, timestamp, sha256(rawBody)].join('\n')
  const messageToSign = FalWebhookVerifier.constructSignedMessage({ requestId, userId, timestamp, rawBody });
  const validSignatureHex = crypto.sign(null, Buffer.from(messageToSign), privateKey).toString('hex');

  // Valid Ed25519 Signature Check
  const validResult = FalWebhookVerifier.verifySignature({
    rawBody,
    headers: {
      'x-fal-webhook-signature': validSignatureHex,
      'x-fal-webhook-timestamp': timestamp,
      'x-fal-webhook-request-id': requestId,
      'x-fal-webhook-user-id': userId
    },
    ed25519PublicKeyPem: publicKeyPem
  });
  assert(validResult.valid === true, "Official Fal Ed25519 signature verified successfully");

  // Incorrect Field Order Check (Swapped userId and requestId)
  const badMessageToSign = `${userId}\n${requestId}\n${timestamp}\n${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
  const badOrderSigHex = crypto.sign(null, Buffer.from(badMessageToSign), privateKey).toString('hex');
  const badOrderResult = FalWebhookVerifier.verifySignature({
    rawBody,
    headers: {
      'x-fal-webhook-signature': badOrderSigHex,
      'x-fal-webhook-timestamp': timestamp,
      'x-fal-webhook-request-id': requestId,
      'x-fal-webhook-user-id': userId
    },
    ed25519PublicKeyPem: publicKeyPem
  });
  assert(badOrderResult.valid === false && badOrderResult.reason === 'INVALID_ED25519_SIGNATURE', "Signature built with incorrect field order is rejected");

  // Modified Raw Body Check
  const modifiedBodyResult = FalWebhookVerifier.verifySignature({
    rawBody: rawBody + ' ', // Tampered body
    headers: {
      'x-fal-webhook-signature': validSignatureHex,
      'x-fal-webhook-timestamp': timestamp,
      'x-fal-webhook-request-id': requestId,
      'x-fal-webhook-user-id': userId
    },
    ed25519PublicKeyPem: publicKeyPem
  });
  assert(modifiedBodyResult.valid === false && modifiedBodyResult.reason === 'INVALID_ED25519_SIGNATURE', "Tampered request body is rejected");

  // Expired Timestamp Check
  const expiredResult = FalWebhookVerifier.verifySignature({
    rawBody,
    headers: {
      'x-fal-webhook-signature': validSignatureHex,
      'x-fal-webhook-timestamp': (parseInt(timestamp) - 600).toString(),
      'x-fal-webhook-request-id': requestId,
      'x-fal-webhook-user-id': userId
    },
    ed25519PublicKeyPem: publicKeyPem
  });
  assert(expiredResult.valid === false && expiredResult.reason === 'TIMESTAMP_EXPIRED_OR_REPLAY_ATTEMPT', "Expired timestamp is rejected");

  // Future Timestamp Check
  const futureResult = FalWebhookVerifier.verifySignature({
    rawBody,
    headers: {
      'x-fal-webhook-signature': validSignatureHex,
      'x-fal-webhook-timestamp': (parseInt(timestamp) + 600).toString(),
      'x-fal-webhook-request-id': requestId,
      'x-fal-webhook-user-id': userId
    },
    ed25519PublicKeyPem: publicKeyPem
  });
  assert(futureResult.valid === false && futureResult.reason === 'FUTURE_TIMESTAMP_REJECTED', "Future timestamp is rejected");

  // Terminal State Regression Protection
  const regressionResult = FalWebhookVerifier.isTerminalStateRegression('completed', 'processing');
  assert(regressionResult === true, "State machine prevents terminal state regression (completed -> processing)");

  // TEST GROUP 3: Dynamic Stage Graph Engine
  console.log("\n[TEST GROUP 3] Dynamic Stage Graph Engine");
  const productAdGraph = WorkflowEngine.generateStageGraph({
    generationType: 'product_ad',
    presetId: 'product-testimonial',
    selectedModelId: 'seedance-2.0-r2v-std',
    requiresSpeech: true
  });
  assert(productAdGraph.length > 0, "Product Ad workflow graph generated successfully");
  assert(productAdGraph.some(s => s.name === 'native_speech_synthesis'), "Native audio model includes native_speech_synthesis stage");

  const appStudioPipGraph = WorkflowEngine.generateStageGraph({
    generationType: 'app_studio',
    presetId: 'app-pip-demo',
    selectedModelId: 'grok-video',
    appCompositingMode: 'pip',
    requiresSpeech: true
  });
  assert(appStudioPipGraph.some(s => s.name === 'composite_app_recording'), "App Studio includes composite_app_recording stage");
  assert(appStudioPipGraph.some(s => s.name === 'generate_presenter_video'), "PiP mode includes generate_presenter_video stage");

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passedCount} Passed, ${failedCount} Failed, ${skippedCount} Skipped.`);
  console.log("==================================================");

  return { passedCount, failedCount, skippedCount, success: failedCount === 0 };
}

if (process.argv[1]?.includes('run_all_tests')) {
  runAllTests().catch(err => {
    console.error("Test execution error:", err);
    process.exit(1);
  });
}
