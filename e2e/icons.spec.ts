import { test, expect } from './fixtures/isolated-env';

test.describe('Icons', () => {
  test('renders icons on the login page', async ({ page }) => {
    await page.goto('/login');

    // Wait for the login page to load
    await expect(
      page.getByRole('heading', { name: 'Sign in to Ship' }),
    ).toBeVisible({ timeout: 10000 });

    // The USWDS icons container should be visible
    const iconsContainer = page.locator('[data-testid="uswds-icons"]');
    await expect(iconsContainer).toBeVisible({ timeout: 10000 });

    // All 4 icons (check, close, warning, info) should render as SVGs with role="img"
    // If the Icon component failed to load, it would render null or a fallback <span>,
    // not an SVG — so finding 4 SVGs proves the lazy-loading pipeline works
    const icons = iconsContainer.locator('svg[role="img"]');
    await expect(icons).toHaveCount(4, { timeout: 10000 });

    // Verify the SVGs have fill="currentColor" (USWDS pattern for color inheritance)
    for (let i = 0; i < 4; i++) {
      await expect(icons.nth(i)).toHaveAttribute('fill', 'currentColor');
    }
  });
});
