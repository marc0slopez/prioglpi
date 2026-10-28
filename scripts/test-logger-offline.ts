import assert from 'node:assert/strict';
import { logError } from '../lib/logger';

let passed = 0, failed = 0, total = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] ${name}: ${message}`);
  }
}

async function main() {
  await runTest('Logger omite campos sensibles (body, cookies, credentials)', () => {
    // Intercept process.stderr.write
    const originalWrite = process.stderr.write;
    let written = '';

    process.stderr.write = ((chunk: any) => {
      written += chunk;
      return true;
    }) as any;

    try {
      // Create an error with malicious/sensitive payload
      const sensitiveError: any = new Error('Database connection failed for password=SuperSecret123!');
      sensitiveError.password = 'SuperSecret123!';
      sensitiveError.body = { creditCard: '4444-4444-4444-4444' };
      sensitiveError.cookie = 'session_token=abcdef12345';
      sensitiveError.authorization = 'Bearer malicious_token';
      sensitiveError.cause = new Error('Inner error with secret=xyz987');

      // Inject fake secrets into name and code
      sensitiveError.name = 'FakeErrorWithSecret_mytoken123';
      sensitiveError.code = 'bad_token_mytoken123';

      // Mangle the stack to include a fake secret in the first line AND a malicious 'at' line
      sensitiveError.stack = 'FakeErrorWithSecret_mytoken123: Database connection failed for password=SuperSecret123!\n    at someFunction (/app/index.js:10:1)\n    at maliciousToken_xyz987 (/app/auth.js:20:5)';

      logError('Test Context', sensitiveError);

      const parsed = JSON.parse(written);

      assert.equal(parsed.level, 'ERROR');
      assert.equal(parsed.message, 'An error occurred');
      assert.equal(parsed.errorName, 'Error'); // Whitelist logic should map the fake name to 'Error'
      assert.equal(parsed.errorCode, undefined); // Whitelist logic should reject the fake code
      assert.equal(parsed.context, 'Test Context');

      // Verification of omitted fields
      assert.ok(!written.includes('SuperSecret123!'), 'Password leaked in log');
      assert.ok(!written.includes('4444-4444-4444-4444'), 'Body leaked in log');
      assert.ok(!written.includes('session_token'), 'Cookie leaked in log');
      assert.ok(!written.includes('malicious_token'), 'Auth header leaked in log');
      // Verification of omitted fields
      assert.ok(!written.includes('SuperSecret123!'), 'Password leaked in log');
      assert.ok(!written.includes('4444-4444-4444-4444'), 'Body leaked in log');
      assert.ok(!written.includes('session_token'), 'Cookie leaked in log');
      assert.ok(!written.includes('malicious_token'), 'Auth header leaked in log');
      assert.ok(!written.includes('xyz987'), 'Cause leaked in log');
      assert.ok(!written.includes('Database connection failed for password='), 'Raw message leaked in log');

      assert.equal(parsed.password, undefined);
      assert.equal(parsed.body, undefined);
      assert.equal(parsed.cookie, undefined);
      assert.equal(parsed.authorization, undefined);
      assert.equal(parsed.cause, undefined);
      assert.equal(parsed.stack, undefined);

    } finally {
      // Restore stderr
      process.stderr.write = originalWrite;
    }
  });
}

main().then(() => {
  console.log(`\nTests Logger: ${passed} exitosos, ${failed} fallidos, ${total} total.`);
  if (failed > 0) process.exitCode = 1;
}).catch(console.error);
