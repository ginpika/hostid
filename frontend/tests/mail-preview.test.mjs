import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from '../node_modules/typescript/lib/typescript.js'
import { decodeHTML } from '../node_modules/entities/lib/esm/index.js'

const source = readFileSync(new URL('../src/lib/mailPreview.ts', import.meta.url), 'utf8')
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const text = value => ({ nodeType: 3, nodeName: '#text', nodeValue: value, childNodes: [] })
const element = (name, children = [], attributes = {}) => ({ nodeType: 1, nodeName: name, nodeValue: null, childNodes: children, getAttribute: key => attributes[key] ?? null })
const fragment = children => ({ nodeType: 11, nodeName: '#document-fragment', nodeValue: null, childNodes: children })

function previewFunctions(document = undefined) {
  const exports = {}
  new Function('exports', 'document', javascript)(exports, document)
  return exports
}
const { visiblePreviewText, normalizePreviewText } = previewFunctions()

test('message metadata and hidden preheaders never enter the list preview', () => {
  const fixture = fragment([
    element('HEAD', [element('TITLE', [text('DeepSeek Verification Code 96')]), element('STYLE', [text('body { color: red; }')])]),
    element('DIV', [text('Hidden verification teaser')], { style: 'display: none !important; max-height: 0;' }),
    element('SPAN', [text('Invisible filler')], { hidden: '' }),
    element('DIV', [text('Screen-reader metadata')], { 'aria-hidden': 'true' }),
    element('DIV', [text('Outlook preheader')], { style: 'mso-hide:all;' }),
    element('DIV', [text('Transparent filler')], { style: 'opacity: 0.0;' }),
    element('P', [text('你好，用户')]), element('P', [text('你的邮箱验证码为：123456')]),
    element('SCRIPT', [text('tracking()')])
  ])
  assert.equal(normalizePreviewText(visiblePreviewText(fixture)), '你好，用户 你的邮箱验证码为：123456')
})

test('block boundaries separate paragraphs while inline emphasis remains attached', () => {
  const fixture = fragment([element('P', [text('Hello '), element('STRONG', [text('world')]), text('!')]), element('DIV', [text('Second paragraph')]), element('BR'), text('Last line')])
  assert.equal(normalizePreviewText(visiblePreviewText(fixture)), 'Hello world! Second paragraph Last line')
})

test('YAML and TOML metadata, heading markers and common Markdown stay out of previews', () => {
  const yaml = '---\ntitle: Internal title\nauthor: Root\n---\n# Hello **friend**\n\n- Read [the guide](https://example.com)\n> Then `reply`.\n'
  assert.equal(normalizePreviewText(yaml), 'Hello friend Read the guide Then reply.')
  assert.equal(normalizePreviewText('+++\ntitle = "Metadata"\n+++\n## A visible message'), 'A visible message')
  assert.equal(normalizePreviewText('Hello\n---\nWorld'), 'Hello World')
})

test('inert template parsing decodes numeric and named entities without creating live resources', () => {
  const created = []
  const document = { createElement(name) {
    created.push(name)
    assert.equal(name, 'template')
    return { content: fragment([]), set innerHTML(value) { this.content = fragment([text(decodeHTML(value))]) } }
  } }
  const { mailPreview } = previewFunctions(document)
  assert.equal(mailPreview('&#160;你好&#8212;世界 &hellip; &copy; &eacute; &amp;'), '你好—世界 … © é &')
  assert.equal(mailPreview('Literal < 5 &gt; 2'), 'Literal < 5 > 2')
  assert.deepEqual(created, ['template', 'template'])
})

test('preheader padding is removed and long previews truncate without splitting emoji', () => {
  assert.equal(normalizePreviewText('\uFEFF\u200B\u200C\u200D Hello\u2060\u200B'), 'Hello')
  assert.equal(normalizePreviewText('Family 👩‍👩‍👧‍👦'), 'Family 👩‍👩‍👧‍👦')
  assert.equal(normalizePreviewText('Hello 😀 world', 8), 'Hello 😀…')
})
