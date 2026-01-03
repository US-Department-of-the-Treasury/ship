import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  const setupButton = page.getByRole('button', { name: /create admin account/i })
  const signInButton = page.getByRole('button', { name: /sign in/i })
  await expect(setupButton.or(signInButton)).toBeVisible({ timeout: 10000 })
  
  if (await setupButton.isVisible()) {
    await page.locator('#name').fill('Dev User')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await setupButton.click()
  } else {
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await signInButton.click()
  }
  await page.waitForLoadState('networkidle')
}

test('check aria-expanded elements', async ({ page }) => {
  await login(page);
  await page.goto('/docs');
  await page.waitForLoadState('networkidle');

  // Sidebar tree MUST exist - exactly like test 2.13
  const sidebar = page.locator('#sidebar-content, aside[aria-label="Document list"]');
  console.log('Sidebar visible:', await sidebar.isVisible());

  // Find a document that has children (indicated by aria-expanded attribute)
  const expandableItem = page.locator('[aria-expanded]').first();
  const hasExpandable = await expandableItem.count() > 0;
  console.log('Has expandable item:', hasExpandable);

  if (!hasExpandable) {
    console.log('SKIP: No nested documents');
    return;
  }

  // Log what expandableItem is
  const itemTag = await expandableItem.evaluate(el => el.tagName);
  const itemRole = await expandableItem.evaluate(el => el.getAttribute('role'));
  const itemText = await expandableItem.textContent();
  console.log('Expandable item:', { tag: itemTag, role: itemRole, text: itemText?.substring(0, 30) });

  // Expand to find a nested document
  const isExpanded = await expandableItem.getAttribute('aria-expanded');
  console.log('Initial aria-expanded:', isExpanded);

  if (isExpanded === 'false') {
    const expander = expandableItem.locator('button, [role="button"]').first();
    console.log('Expander visible:', await expander.isVisible().catch(() => false));
    console.log('Expander count:', await expander.count());

    if (await expander.count() > 0) {
      await expander.click();
      await page.waitForTimeout(300);
      console.log('Clicked expander');
    }
  }

  // Find a child document link
  const childDoc = expandableItem.locator('a[href*="/docs/"]').first();
  console.log('Child doc count:', await childDoc.count());

  if (await childDoc.count() > 0) {
    const childHref = await childDoc.getAttribute('href');
    console.log('Child href:', childHref);

    // Navigate directly to child URL (like test 2.13 does)
    await page.goto(childHref!);
    await page.waitForLoadState('networkidle');

    // Check expanded state after navigation
    const expandedParent = page.locator('[aria-expanded="true"]');
    console.log('Expanded parent count:', await expandedParent.count());

    // Log all aria-expanded elements
    const allExpanded = await page.$$eval('[aria-expanded]', els => els.map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      expanded: el.getAttribute('aria-expanded'),
      text: el.textContent?.substring(0, 30)
    })));
    console.log('All aria-expanded elements:', JSON.stringify(allExpanded, null, 2));
  }
});
