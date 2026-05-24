/**
 * Reproduces the bug the user reported: viewing /chat/<id>, then clicking
 * Playground should auto-open the side panel preloaded with that conversation.
 *
 * Drives a real browser against the running dev server.
 */
import { test, expect } from '@playwright/test';

const THREAD_ID = '5ea11d04-020d-4624-b193-b7e8fc234972';

test('side panel hydrates the just-viewed chat after navigating to /build', async ({ page }) => {
  // Forward browser logs to the Node test output so we can see ChatOverlay diagnostics.
  page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[browser:error]', err.message));

  // Step 1: visit the chat thread directly. Wait for the assistant text to appear
  // so we know the page hydrated.
  await page.goto(`/#/chat/${THREAD_ID}`);
  await expect(
    page.getByText(/DAU for Ballistar over the last 30 days/i),
  ).toBeVisible({ timeout: 15_000 });

  // Step 2: click the Playground link in the sidebar. The link target is /build.
  await page.getByRole('link', { name: /Playground/i }).first().click();
  await expect(page).toHaveURL(/#\/build/);

  // Step 3: the side panel should auto-open and load the conversation.
  // Locate the panel by its testid (set on the <aside>).
  const panel = page.getByTestId('chat-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // The thread's first assistant message should appear inside the panel.
  await expect(
    panel.getByText(/DAU for Ballistar over the last 30 days/i),
  ).toBeVisible({ timeout: 10_000 });
});
