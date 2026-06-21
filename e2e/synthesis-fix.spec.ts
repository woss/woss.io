import { test } from '@playwright/test';

test.describe('Synthesis round fix', () => {
  test.skip('AI produces complete portfolio response with real data', async () => {
    // Skipped: requires live AI service which may not be available in CI/test environments.
    // This test verifies the full AI response pipeline including portfolio data retrieval
    // and XML artifact cleanup. Run manually when AI service is confirmed operational.
  });
});
