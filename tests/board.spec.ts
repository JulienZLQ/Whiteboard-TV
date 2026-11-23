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
  await page.getByRole('button', { name: '显示全部内容' }).click();
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
  await page.getByRole('button', { name: '管理成员', exact: true }).click();
  await page.getByRole('button', { name: '邀请加入', exact: true }).click();
  const invitation = await page.locator('#invite-link').inputValue();
  await page.getByRole('button', { name: '关闭邀请' }).click();
  await page.getByRole('button', { name: '关闭管理' }).click();
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
  await page.getByRole('button', { name: '管理成员', exact: true }).click(); await page.getByRole('button', { name: '关注 手机成员', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  await expect.poll(async () => JSON.parse((await page.getByTestId('canvas').getAttribute('data-camera'))!).zoom).toBe(1);
  await page.getByRole('button', { name: '完整画布', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  await page.getByRole('button', { name: '管理成员', exact: true }).click();
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
  await page.getByRole('button', { name: '管理成员', exact: true }).focus();
  await page.evaluate(() => window.WhiteboardTV!.key('ArrowRight'));
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
  await page.evaluate(() => window.WhiteboardTV!.key('Enter'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.WhiteboardTV!.back());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '管理成员', exact: true }).focus(); await page.keyboard.press('Enter');
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
  await expect(restored.getByRole('button', { name: '管理成员', exact: true })).toBeVisible();
  expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

async function exported(page: Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本地副本' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function objectPoint(page: Page, object: { x: number; y: number }) {
  const camera = JSON.parse((await page.getByTestId('canvas').getAttribute('data-camera'))!);
  return { x: (object.x + 50) * camera.zoom + camera.x, y: (object.y + 60) * camera.zoom + camera.y };
}
test('Chinese text and notes preview, move, edit, cancel, export and recover on TV', async ({ browser, page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await create(page);
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage(); await tv.goto((await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!);
  await tv.getByRole('button', { name: '打开电视总览' }).click();
  const tvCanvas = tv.getByTestId('canvas');
  await page.getByRole('button', { name: '添加便签', exact: true }).click(); await page.mouse.click(420, 320);
  await page.getByLabel('内容', { exact: true }).fill('共同创作\n今天先确定方向');
  await expect(tvCanvas).toHaveAttribute('data-object-preview-count', '1');
  await expect(tvCanvas).toHaveAttribute('data-object-count', '0');
  // An IME composition Enter must not prematurely submit.
  await page.getByLabel('内容', { exact: true }).dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
  await expect(page.getByRole('button', { name: '保存内容' })).toBeVisible();
  await page.getByRole('button', { name: '保存内容' }).click();
  await expect(tvCanvas).toHaveAttribute('data-object-count', '1');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  let backup = await exported(page); expect(backup.schemaVersion).toBe(2); expect(backup.objects[0].text).toContain('共同创作');
  const start = await objectPoint(page, backup.objects[0]);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 180, start.y + 80, { steps: 10 });
  await expect(tvCanvas).toHaveAttribute('data-object-preview-count', '1');
  await page.mouse.up(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const moved = await exported(page); expect(moved.objects[0].x).toBeGreaterThan(backup.objects[0].x + 100);
  await page.getByRole('button', { name: '编辑内容' }).click();
  await page.getByLabel('内容', { exact: true }).fill('取消这一条修改');
  await expect(tvCanvas).toHaveAttribute('data-object-preview-count', '1');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(tvCanvas).toHaveAttribute('data-object-preview-count', '0');
  expect((await exported(page)).objects[0].text).toBe(backup.objects[0].text);
  await context.setOffline(true); await expect(page.getByText('连接中断', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑内容' }).click();
  await page.getByLabel('内容', { exact: true }).fill('离线修改\n重新连接后保存');
  await page.getByRole('button', { name: '保存内容' }).click(); await expect(page.getByText('1 项待保存')).toBeVisible();
  await context.setOffline(false); await expect(page.getByText('已保存', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '添加文字', exact: true }).click(); await page.mouse.click(850, 300);
  await page.getByLabel('内容', { exact: true }).fill('共创目标'); await page.getByRole('button', { name: '保存内容' }).click();
  await expect(tvCanvas).toHaveAttribute('data-object-count', '2');
  await page.reload(); await page.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-object-count', '2');
  backup = await exported(page); expect(backup.objects.find((o: {kind: string}) => o.kind === 'note').text).toBe('离线修改\n重新连接后保存');
  await page.getByRole('button', { name: '选择对象' }).click();
  const point = await objectPoint(page, backup.objects[0]); await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: '删除对象' }).click();
  await expect(tvCanvas).toHaveAttribute('data-object-count', '1');
  expect(errors).toEqual([]); await tvContext.close();
});

test('phone note creation and remote deletion while editing keep the draft copyable', async ({ browser, page }) => {
  await create(page);
  await page.getByRole('button', { name: '邀请加入', exact: true }).click(); const invitation = await page.locator('#invite-link').inputValue(); await page.getByRole('button', { name: '关闭邀请' }).click();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); await mobile.goto(invitation);
  await mobile.getByPlaceholder('怎么称呼你？').fill('小张'); await mobile.getByRole('button', { name: '加入白板', exact: true }).click();
  await mobile.getByRole('button', { name: '添加便签', exact: true }).click(); await mobile.touchscreen.tap(100, 300);
  await mobile.getByLabel('内容', { exact: true }).fill('手机便签'); await mobile.getByRole('button', { name: '保存内容' }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-object-count', '1');
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const buttons = await mobile.getByRole('toolbar').getByRole('button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })); expect(buttons.every(Boolean)).toBe(true);
  await mobile.getByRole('button', { name: '编辑内容' }).click(); await mobile.getByLabel('内容', { exact: true }).fill('还没保存的草稿');
  const backup = await exported(page), point = await objectPoint(page, backup.objects[0]);
  await page.getByRole('button', { name: '选择对象' }).click(); await page.mouse.click(point.x, point.y); await page.getByRole('button', { name: '删除对象' }).click();
  await expect(mobile.getByRole('button', { name: '保存内容' })).toBeDisabled();
  await expect(mobile.getByLabel('内容', { exact: true })).toHaveValue('还没保存的草稿');
  await mobile.getByRole('button', { name: '取消', exact: true }).click(); await expect(mobile.getByTestId('canvas')).toHaveAttribute('data-object-count', '0');
  await mobileContext.close();
});

test('legacy TV creates a room, receives phone previews and restores through reload', async ({ browser, page }) => {
  let invite = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', ws => ws.on('framereceived', event => {
    const message = JSON.parse(event.payload.toString());
    if (message.type === 'ready') invite = `${new URL(page.url()).origin}/?room=${new URL(page.url()).searchParams.get('room')}#token=${message.access.inviteToken}`;
  }));
  await page.goto('/legacy-tv.html?mode=tv&tvShell=android');
  await expect(page.getByRole('button', { name: '创建电视白板' })).toBeFocused();
  await page.evaluate(() => window.WhiteboardTV!.key('Enter'));
  await expect(page.getByAltText('电视编辑加入二维码')).toBeVisible();
  await expect.poll(() => invite).toContain('#token=');
  const editor = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await editor.goto(invite); await editor.getByPlaceholder('怎么称呼你？').fill('兼容测试'); await editor.getByRole('button', { name: '加入白板', exact: true }).click();
  await editor.getByRole('button', { name: '添加便签', exact: true }).click(); await editor.mouse.click(350, 280);
  await editor.getByLabel('内容', { exact: true }).fill('电视实时呈现中文便签');
  await expect(page.locator('#board')).toHaveAttribute('data-object-preview-count', '1');
  await editor.getByRole('button', { name: '保存内容' }).click();
  await expect(page.locator('#board')).toHaveAttribute('data-object-count', '1');
  await editor.getByRole('button', { name: '画笔', exact: true }).click();
  await editor.mouse.move(400, 560); await editor.mouse.down(); await editor.mouse.move(650, 560, { steps: 10 });
  await expect(page.locator('#board')).toHaveAttribute('data-preview-count', '1'); await editor.mouse.up();
  await expect(page.locator('#board')).toHaveAttribute('data-stroke-count', '1');
  await page.getByRole('button', { name: '手机管理', exact: true }).click();
  await expect(page.getByAltText('手机主持认领二维码')).toBeVisible();
  await page.evaluate(() => window.WhiteboardTV!.back());
  await expect(page.getByAltText('电视编辑加入二维码')).toBeVisible();
  await page.reload(); await expect(page.locator('#board')).toHaveAttribute('data-object-count', '1');
  await expect(page.locator('#board')).toHaveAttribute('data-stroke-count', '1');
  await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
  expect(errors).toEqual([]); await editor.close();
});

test('phone uploads, moves and resizes images with both TV renderers; QR collapse expands local view', async ({ browser, page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 }); await create(page);
  const canvas = page.getByTestId('canvas');
  const url = (await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!;
  const parsed = new URL(url), credentials = { roomId: parsed.searchParams.get('room')!, role: 'viewer', token: new URLSearchParams(parsed.hash.slice(1)).get('token')! };
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage(); tv.on('pageerror', e => errors.push(e.message));
  await tv.goto(url); await tv.getByRole('button', { name: '打开电视总览' }).click();
  const legacyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await legacyContext.addInitScript(value => localStorage.setItem('whiteboard.tv.last', JSON.stringify(value)), credentials);
  const legacy = await legacyContext.newPage(); legacy.on('pageerror', e => errors.push(e.message));
  await legacy.goto('/legacy-tv.html?room=' + credentials.roomId);
  await expect(legacy.getByAltText('电视编辑加入二维码')).toBeVisible();
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1000;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#315efb'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 120px sans-serif'; ctx.fillText('一起，把想法变成画面', 120, 380); ctx.fillStyle = '#f5d970'; ctx.fillRect(120, 520, 800, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('选择图片文件').setInputFiles({ name: '创意.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  for (const c of [canvas, tv.getByTestId('canvas'), legacy.locator('#board')]) { await expect(c).toHaveAttribute('data-object-count', '1'); await expect(c).toHaveAttribute('data-loaded-image-count', '1'); }
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  let backup = await exported(page); expect(backup.schemaVersion).toBe(3); expect(Object.values(backup.assets)[0]).toMatch(/^data:image\/png;base64,/);
  const original = backup.objects[0]; expect(original.width / original.height).toBeCloseTo(1.6);
  const start = await objectPoint(page, original);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 40, start.y + 20, { steps: 8 });
  await expect(legacy.locator('#board')).toHaveAttribute('data-object-preview-count', '1');
  await page.mouse.up(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  backup = await exported(page); expect(backup.objects[0].x).toBeGreaterThan(original.x);
  const image = backup.objects[0], camera = JSON.parse((await canvas.getAttribute('data-camera'))!);
  const corner = { x: (image.x + image.width) * camera.zoom + camera.x, y: (image.y + image.height) * camera.zoom + camera.y };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 24, corner.y + 20, { steps: 8 });
  await expect(tv.getByTestId('canvas')).toHaveAttribute('data-object-preview-count', '1');
  await page.mouse.up(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  backup = await exported(page); expect(backup.objects[0].width).toBeGreaterThan(image.width); expect(backup.objects[0].width / backup.objects[0].height).toBeCloseTo(1.6);
  await page.getByRole('button', { name: '缩小图片' }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const cameraBefore = await canvas.getAttribute('data-camera');
  const before = Number(await legacy.locator('#board').getAttribute('data-view-width'));
  await legacy.getByRole('button', { name: '收起二维码' }).focus(); await legacy.evaluate(() => window.WhiteboardTV!.key('Enter'));
  await expect(legacy.locator('#board')).toHaveAttribute('data-join-visible', 'false');
  await expect.poll(async () => Number(await legacy.locator('#board').getAttribute('data-view-width'))).toBeGreaterThan(before);
  await tv.getByRole('button', { name: '收起二维码' }).click();
  await expect(tv.getByTestId('canvas')).toHaveAttribute('data-join-visible', 'false');
  expect(await canvas.getAttribute('data-camera')).toBe(cameraBefore);
  await page.mouse.move(180, 350); await legacy.getByRole('button', { name: '管理成员', exact: true }).click();
  await legacy.getByRole('button', { name: '关注 小林' }).click();
  await expect.poll(async () => JSON.parse((await legacy.locator('#board').getAttribute('data-camera'))!).zoom).toBe(1);
  await legacy.getByRole('button', { name: '显示全部内容' }).click(); await expect(legacy.getByRole('button', { name: '完整画布', exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-loaded-image-count', '1');
  backup = await exported(page); const point = await objectPoint(page, backup.objects[0]);
  await page.getByRole('button', { name: '选择对象' }).click(); await page.mouse.click(point.x, point.y); await page.getByRole('button', { name: '删除对象' }).click();
  await expect(legacy.locator('#board')).toHaveAttribute('data-object-count', '0'); await expect(tv.getByTestId('canvas')).toHaveAttribute('data-object-count', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); await legacyContext.close(); await tvContext.close();
});

test('TV controls keep the QR anchor fixed and distinguish canvas from content with smooth motion', async ({ browser, page }) => {
  test.setTimeout(120000);
  await create(page);
  await page.getByRole('button', { name: '添加便签', exact: true }).click(); await page.mouse.click(500, 300);
  await page.getByLabel('内容', { exact: true }).fill('一小块内容'); await page.getByRole('button', { name: '保存内容' }).click();
  const note = (await exported(page)).objects[0];
  const url = (await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!;
  const parsed = new URL(url), credentials = { roomId: parsed.searchParams.get('room')!, role: 'viewer', token: new URLSearchParams(parsed.hash.slice(1)).get('token')! };
  for (const legacy of [false, true]) {
    const context = await browser.newContext({ viewport: legacy ? { width: 960, height: 540 } : { width: 1920, height: 1080 } });
    if (legacy) await context.addInitScript(value => localStorage.setItem('whiteboard.tv.last', JSON.stringify(value)), credentials);
    const tv = await context.newPage(), errors: string[] = []; tv.on('pageerror', e => errors.push(e.message));
    await tv.goto(legacy ? '/legacy-tv.html?room=' + credentials.roomId : url);
    if (!legacy) await tv.getByRole('button', { name: '打开电视总览' }).click();
    const canvas = legacy ? tv.locator('#board') : tv.getByTestId('canvas');
    const toggle = legacy ? tv.locator('#toggle-qr') : tv.locator('.qr-toggle');
    await expect(canvas).toHaveAttribute('data-object-count', '1');
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    const anchor = await toggle.boundingBox(); expect(anchor).toBeTruthy();
    for (let i = 0; i < 4; i++) {
      await toggle.focus(); await tv.keyboard.press('Enter');
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', i % 2 ? 'true' : 'false');
      expect(await toggle.boundingBox()).toEqual(anchor);
      await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
      expect(await toggle.boundingBox()).toEqual(anchor);
      if (i % 2 === 0) await expect(tv.getByAltText('电视编辑加入二维码')).not.toBeVisible();
      else await expect(tv.getByAltText('电视编辑加入二维码')).toBeVisible();
    }
    const qrBounds = await (legacy ? tv.locator('#qr-content') : tv.locator('.tv-qr-content')).boundingBox();
    const footer = await (legacy ? tv.locator('#view-controls') : tv.locator('.zoom-controls')).boundingBox();
    expect(qrBounds!.y + qrBounds!.height).toBeLessThan(anchor!.y);
    expect(anchor!.y + anchor!.height).toBeLessThan(footer!.y);
    const row = tv.locator('[data-tv-row="view"]');
    await expect(row).toHaveText(['完整画布', '显示全部内容']);
    await row.nth(0).focus(); await tv.keyboard.press('ArrowLeft'); await expect(tv.getByRole('button', { name: '隐藏界面' })).toBeFocused();
    await tv.keyboard.press('ArrowRight'); await expect(row.nth(0)).toBeFocused();
    await tv.keyboard.press('ArrowRight'); await expect(row.nth(1)).toBeFocused();
    await tv.keyboard.press('ArrowUp'); await expect(toggle).toBeFocused();
    await tv.keyboard.press('ArrowLeft'); await expect(toggle).toBeFocused();
    await tv.keyboard.press('ArrowDown'); await expect(row.nth(1)).toBeFocused();
    await tv.keyboard.press('ArrowRight'); await expect(row.nth(1)).toBeFocused();
    await tv.keyboard.press('ArrowDown'); await expect(row.nth(1)).toBeFocused();
    const full = tv.getByRole('button', { name: '完整画布', exact: true });
    const content = tv.getByRole('button', { name: '显示全部内容', exact: true });
    await full.focus(); await expect(full).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    const wide = JSON.parse((await canvas.getAttribute('data-camera'))!);
    await tv.keyboard.press('ArrowRight'); await expect(content).toBeFocused(); await expect(content).toHaveAttribute('aria-pressed', 'true'); await expect(full).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas).toHaveAttribute('data-view-mode', 'content');
    await expect(canvas).toHaveAttribute('data-camera-moving', 'true');
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    expect(JSON.parse((await canvas.getAttribute('data-camera'))!).zoom).toBeGreaterThan(wide.zoom);
    const fitted = JSON.parse((await canvas.getAttribute('data-camera'))!);
    expect((note.y + 200) * fitted.zoom + fitted.y).toBeLessThanOrEqual(anchor!.y + .1);
    const style = await content.evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, transition: getComputedStyle(el).transitionDuration, background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(style.outline).toBe('none'); expect(style.transition).not.toBe('0s'); expect(style.background).not.toBe('rgb(255, 255, 255)'); expect(style.color).toBe('rgb(255, 255, 255)');
    await full.click(); await expect(canvas).toHaveAttribute('data-view-mode', 'canvas'); await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    expect(JSON.parse((await canvas.getAttribute('data-camera'))!).zoom).toBeCloseTo(wide.zoom, 3);
    // The QR button immediately uses the same solid blue focus state.
    await toggle.focus(); await expect(toggle).toHaveCSS('background-color', 'rgb(49, 94, 251)'); await expect(toggle).toHaveCSS('color', 'rgb(255, 255, 255)');
    await tv.keyboard.press('ArrowUp'); await expect(tv.getByRole('button', { name: '设置', exact: true })).toBeFocused();
    await tv.keyboard.press('ArrowLeft'); await expect(tv.getByRole('button', { name: '管理成员', exact: true })).toBeFocused();
    const sync = await (legacy ? tv.locator('#saved') : tv.locator('.tv-sync')).boundingBox();
    const connection = await (legacy ? tv.locator('#status') : tv.locator('.connection')).boundingBox();
    expect(sync!.x + sync!.width).toBeLessThan(connection!.x);
    await tv.getByRole('button', { name: '设置', exact: true }).click();
    await expect(tv.getByRole('dialog', { name: '电视白板', exact: true })).toBeVisible();
    await tv.keyboard.press('Escape'); await expect(tv.getByRole('dialog')).toHaveCount(0);
    await tv.keyboard.press('Escape'); await expect(tv.getByRole('dialog', { name: '退出白板？' })).toBeVisible();
    await tv.getByRole('button', { name: '继续展示', exact: true }).click();
    await content.focus(); await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    const shownZoom = JSON.parse((await canvas.getAttribute('data-camera'))!).zoom;
    await tv.getByRole('button', { name: '隐藏界面' }).click();
    await expect(tv.getByRole('button', { name: '显示界面' })).toBeFocused();
    await expect(tv.getByRole('button')).toHaveCount(1);
    await expect(tv.getByAltText('电视编辑加入二维码')).not.toBeVisible();
    await expect(tv.getByRole('heading', { name: '共创白板', exact: true })).not.toBeVisible();
    await expect(canvas).toHaveAttribute('data-camera-moving', 'false');
    expect(JSON.parse((await canvas.getAttribute('data-camera'))!).zoom).toBeGreaterThan(shownZoom);
    await tv.keyboard.press('ArrowRight'); await expect(tv.getByRole('button', { name: '显示界面' })).toBeFocused();
    await tv.keyboard.press('Enter'); await expect(tv.getByRole('button', { name: '隐藏界面' })).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(await toggle.boundingBox()).toEqual(anchor);
    await expect(content).toHaveAttribute('aria-pressed', 'true');
    await context.close(); expect(errors).toEqual([]);
  }
});

test('shapes and attached arrows preview on both TVs, follow moves, detach and recover', async ({ browser, page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await create(page);
  const url = (await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!;
  const parsed = new URL(url), credentials = { roomId: parsed.searchParams.get('room')!, role: 'viewer', token: new URLSearchParams(parsed.hash.slice(1)).get('token')! };
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvContext.newPage(); tv.on('pageerror', e => errors.push(e.message)); await tv.goto(url); await tv.getByRole('button', { name: '打开电视总览' }).click();
  const oldContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await oldContext.addInitScript(c => localStorage.setItem('whiteboard.tv.last', JSON.stringify(c)), credentials);
  const old = await oldContext.newPage(); old.on('pageerror', e => errors.push(e.message)); await old.goto('/legacy-tv.html?room=' + credentials.roomId);
  const canvases = [tv.getByTestId('canvas'), old.locator('#board')];
  const shapeTool = async (name: string) => { await page.getByRole('button', { name: '形状与连线', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); };
  await shapeTool('矩形');
  await page.mouse.move(380, 270); await page.mouse.down(); await page.mouse.move(580, 410, { steps: 12 });
  for (const canvas of canvases) { await expect(canvas).toHaveAttribute('data-object-preview-count', '1'); await expect(canvas).toHaveAttribute('data-object-count', '0'); }
  await page.mouse.up(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  await shapeTool('椭圆'); await page.mouse.move(820, 270); await page.mouse.down(); await page.mouse.move(1020, 410, { steps: 12 }); await page.mouse.up();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-object-count', '2');
  await shapeTool('箭头'); await page.mouse.move(480, 340); await page.mouse.down(); await page.mouse.move(920, 340, { steps: 12 }); await page.mouse.up();
  for (const canvas of canvases) await expect(canvas).toHaveAttribute('data-object-count', '3');
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  let data = await exported(page); expect(data.schemaVersion).toBe(4);
  const rectangle = data.objects.find((o: any) => o.kind === 'shape' && o.shape === 'rectangle');
  const ellipse = data.objects.find((o: any) => o.kind === 'shape' && o.shape === 'ellipse');
  const link = data.objects.find((o: any) => o.kind === 'connector');
  expect(link.fromId).toBe(rectangle.id); expect(link.toId).toBe(ellipse.id);
  const before = JSON.parse((await tv.getByTestId('canvas').getAttribute('data-connectors'))!)[0];
  await page.mouse.move(450, 320); await page.mouse.down(); await page.mouse.move(490, 440, { steps: 12 });
  for (const canvas of canvases) {
    await expect(canvas).toHaveAttribute('data-object-preview-count', '1');
    await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-connectors'))!)[0].y).toBeGreaterThan(before.y + 20);
  }
  await page.mouse.up(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  data = await exported(page); const moved = data.objects.find((o: any) => o.id === rectangle.id);
  const c = JSON.parse((await page.getByTestId('canvas').getAttribute('data-camera'))!);
  const corner = { x: (moved.x + moved.width) * c.zoom + c.x, y: (moved.y + moved.height) * c.zoom + c.y };
  await page.mouse.move(corner.x, corner.y); await page.mouse.down(); await page.mouse.move(corner.x + 50, corner.y + 25, { steps: 8 }); await page.mouse.up();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  data = await exported(page); expect(data.objects.find((o: any) => o.id === rectangle.id).width).toBeGreaterThan(moved.width);
  const attached = JSON.parse((await page.getByTestId('canvas').getAttribute('data-connectors'))!)[0];
  await page.getByRole('button', { name: '删除对象', exact: true }).click(); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  data = await exported(page); const detached = data.objects.find((o: any) => o.id === link.id); expect(detached.fromId).toBeNull(); expect(detached.x).toBeCloseTo(attached.x); expect(detached.y).toBeCloseTo(attached.y);
  // Drag the free endpoint to a new point; no bounding-box false hit inside a diagonal line.
  const end = { x: detached.x * c.zoom + c.x, y: detached.y * c.zoom + c.y };
  await page.mouse.click(end.x, end.y); await page.mouse.move(end.x, end.y); await page.mouse.down(); await page.mouse.move(end.x - 100, end.y + 80, { steps: 8 }); await page.mouse.up();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  data = await exported(page); expect(data.objects.find((o: any) => o.id === link.id).x).toBeLessThan(detached.x);
  await page.reload(); await page.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-object-count', '2');
  for (const canvas of canvases) await expect(canvas).toHaveAttribute('data-object-count', '2');
  expect(errors).toEqual([]); await tvContext.close(); await oldContext.close();
});

test('phone palette draws a reverse shape, cancels multi-touch creation and saves an offline connector', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await create(page);
  const choose = async (name: string) => { await page.getByRole('button', { name: '形状与连线', exact: true }).click(); await page.getByRole('button', { name, exact: true }).click(); };
  await choose('矩形');
  await page.mouse.move(300, 420); await page.mouse.down(); await page.mouse.move(100, 260, { steps: 10 }); await page.mouse.up();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  let data = await exported(page); expect(data.objects[0].width).toBeGreaterThan(16); expect(data.objects[0].height).toBeGreaterThan(16);
  const canvas = page.getByTestId('canvas');
  await choose('椭圆');
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 300, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 340, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 340, id: 1 }, { x: 220, y: 400, id: 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  await expect(canvas).toHaveAttribute('data-object-count', '1');
  await context.setOffline(true); await expect(page.getByText('连接中断', { exact: true })).toBeAttached();
  await choose('连线'); await page.mouse.move(80, 500); await page.mouse.down(); await page.mouse.move(310, 570, { steps: 10 }); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-object-count', '2');
  await context.setOffline(false); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  data = await exported(page); expect(data.objects.find((o: any) => o.kind === 'connector').arrow).toBe(false);
  await page.getByRole('button', { name: '形状与连线', exact: true }).click();
  const panel = await page.locator('.shape-tools').boundingBox(), toolbar = await page.locator('.toolbar').boundingBox();
  expect(panel!.y + panel!.height).toBeLessThan(toolbar!.y);
  const views = await page.locator('.zoom-controls').boundingBox(); expect(panel!.y + panel!.height).toBeLessThan(views!.y);
  await expect(page.locator('.object-actions')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('personal undo and redo synchronize both TVs, survive reload, and PNG exports exclude controls', async ({ browser, page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await create(page);
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const url = (await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!;
  const parsed = new URL(url), credentials = { roomId: parsed.searchParams.get('room')!, role: 'viewer', token: new URLSearchParams(parsed.hash.slice(1)).get('token')! };
  const tvContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await tvContext.addInitScript(c => localStorage.setItem('whiteboard.tv.last', JSON.stringify(c)), credentials);
  const tv = await tvContext.newPage(); await tv.goto('/legacy-tv.html?room=' + credentials.roomId);
  const modern = await browser.newPage(); await modern.goto(url); await modern.getByRole('button', { name: '打开电视总览' }).click();
  await page.getByRole('button', { name: '添加便签', exact: true }).click(); await page.mouse.click(500, 300);
  await page.getByLabel('内容', { exact: true }).fill('一起撤销，保留彼此的想法'); await page.getByRole('button', { name: '保存内容' }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  for (const c of [tv.locator('#board'), modern.getByTestId('canvas')]) await expect(c).toHaveAttribute('data-object-count', '0');
  await page.keyboard.press('Control+Shift+z');
  for (const c of [tv.locator('#board'), modern.getByTestId('canvas')]) await expect(c).toHaveAttribute('data-object-count', '1');
  await page.reload(); await page.getByRole('button', { name: '加入白板', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  const backup = await exported(page); expect(backup.objects).toHaveLength(1);
  await page.getByRole('button', { name: '导出图片', exact: true }).click();
  async function png(name: string) {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
    const download = await pending, stream = await download.createReadStream(), chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks); expect(data.subarray(1,4).toString()).toBe('PNG');
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), data };
  }
  const content = await png('导出全部内容'); expect(content.width).toBe(640); expect(content.height).toBe(400);
  const pixel = await page.evaluate(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return [...ctx.getImageData(20, 100, 1, 1).data];
  }, content.data.toString('base64'));
  expect(pixel).toEqual([255,241,173,255]);
  await page.getByRole('button', { name: '导出图片', exact: true }).click();
  const full = await png('导出完整画布'); expect(full.width).toBeGreaterThan(content.width); expect(full.width / full.height).toBeCloseTo(1280/720);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(tv.locator('#board')).toHaveAttribute('data-object-count', '0');
  await page.getByRole('button', { name: '重做', exact: true }).click(); await expect(tv.locator('#board')).toHaveAttribute('data-object-count', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]); await tvContext.close(); await modern.close();
});

test('overlapping image and connector retain identical stacking on editor, hydrated TV, reload and PNG', async ({ browser, page }) => {
  test.setTimeout(60000);
  await create(page);
  await page.getByRole('button', { name: '形状与连线', exact: true }).click(); await page.getByRole('button', { name: '箭头', exact: true }).click();
  await page.mouse.move(400, 378); await page.mouse.down(); await page.mouse.move(1000, 378, { steps: 8 }); await page.mouse.up();
  const raster = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 120; const ctx = c.getContext('2d')!; ctx.fillStyle = '#FA8908'; ctx.fillRect(0,0,240,120); return c.toDataURL().split(',')[1]; });
  await page.getByLabel('选择图片文件').setInputFiles({ name: 'overlap.png', mimeType: 'image/png', buffer: Buffer.from(raster, 'base64') });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-loaded-image-count', '1'); await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const data = await exported(page), img = data.objects.find((o: any) => o.kind === 'image');
  const point = { x: img.x + img.width / 2, y: img.y + img.height / 2 };
  async function pixel(p: Page) {
    return p.getByTestId('canvas').evaluate((el, point) => {
      const cam = JSON.parse((el as HTMLElement).dataset.camera!), canvas = el.querySelector('canvas')!, ratio = canvas.width / canvas.clientWidth;
      return [...canvas.getContext('2d')!.getImageData(Math.round((point.x * cam.zoom + cam.x) * ratio), Math.round((point.y * cam.zoom + cam.y) * ratio), 1, 1).data];
    }, point);
  }
  expect(await pixel(page)).toEqual([250,137,8,255]);
  const url = (await page.getByRole('link', { name: '电视视图' }).getAttribute('href'))!;
  const tv = await browser.newPage(); await tv.goto(url); await tv.getByRole('button', { name: '打开电视总览' }).click();
  await expect(tv.getByTestId('canvas')).toHaveAttribute('data-loaded-image-count', '1'); await expect(tv.getByTestId('canvas')).toHaveAttribute('data-camera-moving', 'false');
  expect(await pixel(tv)).toEqual([250,137,8,255]);
  await page.reload(); await page.getByRole('button', { name: '加入白板', exact: true }).click(); await expect(page.getByTestId('canvas')).toHaveAttribute('data-loaded-image-count', '1');
  expect(await pixel(page)).toEqual([250,137,8,255]);
  await page.getByRole('button', { name: '导出图片', exact: true }).click(); const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出完整画布', exact: true }).click();
  const stream = await (await pending).createReadStream(), chunks: Buffer[] = []; for await (const c of stream!) chunks.push(Buffer.from(c));
  const pngPixel = await page.evaluate(async ({ bytes, point }) => { const img = new Image(); img.src = 'data:image/png;base64,' + bytes; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d')!; ctx.drawImage(img,0,0); return [...ctx.getImageData(Math.round(point.x*2), Math.round(point.y*2),1,1).data]; }, { bytes: Buffer.concat(chunks).toString('base64'), point });
  expect(pngPixel).toEqual([250,137,8,255]); await tv.close();
});
