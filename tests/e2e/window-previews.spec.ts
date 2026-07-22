import { expect, test } from '@playwright/test'

test('orb preview exposes exactly five categories', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb&placement=bottom-right')
  await page.getByRole('button', { name: '展开冒泡' }).click()
  await expect(page.locator('.petal')).toHaveCount(5)
  await expect(page.locator('.petal-position')).toHaveCount(5)
  await page.waitForTimeout(650)
  await page.screenshot({ path: 'test-results/orb-stage2.png', omitBackground: true })
})

test('top and bottom edges expand as centered semicircles', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })

  for (const placement of ['top', 'bottom']) {
    await page.goto(`/?window=orb&placement=${placement}`)
    await page.getByRole('button', { name: '展开冒泡' }).click()
    await expect(page.locator('.petal-position')).toHaveCount(5)
    await page.waitForTimeout(650)

    const orb = await page.locator('.orb-position').boundingBox()
    const petals = await page.locator('.petal-position').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }),
    )
    if (!orb) throw new Error('orb bounding box missing')
    const orbCenter = { x: orb.x + orb.width / 2, y: orb.y + orb.height / 2 }
    const minX = Math.min(...petals.map(({ x }) => x))
    const maxX = Math.max(...petals.map(({ x }) => x))

    expect((minX + maxX) / 2).toBeCloseTo(orbCenter.x, 0)
    expect(
      petals.every(({ y }) => (placement === 'top' ? y > orbCenter.y : y < orbCenter.y)),
    ).toBe(true)
    await page.screenshot({
      path: `test-results/orb-${placement}.png`,
      omitBackground: true,
    })
  }
})

test('orb state machine ignores repeated clicks during the opening animation', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  const orb = page.locator('.orb-button')

  await orb.dblclick()
  await expect(page.locator('.petal')).toHaveCount(5)
  await expect(orb).toHaveAttribute('aria-expanded', 'true')
})

test('petals collapse back into the orb', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  const orb = page.locator('.orb-button')

  await orb.click()
  await expect(page.locator('.petal')).toHaveCount(5)
  await page.waitForTimeout(500)
  await orb.click()
  await expect(page.locator('.petal')).toHaveCount(0)
  await expect(orb).toHaveAttribute('aria-expanded', 'false')
})

test('petals collapse when the orb window loses focus', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  const orb = page.locator('.orb-button')

  await orb.click()
  await expect(page.locator('.petal')).toHaveCount(5)
  await page.waitForTimeout(500)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))

  await expect(page.locator('.petal')).toHaveCount(0)
  await expect(orb).toHaveAttribute('aria-expanded', 'false')
})

test('dragging the orb does not trigger a click and it remains clickable afterwards', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  const orb = page.getByRole('button', { name: '展开冒泡' })
  const box = await orb.boundingBox()
  if (!box) throw new Error('orb bounding box missing')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 36, box.y + box.height / 2 - 18, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.petal')).toHaveCount(0)

  await orb.click()
  await expect(page.locator('.petal')).toHaveCount(5)
})

test('orb applies paused mode and distinguishes a configured double click', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.evaluate(() => {
    localStorage.setItem('petal-toolbox.app-settings', JSON.stringify({
      mode: 'paused', globalShortcut: 'Ctrl+Alt+Space', doubleClickAction: 'quick-actions',
      autostart: false, orbSize: 60, orbOpacity: 0.8,
    }))
  })
  await page.reload()
  const orb = page.getByRole('button', { name: /完全暂停/ })
  await expect(orb).toBeVisible()
  await expect(page.locator('.mode-dot.paused')).toBeVisible()
  await expect(orb).toHaveCSS('width', '60px')
  await orb.dblclick({ delay: 80 })
  await expect(page.getByRole('button', { name: '关闭功能面板' })).toBeVisible()
})

