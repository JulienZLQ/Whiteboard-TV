import { test, expect, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/'); await page.getByPlaceholder('怎么称呼你？').fill('小林');
  await page.getByRole('button', { name: '创建白板', exact: true }).click();
  await expect(page.locator('.connection')).toHaveText('实时连接');
}
test('independent editor and TV receive in-progress strokes, erasures and recovered state', async ({ browser, page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await create(page);
  await page.getByRole('button', { name: '邀请加入', exact: true }).click();
  const invite = await page.locator('#invite-link').inputValue();
  await expect(page.getByAltText('白板编辑二维码')).toBeVisible();
  await page.getByRole('button', { name: '关闭邀请' }).click();
  const tvUrl = await page.getByRole('link', { name: '电视视图' }).getAttribute('href');
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage(); await tv.goto(tvUrl!);
  await tv.getByRole('button', { name: '打开电视总览' }).click();
  await expect(tv.getByText('实时连接', { exact: true })).toBeVisible();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); await mobile.goto(invite);
  await mobile.getByPlaceholder('怎么称呼你？').fill('小张'); await mobile.getByRole('button', { name: '加入白板', exact: true }).click();
  const canvas = page.getByTestId('canvas'), tvCanvas = tv.getByTestId('canvas');
  await page.mouse.move(450, 350); await page.mouse.down(); await page.mouse.move(700, 450, { steps: 20 });
  await expect(tvCanvas).toHaveAttribute('data-preview-count', '1');
  await expect(tvCanvas).toHaveAttribute('data-stroke-count', '0');
  await page.mouse.up();
  await expect(tvCanvas).toHaveAttribute('data-stroke-count', '1');
  await expect(mobile.getByTestId('canvas')).toHaveAttribute('data-stroke-count', '1');
  const camera = await tvCanvas.getAttribute('data-camera');
  await page.getByRole('button', { name: '放大', exact: true }).click();
  expect(await tvCanvas.getAttribute('data-camera')).toBe(camera);
  await expect(tv.getByRole('toolbar')).toHaveCount(0);
  // Reload restores acknowledged data from the service; credentials remain in this tab.
  await mobile.reload(); await mobile.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(mobile.getByTestId('canvas')).toHaveAttribute('data-stroke-count', '1');
  // Reset editor view so the eraser operates in a predictable position.
  await page.getByRole('button', { name: '适配全部内容' }).click();
  // Use the stroke's actual world endpoint from the exported document.
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出本地副本' }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('whiteboard-backup.json');
  await page.getByRole('button', { name: '擦除整条笔迹' }).click();
  // The fitted two-point line crosses the center of the viewport.
  await page.mouse.click(720, 450);
  await expect(tvCanvas).toHaveAttribute('data-stroke-count', '0');
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await mobileContext.close(); await tvContext.close();
});

test('offline changes remain pending then save after reconnect', async ({ page, context }) => {
  await create(page);
  await context.setOffline(true);
  await expect(page.getByText('连接中断', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(600, 400, { steps: 10 }); await page.mouse.up();
  await expect(page.getByText('1 项待保存')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-stroke-count', '1');
});

test('mobile two-finger gesture cancels an uncommitted pen stroke', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await create(page);
  const cdp = await context.newCDPSession(page), canvas = page.getByTestId('canvas');
  const initial = await canvas.getAttribute('data-camera');
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', [{ x: 120, y: 350, id: 0 }]);
  await touch('touchMove', [{ x: 130, y: 360, id: 0 }]);
  await touch('touchStart', [{ x: 130, y: 360, id: 0 }, { x: 230, y: 360, id: 1 }]);
  await touch('touchMove', [{ x: 120, y: 360, id: 0 }, { x: 240, y: 360, id: 1 }]);
  await touch('touchMove', [{ x: 90, y: 360, id: 0 }, { x: 270, y: 360, id: 1 }]);
  await touch('touchEnd', []);
  await expect(canvas).toHaveAttribute('data-stroke-count', '0');
  await expect(canvas).not.toHaveAttribute('data-camera', initial!);
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await context.close();
});
