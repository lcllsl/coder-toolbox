import { expect, test, type Page } from '@playwright/test'

async function expectUnifiedModal(page: Page) {
  const backdrop = page.locator('.ui-modal-backdrop').last()
  await expect(backdrop).toBeVisible()
  const surface = backdrop.locator('.ui-modal-surface')
  await expect(surface).toBeVisible()
  await expect(surface).toHaveCSS('opacity', '1')
  const style = await backdrop.evaluate((element) => {
    const computed = getComputedStyle(element)
    return { backgroundColor: computed.backgroundColor, backdropFilter: computed.backdropFilter, opacity: computed.opacity }
  })
  expect(style).toMatchObject({ backgroundColor: 'rgba(10, 14, 22, 0.4)', opacity: '1' })
  expect(style.backdropFilter).toContain('blur(6px)')
}

test('orb preview exposes exactly five categories', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb&placement=bottom-right')
  await page.getByRole('button', { name: '展开冒泡' }).click()
  await expect(page.locator('.petal')).toHaveCount(5)
  await expect(page.locator('.petal-position')).toHaveCount(5)
  for (const label of ['AI 办公', '剪贴板', '文件中心', '效率工具', '健康助手']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible()
  }
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
  await expect(page.getByRole('button', { name: '隐藏功能面板' })).toBeVisible()
})

test('orb hides and restores the active panel without reopening category petals', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  const orb = page.locator('.orb-button')

  await orb.click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'AI 办公' }).click()
  await expect(page.getByRole('button', { name: '隐藏功能面板' })).toBeVisible()
  await expect(page.locator('.orb-stage')).toHaveClass(/(?:^|\s)state-panel-open(?:\s|$)/)

  await orb.click()
  await expect(page.getByRole('button', { name: '恢复功能面板' })).toBeVisible()
  await expect(page.locator('.petal')).toHaveCount(0)

  await orb.click()
  await expect(page.getByRole('button', { name: '隐藏功能面板' })).toBeVisible()
  await expect(page.locator('.petal')).toHaveCount(0)
})

test('panel preview mounts its lightweight shell', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await expect(page.getByRole('heading', { name: '效率工具', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/panel-stage3.png', omitBackground: true })
})

test('panel hide control preserves the current view for restoration', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 760 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'ai-office' } }))
  })
  await page.getByRole('button', { name: /智能表格/ }).click()
  const input = page.getByPlaceholder('把聊天记录、名单、事项或其他文字粘贴到这里')
  await input.fill('保留当前面板内容')

  await page.getByRole('button', { name: '隐藏面板' }).click()
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-hidden', 'true')
  await expect(input).toHaveValue('保留当前面板内容')
})

test('panel remains visible and keeps input when its window loses focus', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'clipboard' } }))
  })
  const search = page.getByRole('searchbox', { name: '搜索剪贴板' })
  await search.fill('跨窗口复制粘贴')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-hidden', 'false')
  await expect(search).toHaveValue('跨窗口复制粘贴')
})

