import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SRC_DIR = new URL('../src/', import.meta.url).pathname

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(fullPath))
    else if (/\.(css|tsx?)$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

test('global base CSS disables default and :focus-visible outlines and tap highlights', () => {
  const indexCss = readFileSync(path.join(SRC_DIR, 'index.css'), 'utf8')
  assert.match(indexCss, /@layer base\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent;/)
  assert.match(indexCss, /@layer base\s*\{[\s\S]*?\*:focus,\s*\*:focus-visible\s*\{\s*outline:\s*none;\s*\}/)
})

test('application CSS and TSX files do not declare :focus-visible outlines', () => {
  for (const file of walk(SRC_DIR)) {
    const content = readFileSync(file, 'utf8')
    const rel = path.relative(SRC_DIR, file)

    if (file.endsWith('.css')) {
      const blocks = [...content.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)]
      for (const [, selector, body] of blocks) {
        const isGlobalReset = rel === 'index.css' && selector.trim() === '*:focus,\n  *:focus-visible' && /^\s*outline:\s*none;\s*$/.test(body)
        if (isGlobalReset) continue
        assert.equal(
          /\boutline(?:-color|-style|-width|-offset)?\s*:/.test(body),
          false,
          `${rel} still defines focus-visible outline in "${selector.trim()}"`,
        )
      }
    } else {
      assert.equal(
        /\bfocus-visible:outline(?:-\S+)?\b/.test(content),
        false,
        `${rel} still uses Tailwind focus-visible:outline utility`,
      )
    }
  }
})

test('input focus highlights via border/box-shadow remain intact', () => {
  const indexCss = readFileSync(path.join(SRC_DIR, 'index.css'), 'utf8')
  const profileCss = readFileSync(path.join(SRC_DIR, 'styles', 'profile.css'), 'utf8')
  const adminSettingsCss = readFileSync(path.join(SRC_DIR, 'styles', 'admin-settings.css'), 'utf8')

  assert.match(indexCss, /\.mail-search:focus-within\s*\{[^}]*border-color:/)
  assert.match(profileCss, /\.profile-input:focus\s*\{[^}]*border-color:[^}]*box-shadow:/)
  assert.match(adminSettingsCss, /\.admin-panel-settings-group input:not\(\[type='checkbox'\]\):focus[\s\S]*?box-shadow:/)
})
