import { test, expect } from '@playwright/test'

/**
 * E2E tests for i18n language switcher on the login page.
 * Verifies language selection, cookie persistence, and translation rendering.
 */

test.describe('i18n Language Switcher', () => {
  test('login page renders English by default', async ({ page }) => {
    // Clear any existing language cookie
    await page.context().clearCookies()
    await page.goto('/login')

    // Verify English text
    await expect(page.locator('text=Sign in to continue')).toBeVisible()
    await expect(page.locator('text=Username')).toBeVisible()
    await expect(page.locator('text=Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test('language switcher shows all 10 languages', async ({ page }) => {
    await page.goto('/login')

    const select = page.getByLabel('Language')
    await expect(select).toBeVisible()

    const options = await select.locator('option').allTextContents()
    expect(options).toHaveLength(10)
    expect(options).toContain('English')
    expect(options).toContain('中文')
    expect(options).toContain('日本語')
    expect(options).toContain('한국어')
    expect(options).toContain('Español')
    expect(options).toContain('Français')
    expect(options).toContain('Deutsch')
    expect(options).toContain('Português')
    expect(options).toContain('Русский')
    expect(options).toContain('العربية')
  })

  test('switching to Chinese renders Chinese translations', async ({ page }) => {
    await page.goto('/login')

    const select = page.getByLabel('Language')
    await select.selectOption('zh')

    // Wait for text to update
    await expect(page.locator('text=登录以继续')).toBeVisible()
    await expect(page.locator('text=用户名')).toBeVisible()
    await expect(page.locator('text=密码')).toBeVisible()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  })

  test('language preference persists across page reload', async ({ page }) => {
    await page.goto('/login')

    // Switch to Chinese
    const select = page.getByLabel('Language')
    await select.selectOption('zh')
    await expect(page.locator('text=登录以继续')).toBeVisible()

    // Reload page
    await page.reload()

    // Verify Chinese persists
    await expect(page.locator('text=登录以继续')).toBeVisible()
    await expect(page.locator('text=用户名')).toBeVisible()

    // Verify dropdown still shows Chinese selected
    const selectedValue = await page.getByLabel('Language').inputValue()
    expect(selectedValue).toBe('zh')
  })

  test('switching to Spanish renders Spanish translations', async ({ page }) => {
    await page.goto('/login')

    const select = page.getByLabel('Language')
    await select.selectOption('es')

    await expect(page.locator('text=Iniciar sesión para continuar')).toBeVisible()
    await expect(page.locator('text=Nombre de usuario')).toBeVisible()
    await expect(page.locator('text=Contraseña')).toBeVisible()
  })

  test('switching back to English restores English text', async ({ page }) => {
    await page.goto('/login')

    // Switch to Chinese first
    const select = page.getByLabel('Language')
    await select.selectOption('zh')
    await expect(page.locator('text=登录以继续')).toBeVisible()

    // Switch back to English
    await select.selectOption('en')
    await expect(page.locator('text=Sign in to continue')).toBeVisible()
    await expect(page.locator('text=Username')).toBeVisible()
  })
})