test('AI office turns a local spreadsheet into an interactive report', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 760 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'ai-office' } }))
  })
  await expect(page.getByRole('heading', { name: 'AI 办公', exact: true })).toBeVisible()
  await expect(page.getByText('Excel 智能图表', { exact: true })).toBeVisible()
  await expect(page.getByText('已上线', { exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: /Excel 智能图表/ }).click()
  await expect(page.getByRole('heading', { name: '已保存的图表' })).toBeVisible()
  await page.getByRole('button', { name: '新建图表', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '演示销售数据.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('月份,区域,部门,销售额,成本,利润,利润率\n2026-01,华东,销售,120000,80000,40000,33%\n2026-02,华东,销售,150000,92000,58000,39%\n2026-03,华南,渠道,98000,65000,33000,34%\n2026-04,华南,渠道,132000,87000,45000,34%\n2026-05,华北,直营,166000,101000,65000,39%\n2026-06,华北,直营,180000,108000,72000,40%'),
  })
  await expect(page.getByRole('heading', { name: '字段识别' })).toBeVisible()
  await expect(page.getByText('已识别 7 个字段')).toBeVisible()
  await page.getByLabel('销售额字段名称').fill('营业收入')
  await page.getByLabel('销售额字段名称').press('Tab')
  await page.getByLabel('部门字段名称').fill('月份')
  await page.getByLabel('部门字段名称').press('Tab')
  await expect(page.getByRole('alert')).toHaveText('字段名称不能重复')
  await expect(page.getByLabel('部门字段名称')).toHaveValue('部门')
  await page.getByRole('button', { name: '使用本地方案生成' }).click()
  await expect(page.getByText('尚未配置 AI 服务，已使用本地图表推荐。')).toBeVisible()
  await expect(page.getByText('营业收入合计')).toBeVisible()
  await expect.poll(() => page.locator('.chart-card').count()).toBeGreaterThanOrEqual(3)
  await expect.poll(() => page.locator('canvas').count()).toBeGreaterThanOrEqual(3)
  await expect.poll(() => page.locator('.panel-view').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  await page.getByRole('button', { name: '删除统计卡片 营业收入合计' }).click()
  await expect(page.locator('.kpi-grid').getByText('营业收入合计')).toHaveCount(0)
  await page.getByRole('button', { name: /撤销删除“营业收入合计”/ }).click()
  await expect(page.getByText('营业收入合计')).toBeVisible()
  await page.waitForTimeout(600)
  await expect(page.getByLabel('报告标题')).toBeVisible()
  await page.screenshot({ path: 'test-results/ai-office-preview.png' })
  await page.getByRole('button', { name: '保存图表' }).click()
  await expect(page.getByRole('heading', { name: '命名并保存图表' })).toBeVisible()
  await expectUnifiedModal(page)
  await page.screenshot({ path: 'test-results/modal-unified-preview.png' })
  await page.getByLabel('图表名称').fill('演示销售看板')
  await page.locator('.name-dialog').getByRole('button', { name: '保存图表' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('petal-toolbox.smart-chart-projects'))).not.toBeNull()
  await page.getByRole('button', { name: '返回图表列表' }).click()
  await expect(page.getByRole('heading', { name: '已保存的图表' })).toBeVisible()
  await expect(page.getByText('演示销售看板', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重命名图表 演示销售看板' }).click()
  await expect(page.getByRole('heading', { name: '重命名图表' })).toBeVisible()
  await page.getByLabel('图表名称').fill('华东销售看板')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page.getByText('华东销售看板', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /华东销售看板.*演示销售数据/ }).click()
  await expect(page.getByText(/已保存图表 · Sheet1 · 6 行数据/)).toBeVisible()
  await expect(page.getByLabel('营业收入字段名称')).toBeVisible()
})

test('AI office smart table exposes guarded text intake and templates', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 760 })
  await page.goto('/?window=panel')
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'ai-office' } }))
  })
  await page.getByRole('button', { name: /智能表格/ }).click()
  await expect(page.getByRole('heading', { name: '智能表格', exact: true })).toBeVisible()
  await page.getByPlaceholder('把聊天记录、名单、事项或其他文字粘贴到这里').fill('张三负责准备周报，下周五前完成。')
  await page.getByRole('button', { name: '工作事项' }).click()
  await expect(page.getByText('隐私保护模式', { exact: true })).toBeVisible()
  await expect(page.getByText(/AI 服务尚未配置/)).toBeVisible()
  await expect(page.getByRole('button', { name: '识别表格结构' })).toBeDisabled()
  await page.screenshot({ path: 'test-results/smart-table-input.png' })
})

test('quick actions copy values and manage safe web links', async ({ page, context }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  })

  const navigation = page.getByRole('navigation', { name: '效率工具' })
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

  await navigation.getByRole('button', { name: '常用', exact: true }).click()
  await expect(page.getByText('当前日期', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/quick-actions-stage8.png', omitBackground: true })
})

