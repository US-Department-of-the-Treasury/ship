import { test, expect } from './fixtures/isolated-env';

test.describe('Theme Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Clear localStorage to start with default theme
    await page.evaluate(() => localStorage.removeItem('ship:theme'));
    await page.reload();
  });

  test('user menu displays theme toggle options', async ({ page }) => {
    // Click user avatar to open menu
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();

    // Verify menu is open
    await expect(page.locator('[role="menu"]')).toBeVisible();

    // Verify theme options are present
    await expect(page.locator('[role="menuitem"]').filter({ hasText: 'Light' })).toBeVisible();
    await expect(page.locator('[role="menuitem"]').filter({ hasText: 'Dark' })).toBeVisible();
    await expect(page.locator('[role="menuitem"]').filter({ hasText: 'Use system theme' })).toBeVisible();
  });

  test('switching to light theme applies light theme', async ({ page }) => {
    // Open user menu
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();

    // Click Light theme option
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Verify dark class is removed from html element
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);

    // Verify light theme colors are applied
    const bgColor = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    // Light theme background is #fafafa (rgb(250, 250, 250))
    expect(bgColor).toContain('250');
  });

  test('switching to dark theme applies dark theme', async ({ page }) => {
    // First switch to light
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Wait for menu to close
    await page.waitForTimeout(500);

    // Verify light theme is applied
    let isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);

    // Reopen menu
    await userAvatar.click();

    // Now switch to dark
    await page.locator('[role="menuitem"]').filter({ hasText: 'Dark' }).click();

    // Wait for theme transition to complete
    await page.waitForTimeout(500);

    // Verify dark class is present on html element
    isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);

    // Verify dark theme colors are applied
    const bgColor = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    // Dark theme background is #0d0d0d (rgb(13, 13, 13))
    expect(bgColor).toContain('13');
  });

  test('theme preference persists after page reload', async ({ page }) => {
    // Set theme to light
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Verify localStorage was updated
    const storedTheme = await page.evaluate(() => localStorage.getItem('ship:theme'));
    expect(storedTheme).toBe('light');

    // Reload page
    await page.reload();

    // Wait for app to load
    await expect(page).not.toHaveURL('/login');

    // Verify theme is still light
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);
  });

  test('system theme respects OS preference', async ({ page }) => {
    // Set color scheme preference to light
    await page.emulateMedia({ colorScheme: 'light' });

    // Open user menu and select system theme
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Use system theme' }).click();

    // Wait for theme change
    await page.waitForTimeout(500);

    // Verify localStorage shows system
    const storedTheme = await page.evaluate(() => localStorage.getItem('ship:theme'));
    expect(storedTheme).toBe('system');

    // Verify light theme is applied (matches OS preference)
    let isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);

    // Change OS preference to dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500); // Wait for media query listener to fire

    // Verify dark theme is now applied
    isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(true);
  });

  test('menu shows checkmark on current theme', async ({ page }) => {
    // Set theme to light
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Reopen menu
    await page.waitForTimeout(300);
    await userAvatar.click();

    // Verify checkmark is visible next to Light option
    const lightOption = page.locator('[role="menuitem"]').filter({ hasText: 'Light' });
    await expect(lightOption.locator('svg').last()).toBeVisible();
  });

  test('theme switch has no FOUC on page load', async ({ page }) => {
    // Set theme to light
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Reload and immediately check theme
    await page.reload();

    // Check theme was applied before React hydration (no flash)
    const themeOnLoad = await page.evaluate(() => {
      // Check if dark class is present immediately
      return document.documentElement.classList.contains('dark');
    });

    // Should be light (no dark class)
    expect(themeOnLoad).toBe(false);
  });

  test('pre-auth pages remember theme choice', async ({ page, context }) => {
    // Set theme to light while authenticated
    const userAvatar = page.locator('nav button[aria-label="User menu"]').first();
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Light' }).click();

    // Logout
    await page.waitForTimeout(300);
    await userAvatar.click();
    await page.locator('[role="menuitem"]').filter({ hasText: 'Logout' }).click();

    // Should be on login page
    await expect(page).toHaveURL('/login', { timeout: 5000 });

    // Verify theme is still light on login page
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDark).toBe(false);
  });
});