test('panel preview mounts its lightweight shell', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await expect(page.getByRole('heading', { name: '快捷入口', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/panel-stage3.png', omitBackground: true })
})

test('quick actions copy values and manage safe web links', async ({ page, context }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  })

  const navigation = page.getByRole('navigation', { name: '快捷入口工具' })
  await navigation.getByRole('button', { name: '快捷复制' }).click()
  await page.getByRole('button', { name: /当前日期/ }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await navigation.getByRole('button', { name: '网址与应用' }).click()
  await page.getByRole('textbox', { name: '网址地址' }).fill('file:///tmp/private')
  await page.getByRole('button', { name: '添加网址' }).click()
  await expect(page.getByRole('alert')).toContainText('http')

  await page.getByRole('textbox', { name: '网址名称' }).fill('项目主页')
  await page.getByRole('textbox', { name: '网址地址' }).fill('https://example.com/project')
  await page.getByRole('button', { name: '添加网址' }).click()
  await expect(page.getByText('项目主页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '编辑网址' }).click()
  await expect(page.getByRole('textbox', { name: '网址名称' })).toHaveValue('项目主页')
  await expect(page.getByRole('textbox', { name: '网址地址' })).toHaveValue('https://example.com/project')
  await page.getByRole('textbox', { name: '网址名称' }).fill('项目文档')
  await page.getByRole('textbox', { name: '网址地址' }).fill('https://example.com/docs')
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('项目文档', { exact: true })).toBeVisible()
  await expect(page.getByText('https://example.com/docs', { exact: true })).toBeVisible()
  const entryCategories = page.getByRole('navigation', { name: '常用入口分类' })
  await entryCategories.getByRole('button', { name: '常用应用' }).click()
  await expect(page.getByText('还没有添加常用应用')).toBeVisible()
  await expect(page.getByText('项目文档', { exact: true })).toHaveCount(0)
  await entryCategories.getByRole('button', { name: '常用网址' }).click()
  await expect(page.getByText('项目文档', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/quick-links-stage8.png', omitBackground: true })

  await navigation.getByRole('button', { name: '最近与收藏' }).click()
  await expect(page.getByText('当前日期', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/quick-actions-stage8.png', omitBackground: true })
})

test('panel routes all five categories and supports common actions', async ({ page }) => {
  await page.goto('/?window=panel')

  const categories = [
    ['health', '健康提醒'],
    ['clipboard', '剪贴板'],
    ['dev-tools', '开发转换'],
    ['files', '文件与路径'],
    ['quick-actions', '快捷入口'],
  ] as const

  for (const [category, label] of categories) {
    await page.evaluate((nextCategory) => {
      window.dispatchEvent(
        new CustomEvent('panel:navigate', { detail: { category: nextCategory } }),
      )
    }, category)
    await expect(page.locator('.panel-stage')).toHaveAttribute('data-view', category)
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
  }

  await page.getByRole('button', { name: '收藏分类' }).click()
  await expect(page.getByText('已收藏当前分类')).toBeVisible()

  await page.getByRole('button', { name: '打开设置' }).click()
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-view', 'settings')
  await page.getByRole('radio', { name: '深色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: '返回分类' }).click()
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-close', 'back')
})

test('settings configure modes, shortcuts, double click and local data cleanup', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'settings' } }))
  })

  const settingsNavigation = page.getByRole('navigation', { name: '设置分类' })
  await expect(page.getByRole('slider', { name: '悬浮球尺寸' })).toBeVisible()
  await settingsNavigation.getByRole('button', { name: '行为' }).click()
  await page.getByRole('button', { name: /静默模式/ }).click()
  await expect(page.getByRole('button', { name: /静默模式/ })).toHaveAttribute('aria-pressed', 'true')

  const shortcut = page.getByLabel('全局快捷键')
  await shortcut.fill('Ctrl+K')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('两个修饰键')
  await shortcut.fill('Ctrl+Alt+K')
  await page.getByRole('button', { name: '应用', exact: true }).click()
  await expect(page.getByText('全局快捷键已生效')).toBeVisible()
  await page.getByLabel('双击悬浮球').selectOption('quick-actions')

  await settingsNavigation.getByRole('button', { name: '数据与应用' }).click()
  await page.getByRole('button', { name: /清除数据并保留设置/ }).click()
  await expect(page.getByRole('alertdialog', { name: '清除全部本地数据？' })).toBeVisible()
  await page.getByRole('button', { name: '确认清除' }).click()
  await expect(page.getByText('本地数据已清除，设置已保留')).toBeVisible()
  await page.screenshot({ path: 'test-results/settings-stage8.png', omitBackground: true })
})

test('developer tools format and copy JSON, and expose six tools', async ({ page, context }) => {
  await page.setViewportSize({ width: 760, height: 620 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'dev-tools' } }))
  })

  const switcher = page.getByRole('navigation', { name: '开发转换工具' })
  await expect(switcher.getByRole('button')).toHaveCount(6)
  await page.getByRole('textbox', { name: 'JSON 输入' }).fill('{"name":"花瓣","count":6}')
  await page.getByRole('button', { name: '格式化' }).click()
  const headerBounds = await page.locator('.panel-header').boundingBox()
  expect(headerBounds?.y).toBeGreaterThanOrEqual(12)
  await expect(page.getByRole('textbox', { name: 'JSON 结果' })).toHaveValue(
    '{\n  "name": "花瓣",\n  "count": 6\n}',
  )
  await page.screenshot({ path: 'test-results/dev-tools-stage4.png', omitBackground: true })
  await page.getByRole('button', { name: '复制结果' }).click()
  await expect(page.getByText('JSON 结果已复制')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"count": 6')

  for (const name of ['URL', 'Base64', '时间戳', '二维码', 'UUID']) {
    await switcher.getByRole('button', { name }).click()
  }
  await expect(page.getByRole('heading', { name: 'UUID 生成' })).toBeVisible()
})