test('vault preview covers initialization, CRUD, search, reveal, locking and permanent reset', async ({ page, context }) => {
  await page.setViewportSize({ width: 560, height: 540 })
  await page.goto('/?window=panel')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  })

  const quickNavigation = page.getByRole('navigation', { name: '效率工具' })
  await quickNavigation.getByRole('button', { name: '加密凭据夹' }).click()
  await expect(page.getByRole('heading', { name: '设置主密码' })).toBeVisible()
  const setupInputs = page.locator('.setup-gate input')
  await setupInputs.nth(0).fill('preview-master-password')
  await setupInputs.nth(1).fill('preview-master-password')
  await page.getByRole('button', { name: '创建凭据夹' }).click()
  await expect(page.getByText('还没有凭据', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新增凭据' }).first().click()
  const dialog = page.getByRole('dialog', { name: '新增凭据' })
  await expectUnifiedModal(page)
  await dialog.getByLabel('系统名称 *').fill('OA 管理后台')
  await dialog.getByLabel('用户名').fill('admin001')
  await dialog.getByLabel('密码 *').fill('fixed-vault-secret')
  await dialog.getByLabel('备注').fill('生产环境')
  await dialog.getByRole('button', { name: '保存凭据' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('OA 管理后台', { exact: true })).toBeVisible()

  const search = page.getByRole('searchbox', { name: '搜索凭据' })
  await search.fill('admin001')
  await expect(page.locator('.credential-card')).toHaveCount(1)
  await search.fill('不存在')
  await expect(page.getByText('没有匹配的凭据')).toBeVisible()
  await search.fill('')
  await page.waitForTimeout(3_200)
  await page.screenshot({ path: 'test-results/vault-preview.png', omitBackground: true })

  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(page.getByText('fixed-vault-secret', { exact: true })).toBeVisible()
  await page.waitForTimeout(10_100)
  await expect(page.getByText('fixed-vault-secret', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '编辑凭据' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑凭据' })
  await editDialog.getByLabel('系统名称 *').fill('OA 生产后台')
  await editDialog.getByRole('button', { name: '保存凭据' }).click()
  await expect(editDialog).toHaveCount(0)
  await expect(page.getByText('OA 生产后台', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '复制密码' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('fixed-vault-secret')
  await page.getByRole('button', { name: '锁定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '加密凭据夹' })).toBeVisible()

  const unlockInput = page.locator('#vault-master-password')
  await unlockInput.fill('unfinished-master-password')
  await page.getByRole('button', { name: '显示主密码' }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('vault:locked')))
  await expect(unlockInput).toHaveValue('')
  await expect(unlockInput).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: '忘记主密码？' }).click()
  await page.getByRole('alertdialog', { name: '忘记主密码？' }).getByRole('button', { name: '继续' }).click()
  const forgotFinalDialog = page.getByRole('alertdialog', { name: '最后确认删除？' })
  await expect(forgotFinalDialog).toBeVisible()
  await expect(forgotFinalDialog.getByRole('button', { name: '取消' })).toBeFocused()
  await forgotFinalDialog.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '忘记主密码？' }).click()
  await page.getByRole('alertdialog', { name: '忘记主密码？' }).getByRole('button', { name: '继续' }).dblclick()
  await expect(forgotFinalDialog).toBeVisible()
  await forgotFinalDialog.getByRole('button', { name: '取消' }).click()
  await unlockInput.fill('wrong-password')
  await unlockInput.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('主密码错误')
  await unlockInput.fill('preview-master-password')
  await unlockInput.press('Enter')
  await expect(page.getByText('OA 生产后台', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '删除凭据' }).click()
  await page.getByRole('alertdialog', { name: '删除该凭据？' }).getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('还没有凭据', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '新增凭据' }).first().click()
  const retainedDialog = page.getByRole('dialog', { name: '新增凭据' })
  await retainedDialog.getByLabel('系统名称 *').fill('清理保留测试')
  await retainedDialog.getByLabel('用户名').fill('retained-user')
  await retainedDialog.getByLabel('密码 *').fill('retained-secret')
  await retainedDialog.getByRole('button', { name: '保存凭据' }).click()
  await expect(page.getByText('清理保留测试', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '数据与应用' }).click()
  const includeVault = page.getByRole('checkbox', { name: /加密凭据夹/ })
  await expect(includeVault).not.toBeChecked()
  await page.getByRole('button', { name: /清除数据并保留设置/ }).click()
  await page.getByRole('alertdialog', { name: '清除全部本地数据？' }).getByRole('button', { name: '确认清除' }).click()
  await expect(page.getByText('本地数据已清除，设置已保留')).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'quick-actions' } }))
  })
  await page.getByRole('navigation', { name: '效率工具' }).getByRole('button', { name: '加密凭据夹' }).click()
  await expect(page.getByText('清理保留测试', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '数据与应用' }).click()
  await expect(page.getByRole('checkbox', { name: /加密凭据夹/ })).not.toBeChecked()
  await page.getByRole('button', { name: /清除数据并重置设置/ }).click()
  await page.getByRole('alertdialog', { name: '清除全部本地数据？' }).getByRole('button', { name: '确认清除' }).click()
  await expect(page.getByText('本地数据已清除，设置已重置')).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'quick-actions' } }))
  })
  await page.getByRole('navigation', { name: '效率工具' }).getByRole('button', { name: '加密凭据夹' }).click()
  await expect(page.getByText('清理保留测试', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: '数据与应用' }).click()
  await page.getByRole('checkbox', { name: /加密凭据夹/ }).check()
  await page.getByRole('button', { name: /清除数据并保留设置/ }).click()
  await page.getByRole('alertdialog', { name: '清除全部本地数据？' }).getByRole('button', { name: '确认清除' }).click()
  const permanentDialog = page.getByRole('alertdialog', { name: '永久删除加密凭据夹？' })
  await expect(permanentDialog).toBeVisible()
  await expect(permanentDialog.getByRole('button', { name: '取消' })).toBeFocused()
  await permanentDialog.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: /清除数据并保留设置/ }).click()
  await page.getByRole('alertdialog', { name: '清除全部本地数据？' }).getByRole('button', { name: '确认清除' }).dblclick()
  await expect(permanentDialog).toBeVisible()
  await permanentDialog.getByRole('button', { name: '永久删除' }).click()
  await expect(page.getByText(/加密凭据夹已永久删除/)).toBeVisible()

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('panel:navigate', { detail: { category: 'quick-actions' } }))
  })
  await page.getByRole('navigation', { name: '效率工具' }).getByRole('button', { name: '加密凭据夹' }).click()
  await expect(page.getByRole('heading', { name: '设置主密码' })).toBeVisible()
})

