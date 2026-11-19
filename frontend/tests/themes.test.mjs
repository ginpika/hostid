import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/themes/index.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const api = {}
new Function('exports', javascript)(api)

test('only kept light themes exist with Space Gray as default and Default Blue named properly', () => {
  assert.deepEqual(
    api.themes.map(theme => theme.id),
    ['business', 'light', 'sakura', 'lavender', 'classic']
  )
  assert.equal(api.getDefaultTheme().id, 'business')
  assert.equal(api.getDefaultTheme().name, '深空灰')
  assert.equal(api.getDefaultTheme().nameEn, 'Space Gray')

  const defaultBlue = api.getThemeById('light')
  assert.equal(defaultBlue.name, '默认蓝')
  assert.equal(defaultBlue.nameEn, 'Default Blue')
  assert.equal(api.getThemeLayout(defaultBlue), 'workspace')

  for (const theme of api.themes) {
    assert.equal(theme.colorScheme, 'light', `${theme.id} should be a light theme`)
  }
})

test('classic theme preserves the original layout and base light palette', () => {
  const classic = api.getThemeById('classic')
  assert.equal(api.getThemeLayout(classic), 'classic')
  assert.deepEqual(classic.colors, {
    bg: { primary: '#f9fafb', secondary: '#ffffff', tertiary: '#f3f4f6', hover: '#f3f4f6' },
    text: { primary: '#111827', secondary: '#374151', tertiary: '#626b78', quaternary: '#626b78', muted: '#626b78' },
    border: { primary: '#e5e7eb', secondary: '#d1d5db' },
    accent: { primary: '#0ea5e9', secondary: '#0284c7', muted: 'rgba(14, 165, 233, 0.1)', text: '#ffffff' },
    code: { bg: '#f3f4f6', text: '#1f2937' }, pre: { bg: '#1e293b', text: '#e2e8f0' }
  })
  assert.equal(api.getThemeLayout(api.getThemeById('business')), 'workspace')
})

test('classic secondary text remains readable on toolbar and message surfaces', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const { colors } = api.getThemeById('classic')
  for (const foreground of Object.values(colors.text)) {
    for (const background of Object.values(colors.bg)) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `classic: ${foreground} on ${background}`)
    }
  }
})

test('removed dark themes, forest, legacy system mode, and unknown presets resolve to Space Gray', () => {
  for (const removed of ['dark', 'classic-dark', 'starry-night', 'ocean', 'forest', 'system', 'removed-theme', '']) {
    assert.equal(api.getThemeById(removed), undefined, `${removed} should not be a registered preset`)
    assert.equal(api.resolveTheme(removed).id, 'business', `${removed} should resolve to Space Gray`)
  }
  assert.equal(api.resolveTheme('sunset').id, 'business')
  assert.equal(api.resolveTheme('light').id, 'light')
  assert.equal(api.resolveTheme('sakura').id, 'sakura')
  assert.equal(api.resolveTheme('lavender').id, 'lavender')
  assert.equal(api.resolveTheme('classic').id, 'classic')
})

test('theme classes replace layout markers without mixing designs or system dark markers', () => {
  const classic = api.getThemeClasses(api.resolveTheme('classic'))
  const modern = api.getThemeClasses(api.resolveTheme('business'))
  assert.deepEqual(classic, ['theme-classic', 'design-classic'])
  assert.deepEqual(modern, ['theme-business', 'design-workspace'])
  assert.equal(new Set(api.themes.map(theme => theme.id)).size, api.themes.length)
  assert.ok(api.themes.every(theme => theme.description && theme.descriptionEn))
})

test('index.css :root defaults match the Space Gray default theme', () => {
  const indexCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  const { colors } = api.getDefaultTheme()
  assert.match(indexCss, new RegExp(`--color-bg-primary:\\s*${colors.bg.primary};`))
  assert.match(indexCss, new RegExp(`--color-accent-primary:\\s*${colors.accent.primary};`))
  assert.match(indexCss, new RegExp(`--color-text-primary:\\s*${colors.text.primary};`))
})
