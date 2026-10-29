import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/themes/index.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const api = {}
new Function('exports', javascript)(api)

test('classic themes preserve the original layout and base palette', () => {
  const light = api.getThemeById('classic')
  const dark = api.getThemeById('classic-dark')
  assert.equal(api.getThemeLayout(light), 'classic')
  assert.equal(api.getThemeLayout(dark), 'classic')
  assert.deepEqual(light.colors, {
    bg: { primary: '#f9fafb', secondary: '#ffffff', tertiary: '#f3f4f6', hover: '#f3f4f6' },
    text: { primary: '#111827', secondary: '#374151', tertiary: '#626b78', quaternary: '#626b78', muted: '#626b78' },
    border: { primary: '#e5e7eb', secondary: '#d1d5db' },
    accent: { primary: '#0ea5e9', secondary: '#0284c7', muted: 'rgba(14, 165, 233, 0.1)', text: '#ffffff' },
    code: { bg: '#f3f4f6', text: '#1f2937' }, pre: { bg: '#1e293b', text: '#e2e8f0' }
  })
  assert.equal(dark.colors.bg.primary, '#0a0a0a')
  assert.equal(dark.colors.accent.primary, '#00d98a')
  assert.equal(api.getThemeLayout(api.getThemeById('light')), 'workspace')
  assert.equal(api.getThemeLayout(api.getThemeById('dark')), 'workspace')
})

test('classic secondary text remains readable on toolbar and message surfaces', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  for (const id of ['classic', 'classic-dark']) {
    const { colors } = api.getThemeById(id)
    for (const foreground of Object.values(colors.text)) {
      for (const background of Object.values(colors.bg)) {
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
        assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${id}: ${foreground} on ${background}`)
      }
    }
  }
})

test('classic native controls and verification widgets use the selected appearance', () => {
  assert.equal(api.resolveTheme('classic', 'dark').colorScheme, 'light')
  assert.equal(api.resolveTheme('classic-dark', 'light').colorScheme, 'dark')
  assert.equal(api.resolveTheme('system', 'dark').colorScheme, 'dark')
  assert.equal(api.resolveTheme('system', 'light').colorScheme, 'light')
})

test('restored classic choices remain fixed while system mode follows the system appearance', () => {
  assert.equal(api.resolveTheme('classic', 'dark').id, 'classic')
  assert.equal(api.resolveTheme('classic-dark', 'light').id, 'classic-dark')
  assert.equal(api.resolveTheme('system', 'light').id, 'light')
  assert.equal(api.resolveTheme('system', 'dark').id, 'dark')
  assert.equal(api.resolveTheme('removed-theme', 'dark').id, api.getDefaultTheme().id)
})

test('theme classes replace layout and system markers without mixing designs', () => {
  const classic = api.getThemeClasses(api.resolveTheme('classic', 'dark'), 'classic', 'dark')
  const modern = api.getThemeClasses(api.resolveTheme('system', 'dark'), 'system', 'dark')
  assert.deepEqual(classic, ['theme-classic', 'design-classic'])
  assert.deepEqual(modern, ['theme-dark', 'design-workspace', 'system-dark'])
  assert.equal(new Set(api.themes.map(theme => theme.id)).size, api.themes.length)
  assert.ok(api.themes.filter(theme => api.getThemeLayout(theme) === 'classic').every(theme => theme.description && theme.descriptionEn))
})