test('panel routes all five categories and supports common actions', async ({ page }) => {
  await page.goto('/?window=panel')

  const categories = [
    ['ai-office', 'AI 办公'],
    ['clipboard', '剪贴板'],
    ['files', '文件中心'],
    ['quick-actions', '效率工具'],
    ['health', '健康助手'],
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
  await settingsNavigation.getByRole('button', { name: 'AI 服务' }).click()
  await expect(page.getByRole('heading', { name: 'DeepSeek 服务' })).toBeVisible()
  await expect(page.locator('.ai-service-settings input[type="password"]')).toBeVisible()
  await expect(page.getByLabel('模型')).toHaveValue('deepseek-v4-flash')
  await expect(page.getByRole('button', { name: '测试连接' })).toBeDisabled()
  await expect(page.getByText(/Excel 文件本身不会上传/)).toBeVisible()
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
  await expectUnifiedModal(page)
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

  await expect(page.locator('.panel-stage')).toHaveAttribute('data-view', 'quick-actions')
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
  await page.getByRole('button', { name: '转换', exact: true }).click()
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

  await expect(page.locator('.reminder-row')).toHaveCount(4)
  await expect(page.getByRole('checkbox', { name: '起立活动提醒' })).toBeChecked()
  await expect(page.getByText('提肛训练', { exact: true })).toHaveCount(0)
  await expect(page.locator('.reminder-field').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /立即调试.+提醒/ })).toHaveCount(4)
  await page.screenshot({ path: 'test-results/health-overview.png', omitBackground: true })
  await page.getByRole('button', { name: '新增提醒' }).click()
  await page.getByLabel('项目标题').fill('伸展肩颈')
  await page.getByLabel('项目介绍').fill('活动肩膀和颈部，放松一下。')
  await page.getByLabel('新增提醒间隔时间').fill('25')
  await page.getByRole('button', { name: '新增项目' }).click()
  await expect(page.getByText('提醒项目已新增')).toBeVisible()
  await expect(page.locator('.reminder-row')).toHaveCount(5)
  await expect(page.getByRole('checkbox', { name: '伸展肩颈提醒' })).toBeChecked()
  await expect(page.getByLabel('伸展肩颈间隔时间')).toHaveValue('25')
  await page.getByRole('button', { name: '删除坐姿调整提醒' }).click()
  await expect(page.getByRole('alertdialog', { name: '删除提醒项目？' })).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.reminder-row')).toHaveCount(4)
  await expect(page.getByText('坐姿调整', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/health-stage5.png', omitBackground: true })
  await page.locator('html').evaluate((element) => { element.dataset.theme = 'dark' })
  await page.locator('.health-policies').scrollIntoViewIfNeeded()
  await expect(page.getByText('勿扰时间', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/health-dark-stage5.png', omitBackground: true })
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
  await expectUnifiedModal(page)
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

  const filesNavigation = page.getByRole('navigation', { name: '文件中心工具' })
  await filesNavigation.getByRole('button', { name: '路径工具' }).click()
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

test('health reminder countdown auto-completes after thirty seconds', async ({ page }) => {
  await page.clock.install()
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.getByRole('button', { name: '展开冒泡' }).waitFor()
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('health:debug-trigger', { detail: { reminderId: 'water' } }))
  })

  await expect(page.getByRole('alert', { name: '喝水提醒' })).toBeVisible()
  const durationSeconds = await page.locator('.countdown-progress').evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).animationDuration),
  )
  expect(durationSeconds).toBeGreaterThan(29)
  expect(durationSeconds).toBeLessThanOrEqual(30)
  await page.getByRole('alert', { name: '喝水提醒' }).screenshot({ path: 'test-results/health-reminder-countdown.png' })
  await page.clock.fastForward(30_000)
  await expect(page.getByRole('alert', { name: '喝水提醒' })).toHaveCount(0)
  await expect.poll(async () => page.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem('petal-toolbox.reminder-logs') ?? '[]') as { action: string }[]
    return logs.at(-1)?.action
  })).toBe('completed')
})

