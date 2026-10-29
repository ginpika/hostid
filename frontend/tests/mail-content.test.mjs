import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'

const source = readFileSync(new URL('../src/lib/mailContent.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const api = {}
new Function('exports', javascript)(api)
const format = api.getMailContentFormat

test('HTML documents keep code examples literal instead of switching to Markdown', () => {
  for (const prefix of ['<!doctype html>', '<!-- mail -->', '<?xml version="1.0"?>', '\uFEFF']) {
    assert.equal(format(`${prefix}\n<html><body><pre>\n# Example\n\`\`\`js\nalert(1)\n\`\`\`\n[^1]: Note\n</pre></body></html>`), 'html')
  }
})

test('HTML fragments keep their layout even when their text looks like Markdown', () => {
  assert.equal(format('<div\n class="message">\n# Literal title\n</div>'), 'html')
  assert.equal(format('<style>\n/* example\n# heading\n*/\nbody { color:red }</style><p>Message</p>'), 'html')
  assert.equal(format('Hello <strong>reader</strong>'), 'html')
})

test('Markdown front matter, headings and code blocks can still contain inline HTML', () => {
  assert.equal(format('+++\ntitle = "Title"\n+++\n# Heading\nWith <strong>HTML</strong>'), 'markdown')
  assert.equal(format('---\ntitle: Title\n---\nA <span>fragment</span>'), 'markdown')
  assert.equal(format('# Heading\n\n<span>Inline HTML</span>'), 'markdown')
  assert.equal(format('```html\n<!doctype html><html><body>Example</body></html>\n```'), 'markdown')
})

test('Markdown autolinks and email addresses are not mistaken for HTML tags', () => {
  for (const link of ['<https://example.com/path>', '<mailto:reader@example.com>', '<reader@example.com>']) {
    assert.equal(format(link), 'markdown')
  }
})

test('plain prose and ordinary Markdown retain their existing rendering modes', () => {
  for (const plain of ['', '你好\n第二行', '2 < 3 and 5 > 4', 'User <reader@example>']) {
    assert.equal(format(plain), 'text')
  }
  for (const markdown of ['**Bold** text', '- First\n- Second', '[Guide](https://example.com)', '> Quoted text']) {
    assert.equal(format(markdown), 'markdown')
  }
})
