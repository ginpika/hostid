import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseEmailFile } from '../src/lib/parse-email-file'
import { getParsedEmailBody } from '../src/lib/parsed-email-body'
import { getMailContentFormat } from '../../frontend/src/lib/mailContent'

async function withEmailFile(content: Buffer, check: (filePath: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'hostid-email-parser-'))
  try {
    const filePath = join(directory, 'message.eml')
    await writeFile(filePath, content)
    await check(filePath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('EML import preserves raw 8bit parts until their declared charset is decoded', async () => {
  const message = Buffer.concat([
    Buffer.from([
      'From: sender@example.com', 'To: reader@example.com',
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=gb18030',
      'Content-Transfer-Encoding: 8bit', '', '<p>',
    ].join('\r\n')),
    // 中文邮件正文 encoded as GB18030, deliberately invalid as UTF-8.
    Buffer.from('d6d0cec4d3cabcfed5fdcec4', 'hex'),
    Buffer.from('</p>'),
  ])
  await withEmailFile(message, async filePath => {
    const parsed = await parseEmailFile(filePath)
    assert.equal(parsed.html, '<p>中文邮件正文</p>')
  })
})

test('MIME alternative HTML, quoted-printable text and related CID images remain renderable', async () => {
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  const message = Buffer.from([
    'From: sender@example.com', 'To: reader@example.com', 'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary=related', '',
    '--related', 'Content-Type: multipart/alternative; boundary=alternative', '',
    '--alternative', 'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', '', 'Plain caf=C3=A9',
    '--alternative', 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', '',
    '<p>HTML caf=C3=A9<img src=3D"cid:logo@example.com"></p>', '--alternative--',
    '--related', 'Content-Type: image/png', 'Content-ID: <logo@example.com>',
    'Content-Disposition: inline; filename=logo.png', 'Content-Transfer-Encoding: base64', '',
    image, '--related--', '',
  ].join('\r\n'))
  await withEmailFile(message, async filePath => {
    const parsed = await parseEmailFile(filePath)
    assert.equal(parsed.text?.trim(), 'Plain café')
    assert.equal(parsed.html, `<p>HTML café<img src="data:image/png;base64,${image}"></p>`)
    assert.equal(getParsedEmailBody(parsed), parsed.html, 'The actual HTML alternative takes precedence')
    assert.equal(parsed.attachments[0].contentId, '<logo@example.com>')
    assert.equal(parsed.attachments[0].content.toString('base64'), image)
  })
})

test('MIME text/plain remains literal when it contains HTML, Markdown and line breaks', async () => {
  const message = Buffer.from([
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
    '<strong>literal & text</strong>', '# Heading', '**No bold**', 'Second line',
  ].join('\r\n'))
  await withEmailFile(message, async filePath => {
    const parsed = await parseEmailFile(filePath)
    const body = getParsedEmailBody(parsed)
    assert.equal(body, '<p>&lt;strong&gt;literal &amp; text&lt;/strong&gt;<br/># Heading<br/>**No bold**<br/>Second line</p>')
    assert.equal(getMailContentFormat(body), 'html', 'The escaped MIME fallback must stay in the HTML renderer')
    assert.equal(parsed.text, '<strong>literal & text</strong>\n# Heading\n**No bold**\nSecond line')
  })
})