test('simultaneous health reminders count down and complete in the background', async ({ page }) => {
  await page.clock.install()
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.evaluate(() => {
    const due = new Date(Date.now() - 1_000).toISOString()
    localStorage.setItem('petal-toolbox.health-settings', JSON.stringify({
      silentMode: false,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      reminders: [
        { id: 'stand', enabled: true, intervalMinutes: 50, snoozeMinutes: 10, title: '起立活动', message: '站起来走动一下。', nextTriggerAt: due },
        { id: 'eye_rest', enabled: true, intervalMinutes: 30, snoozeMinutes: 5, title: '远眺护眼', message: '看看远处。', nextTriggerAt: due },
      ],
    }))
  })
  await page.reload()

  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toBeVisible()
  await expect(page.getByText('还有 2 项提醒')).toBeVisible()
  await expect(page.getByRole('alert', { name: '远眺护眼提醒' })).toHaveCount(0)
  await page.clock.fastForward(30_000)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem('petal-toolbox.reminder-logs') ?? '[]') as { action: string }[]
    return logs.filter((item) => item.action === 'completed').length
  })).toBe(2)
})

test('health reminders missed while the app was unavailable are discarded on startup', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.evaluate(() => {
    const missed = new Date(Date.now() - 31_000).toISOString()
    localStorage.setItem('petal-toolbox.health-settings', JSON.stringify({
      silentMode: false,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      reminders: [
        { id: 'stand', enabled: true, intervalMinutes: 50, snoozeMinutes: 10, title: '起立活动', message: '站起来走动一下。', nextTriggerAt: missed },
      ],
    }))
  })
  await page.reload()
  await page.getByRole('button', { name: '展开冒泡' }).waitFor()

  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('petal-toolbox.health-settings') ?? '{}') as {
      reminders?: { nextTriggerAt: string }[]
    }
    return new Date(settings.reminders?.[0]?.nextTriggerAt ?? 0).getTime() > Date.now()
  })).toBe(true)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('petal-toolbox.reminder-logs') ?? '[]').length)).toBe(0)
})

test('a due health reminder opens one card and completion updates statistics', async ({ page }) => {
  await page.setViewportSize({ width: 340, height: 340 })
  await page.goto('/?window=orb')
  await page.evaluate(() => {
    const now = new Date(Date.now() - 1_000).toISOString()
    localStorage.setItem('petal-toolbox.health-settings', JSON.stringify({
      silentMode: false,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      reminders: [
        { id: 'stand', enabled: true, intervalMinutes: 50, snoozeMinutes: 10, title: '起立活动', message: '站起来走动一下，让身体重新舒展。', nextTriggerAt: now },
        { id: 'water', enabled: false, intervalMinutes: 45, snoozeMinutes: 10, title: '喝水', message: '补充一些水分。', nextTriggerAt: now },
        { id: 'eye_rest', enabled: false, intervalMinutes: 30, snoozeMinutes: 5, title: '远眺护眼', message: '看看远处。', nextTriggerAt: now },
        { id: 'posture', enabled: false, intervalMinutes: 40, snoozeMinutes: 10, title: '坐姿调整', message: '调整坐姿。', nextTriggerAt: now },
      ],
    }))
  })
  await page.reload()

  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toBeVisible()
  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toHaveCSS('backdrop-filter', 'none')
  await expect(page.getByRole('button', { name: '查看健康提醒' })).toBeVisible()
  await page.waitForTimeout(320)
  await page.screenshot({ path: 'test-results/reminder-card-stage5.png', omitBackground: true })
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByRole('alert', { name: '起立活动提醒' })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('petal-toolbox.reminder-logs') ?? '[]').length)).toBe(1)
})

test('Escape hides the panel without discarding its current view', async ({ page }) => {
  await page.goto('/?window=panel')
  await page.keyboard.press('Escape')
  await expect(page.locator('.panel-stage')).toHaveAttribute('data-preview-hidden', 'true')
})
