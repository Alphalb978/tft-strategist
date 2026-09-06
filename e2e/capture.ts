import type { Page } from '@playwright/test';
/** Wait for decoded artwork and CSS transitions; screenshots judge stable UI, not PNG streaming. */
export async function capture(page: Page, options: Parameters<Page['screenshot']>[0]) {
  await page
    .locator('img')
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode().catch(() => {}))),
    );
  await page.waitForTimeout(200);
  return page.screenshot(options);
}
