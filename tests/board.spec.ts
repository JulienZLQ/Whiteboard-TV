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
  await expect(tvCanvas).toHaveAttribute('data-camera-moving', 'false');
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


test('TV creates a room, phone joins and claims hosting, removed credentials stay revoked', async ({ browser, page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?mode=tv');
  await page.getByRole('button', { name: '创建电视白板' }).click();
  await expect(page.getByAltText('电视编辑加入二维码')).toBeVisible();
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: '邀请加入', exact: true }).click();
  const invitation = await page.locator('#invite-link').inputValue();
  await page.getByRole('button', { name: '关闭邀请' }).click();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneContext.newPage(); phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(invitation); await phone.getByPlaceholder('怎么称呼你？').fill('手机成员');
  await phone.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(phone.getByRole('toolbar')).toBeVisible();
  await phone.mouse.move(140, 340); await phone.mouse.down(); await phone.mouse.move(240, 450, { steps: 20 });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-preview-count', '1');
  await phone.mouse.up(); await expect(page.getByTestId('canvas')).toHaveAttribute('data-stroke-count', '1');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  // Interior strokes retain the TV overview rather than fitting every new stroke.
  const camera = await page.getByTestId('canvas').getAttribute('data-camera');
  await phone.mouse.move(150, 380); await phone.mouse.down(); await phone.mouse.move(200, 410, { steps: 10 }); await phone.mouse.up();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-stroke-count', '2');
  expect(await page.getByTestId('canvas').getAttribute('data-camera')).toBe(camera);
  await page.getByLabel('电视关注成员').selectOption({ label: '关注 手机成员' });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  await expect.poll(async () => JSON.parse((await page.getByTestId('canvas').getAttribute('data-camera'))!).zoom).toBe(1);
  await page.getByLabel('电视关注成员').selectOption('');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  await page.getByRole('button', { name: '管理', exact: true }).click();
  await page.getByRole('button', { name: '暂停加入', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复加入' })).toBeVisible();
  await page.getByRole('button', { name: '恢复加入' }).click();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await expect(phone.getByRole('alert')).toContainText('成员已被移除');
  await phone.reload(); await phone.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(phone.getByRole('alert')).toContainText('成员已被移除');
  await page.getByRole('button', { name: '手机认领主持权限' }).click();
  const claim = await page.locator('#invite-link').inputValue();
  const host = await phoneContext.newPage(); await host.goto(claim);
  await host.getByPlaceholder('怎么称呼你？').fill('手机主持'); await host.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(host.getByRole('button', { name: '管理', exact: true })).toBeVisible();
  await host.getByRole('button', { name: '管理', exact: true }).click();
  await host.getByRole('button', { name: '结束会话', exact: true }).click();
  await host.getByRole('button', { name: '确认结束会话' }).click();
  await expect(page.getByRole('alert')).toContainText('本次会话已结束');
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await phoneContext.close();
});

test('TV remote navigation closes nested dialogs and restores room after app storage restart', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?mode=tv&tvShell=android');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '创建电视白板' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByAltText('电视编辑加入二维码')).toBeVisible();
  await expect(page).toHaveURL(/tvShell=android/);
  await expect(page.getByRole('button', { name: '导出本地副本' })).toHaveCount(0);
  // Exercise exactly the JavaScript entry point invoked by Android D-pad events.
  await page.getByRole('button', { name: '管理', exact: true }).focus();
  await page.evaluate(() => window.WhiteboardTV!.key('ArrowRight'));
  await expect(page.getByRole('button', { name: '邀请加入', exact: true })).toBeFocused();
  await page.evaluate(() => window.WhiteboardTV!.key('Enter'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.WhiteboardTV!.back());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '管理', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '会话管理' })).toBeVisible();
  // Directional navigation remains within the active dialog.
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  await page.getByRole('button', { name: '手机认领主持权限' }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('dialog[open]')).toHaveCount(2);
  await page.evaluate(() => window.WhiteboardTV!.back());
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: '会话管理' })).toBeVisible();
  await page.evaluate(() => window.WhiteboardTV!.back());
  expect(await page.evaluate(() => window.WhiteboardTV!.back())).toBe(false);
  const url = page.url();
  await page.evaluate(() => sessionStorage.clear()); await page.close();
  const restored = await context.newPage(); await restored.goto(url);
  await expect(restored.getByAltText('电视编辑加入二维码')).toBeVisible();
  await expect(restored.getByRole('button', { name: '管理', exact: true })).toBeVisible();
  expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
