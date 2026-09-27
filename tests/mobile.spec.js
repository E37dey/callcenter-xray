// Phone-width layout checks.
const { test, expect } = require('@playwright/test');

test('no horizontal page scroll at phone width', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#readout')).toContainText('25/25');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('navigation bar stays reachable on a phone', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#s-org').scrollIntoViewIfNeeded();
  await expect(page.locator('.side')).toBeInViewport();
});