test('QR code tool generates an image and recognizes an uploaded QR code', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 620 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'dev-tools' } }))
  })
  await page.getByRole('button', { name: '二维码' }).click()
  const source = '冒泡 QR 识别 https://example.com'
  await page.getByRole('textbox', { name: '二维码字符串' }).fill(source)
  await page.getByRole('button', { name: '转换' }).click()
  const generated = page.getByRole('img', { name: '生成的二维码' })
  await expect(generated).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存图片' }).click()
  await expect(page.getByText('二维码图片已保存')).toBeVisible()
  await downloadPromise
  const dataUrl = await generated.getAttribute('src')
  if (!dataUrl) throw new Error('generated QR data URL missing')
  await page.getByLabel('上传二维码图片').setInputFiles({
    name: 'generated-qr.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64'),
  })
  await expect(page.getByRole('textbox', { name: '二维码识别结果' })).toHaveValue(source)
  await expect(page.getByText('二维码识别成功')).toBeVisible()
  await page.screenshot({ path: 'test-results/qr-code-tool.png', omitBackground: true })
})

test('health panel manages reminder projects and common pause policies', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 560 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'health' } }))
  })

  await expect(page.locator('.reminder-row')).toHaveCount(5)
  await expect(page.getByRole('checkbox', { name: '起立活动提醒' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '提肛训练提醒' })).not.toBeChecked()
  await expect(page.locator('.reminder-field').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /立即调试.+提醒/ })).toHaveCount(5)
  await page.getByRole('button', { name: '新增提醒' }).click()
  await page.getByLabel('项目标题').fill('伸展肩颈')
  await page.getByLabel('项目介绍').fill('活动肩膀和颈部，放松一下。')
  await page.getByLabel('新增提醒间隔时间').fill('25')
  await page.getByRole('button', { name: '新增项目' }).click()
  await expect(page.getByText('提醒项目已新增')).toBeVisible()
  await expect(page.locator('.reminder-row')).toHaveCount(6)
  await expect(page.getByRole('checkbox', { name: '伸展肩颈提醒' })).toBeChecked()
  await expect(page.getByLabel('伸展肩颈间隔时间')).toHaveValue('25')
  await page.getByRole('button', { name: '删除坐姿调整提醒' }).click()
  await expect(page.getByRole('alertdialog', { name: '删除提醒项目？' })).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.reminder-row')).toHaveCount(5)
  await expect(page.getByText('坐姿调整', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/health-stage5.png', omitBackground: true })
  await page.locator('html').evaluate((element) => { element.dataset.theme = 'dark' })
  await page.locator('.health-policies').scrollIntoViewIfNeeded()
  await expect(page.getByText('勿扰时间', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/health-dark-stage5.png', omitBackground: true })
  await page.getByRole('checkbox', { name: '提肛训练提醒' }).check()
  await expect(page.getByText('提醒设置已保存')).toBeVisible()
  await page.getByRole('button', { name: '暂停 30 分钟' }).click()
  await expect(page.getByText('提醒已暂停 30 分钟')).toBeVisible()
  await page.getByRole('button', { name: '立即调试起立活动提醒' }).click()
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-close', 'close')
})

test('clipboard panel searches, copies, favorites and deletes a text card', async ({ page, context }) => {
  await page.setViewportSize({ width: 680, height: 720 })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    const now = new Date().toISOString()
    const older = new Date(Date.now() - 60_000).toISOString()
    const oldest = new Date(Date.now() - 120_000).toISOString()
    localStorage.setItem('petal-toolbox.clipboard-items', JSON.stringify([
      {
        id: 'clipboard-e2e-item', type: 'plain_text', textContent: '冒泡剪贴板测试内容',
        contentHash: 'text:e2e:12', previewText: '冒泡剪贴板测试内容', createdAt: now,
        updatedAt: now, lastCopiedAt: now, copyCount: 1, isFavorite: false,
        isPinned: false, isSensitive: false,
      },
      {
        id: 'clipboard-older-item', type: 'plain_text', textContent: '较早的卡片',
        contentHash: 'text:e2e:older', previewText: '较早的卡片', createdAt: older,
        updatedAt: older, lastCopiedAt: older, copyCount: 1, isFavorite: false,
        isPinned: false, isSensitive: false,
      },
      {
        id: 'clipboard-image-item', type: 'image',
        imagePath: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8nHkwAAAABJRU5ErkJggg==',
        contentHash: 'image:1x1:e2e', previewText: '1 × 1', createdAt: oldest,
        updatedAt: oldest, lastCopiedAt: oldest, copyCount: 1, isFavorite: false,
        isPinned: false, isSensitive: false,
      },
    ]))
  })
  await page.reload()
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'clipboard' } }))
  })

  const textCardBodies = page.locator('.card-body[aria-label="复制文本内容"]')
  await expect(textCardBodies.first()).toBeVisible()
  await expect(page.getByAltText('剪贴板图片，1 × 1')).toBeVisible()
  await page.locator('.clipboard-card').first().evaluate((card) => {
    const preview = card.querySelector('pre')
    if (!preview) throw new Error('clipboard preview missing')
    preview.textContent = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行长文本预览`).join('\n')
  })
  const previewCanScroll = await page.locator('.clipboard-card pre').first().evaluate((preview) => preview.scrollHeight > preview.clientHeight)
  expect(previewCanScroll).toBe(true)
  await page.screenshot({ path: 'test-results/clipboard-text-stage6.png', omitBackground: true })
  await textCardBodies.first().click()
  await expect(page.getByText('已复制到剪贴板')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('冒泡剪贴板测试内容')

  const cardsBeforeCopy = await page.locator('.clipboard-card pre').allTextContents()
  await textCardBodies.nth(1).click()
  await expect.poll(() => page.locator('.clipboard-card pre').allTextContents()).toEqual(cardsBeforeCopy)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('较早的卡片')

  const clipboardBeforePreview = await page.evaluate(() => navigator.clipboard.readText())
  await page.getByRole('button', { name: '预览剪贴板图片' }).click()
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
  await expect(page.getByAltText('剪贴板图片预览，1 × 1')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(clipboardBeforePreview)
  await page.getByRole('button', { name: '关闭图片预览' }).click()
  await expect(page.getByRole('dialog', { name: '图片预览' })).toHaveCount(0)

  const clipboardCard = page.locator('.clipboard-card').first()
  await clipboardCard.getByRole('button', { name: '收藏', exact: true }).click()
  await expect(clipboardCard.getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('searchbox', { name: '搜索剪贴板' }).fill('不存在')
  await expect(page.getByText('还没有匹配的记录')).toBeVisible()

  const sensitiveProtection = page.getByRole('checkbox', { name: '自动跳过敏感内容' })
  await sensitiveProtection.uncheck()
  await expect(page.getByRole('alertdialog', { name: '关闭敏感内容保护？' })).toBeVisible()
  await page.getByRole('button', { name: '仍然关闭' }).click()
  await expect(page.getByRole('alertdialog', { name: '关闭敏感内容保护？' })).toHaveCount(0)
  await expect(sensitiveProtection).not.toBeChecked()
  await expect(page.getByText('保护已关闭', { exact: true })).toBeVisible()
})

test('files panel converts paths and prepares date folders', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 620 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    localStorage.setItem('petal-toolbox.favorite-folders', JSON.stringify([{
      id: 'favorite-projects', name: '项目资料', path: '/Users/demo/Projects', sortOrder: 0,
    }]))
    localStorage.setItem('petal-toolbox.temporary-transfer-items', JSON.stringify([{
      id: 'transfer-demo', name: '交付资料.zip', originalPath: '/Users/demo/Desktop/交付资料.zip',
      storedPath: '/Users/demo/Library/Application Support/temporary-transfer/transfer-demo/交付资料.zip',
      kind: 'file', sizeBytes: 1572864, addedAt: '2099-07-21T08:00:00.000Z',
      expiresAt: '2099-07-28T08:00:00.000Z', isPinned: false,
    }]))
  })
  await page.reload()
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'files' } }))
  })

  await expect(page.getByRole('button', { name: /下载/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '文件夹名称' })).toHaveValue('项目资料')

  const filesNavigation = page.getByRole('navigation', { name: '文件与路径工具' })
  await filesNavigation.getByRole('button', { name: '路径转换' }).click()
  await page.getByRole('textbox', { name: '原始路径' }).fill('C:\\Users\\demo\\file.txt')
  await page.getByRole('checkbox', { name: /转换为 WSL/ }).check()
  await page.getByRole('button', { name: '转换路径' }).click()
  await expect(page.getByRole('textbox', { name: '路径转换结果' })).toHaveValue('/mnt/c/Users/demo/file.txt')

  await filesNavigation.getByRole('button', { name: '日期文件夹' }).click()
  await page.getByRole('radio', { name: '日期 + 主题' }).check()
  await page.getByRole('textbox', { name: '日期文件夹主题' }).fill('设计稿')
  await expect(page.locator('.folder-preview strong')).toContainText(/\d{4}-\d{2}-\d{2}_设计稿/)

  await filesNavigation.getByRole('button', { name: '临时中转' }).click()
  await expect(page.getByText('交付资料.zip', { exact: true })).toBeVisible()
  await expect(page.getByText('1.50 MB', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '固定中转项' }).click()
  await expect(page.getByText('已固定', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/files-stage7.png', omitBackground: true })
})

test('health debug event triggers a reminder before its schedule', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.getByRole('button', { name: '展开冒泡' }).waitFor()
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('health:debug-trigger', { detail: { reminderId: 'water' } }))
  })

  await expect(page.getByRole('alert', { name: '喝水提醒' })).toBeVisible()
  await expect(page.getByText('补充一些水分，给专注力充充电。')).toBeVisible()
})

test('a due health reminder opens one card and completion updates statistics', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.evaluate(() => {
    const now = new Date(Date.now() - 60_000).toISOString()
    localStorage.setItem('petal-toolbox.health-settings', JSON.stringify({
      silentMode: false,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      reminders: [
        { id: 'stand', enabled: true, intervalMinutes: 50, snoozeMinutes: 10, title: '起立活动', message: '站起来走动一下，让身体重新舒展。', nextTriggerAt: now },
        { id: 'water', enabled: false, intervalMinutes: 45, snoozeMinutes: 10, title: '喝水', message: '补充一些水分。', nextTriggerAt: now },
        { id: 'pelvic_floor', enabled: false, intervalMinutes: 60, snoozeMinutes: 10, title: '提肛训练', message: '进行一组训练。', nextTriggerAt: now },
        { id: 'eye_rest', enabled: false, intervalMinutes: 30, snoozeMinutes: 5, title: '远眺护眼', message: '看看远处。', nextTriggerAt: now },
        { id: 'posture', enabled: false, intervalMinutes: 40, snoozeMinutes: 10, title: '坐姿调整', message: '调整坐姿。', nextTriggerAt: now },
      ],
    }))
  })
  await page.reload()

  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看健康提醒' })).toBeVisible()
  await page.waitForTimeout(320)
  await page.screenshot({ path: 'test-results/reminder-card-stage5.png', omitBackground: true })
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('petal-toolbox.reminder-logs') ?? '[]').length)).toBe(1)
})

test('Escape closes the panel without reopening petals', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.keyboard.press('Escape')
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-close', 'close')
})
