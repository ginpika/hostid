import React from 'react'
import { createRoot } from 'react-dom/client'
import EmailBody from '../src/components/EmailBody.tsx'
import { createEmailHtmlDocument } from '../src/lib/htmlEmail.ts'

const results = document.querySelector('#test-results')
const fixtures = document.querySelector('#fixtures')
let passed = 0
let failed = 0
results.textContent = ''

function assert(value, message) {
  if (!value) throw new Error(message)
}
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
async function waitFor(predicate, message) {
  const deadline = performance.now() + 3000
  while (performance.now() < deadline) {
    if (predicate()) return
    await nextPaint()
  }
  throw new Error(message)
}
async function test(name, callback) {
  try {
    await callback()
    passed++
    results.textContent += `PASS ${name}\n`
  } catch (error) {
    failed++
    results.textContent += `FAIL ${name}: ${error.message}\n`
    console.error(name, error)
  }
}
async function frameFor(html, width = 920) {
  const iframe = document.createElement('iframe')
  iframe.style.width = `${width}px`
  iframe.style.height = '300px'
  iframe.sandbox = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox'
  const loaded = new Promise(resolve => { iframe.onload = resolve })
  iframe.srcdoc = createEmailHtmlDocument(html)
  fixtures.append(iframe)
  await loaded
  return iframe
}
const githubTable = `<!doctype html><html><body style="font-size:14px;line-height:1.5;margin:0">
  <table width="100%" style="max-width:544px;margin:auto;border-collapse:collapse"><tbody><tr><td>
    <table style="width:100%;border-collapse:collapse"><thead><tr>
      <th scope="col" style="width:24px;padding:16px 0 16px 16px">Status</th>
      <th scope="col" style="width:100%;padding:16px">Job</th>
      <th scope="col" style="white-space:nowrap;padding:16px 16px 16px 0">Annotations</th>
    </tr></thead><tbody><tr><td>✓</td><td>Docker Build / typecheck</td><td>1</td></tr></tbody></table>
  </td></tr></tbody></table></body></html>`

await test('GitHub status column stays on one line in wide and narrow readers', async () => {
  const iframe = await frameFor(githubTable)
  for (const width of [920, 600, 360]) {
    iframe.style.width = `${width}px`
    await nextPaint()
    const doc = iframe.contentDocument
    const status = doc.querySelector('th')
    const range = doc.createRange()
    range.selectNodeContents(status)
    const lines = new Set([...range.getClientRects()].map(rect => rect.y))
    assert(lines.size === 1, `Status wrapped to ${lines.size} lines at ${width}px`)
    assert(status.getAttribute('scope') === 'col', 'Table semantics were removed')
    assert(iframe.getBoundingClientRect().width <= width + 2, 'Sender table expanded the host reader')
    assert(doc.defaultView.getComputedStyle(doc.body).fontSize === '14px', 'Sender body font was replaced')
  }
  iframe.remove()
})

await test('Head styles, responsive rules, body attributes and cellpadding survive sanitization', async () => {
  const iframe = await frameFor(`<!doctype html><html lang="zh" dir="rtl"><head><style>
    body { font-size:23px; background:rgb(250,240,230); }
    .responsive { color:rgb(200,20,20); }
    @media (max-width:480px) { .responsive { font-size:18px; } }
    h1 { color:rgb(0,255,0); }
  </style><style media="(min-width:480px)">.responsive { background:rgb(230,240,250); }</style></head><body class="sender" style="padding:11px" bgcolor="#faf0e6">
    <table cellpadding="0"><tr><td class="responsive">Preserved styles</td></tr></table>
  </body></html>`, 360)
  const doc = iframe.contentDocument
  const computed = element => doc.defaultView.getComputedStyle(element)
  const cell = doc.querySelector('td')
  assert(computed(doc.body).fontSize === '23px', 'Head body rule was overridden')
  assert(computed(doc.body).padding === '11px', 'Inline body padding was discarded')
  assert(computed(doc.body).backgroundColor === 'rgb(250, 240, 230)', 'Background changed')
  assert(computed(cell).fontSize === '18px', 'Narrow reader media rule did not apply')
  assert(computed(cell).color === 'rgb(200, 20, 20)', 'Sender class style did not apply')
  assert(computed(cell).padding === '0px', 'Fallback padding overrode cellpadding=0')
  assert(doc.querySelector('style[media]')?.media === '(min-width:480px)', 'Style media attribute was removed')
  assert(computed(cell).backgroundColor === 'rgba(0, 0, 0, 0)', 'Wide-only stylesheet applied in narrow reader')
  assert(doc.body.className === 'sender', 'Body class was removed')
  assert(doc.documentElement.lang === 'zh' && doc.documentElement.dir === 'rtl', 'Language/direction was removed')
  assert(getComputedStyle(document.querySelector('#host-heading')).color !== 'rgb(0, 255, 0)', 'Email CSS leaked to app')
  iframe.style.width = '920px'
  await nextPaint()
  assert(computed(cell).fontSize === '23px', 'Wide reader did not leave media rule')
  assert(computed(cell).backgroundColor === 'rgb(230, 240, 250)', 'Wide-only stylesheet did not apply')
  iframe.remove()
})

await test('Active HTML stays stripped and scripts remain disabled in the iframe', async () => {
  const iframe = await frameFor(`<html><head>
    <script>parent.__emailScriptExecuted=true</script><base href="https://invalid.example">
    <meta http-equiv="refresh" content="0;https://invalid.example">
  </head><body><a href="javascript:parent.__emailScriptExecuted=true" onclick="parent.__emailScriptExecuted=true">Unsafe link</a>
    <img onerror="parent.__emailScriptExecuted=true"><iframe src="https://invalid.example"></iframe>
    <form><input name="token"></form></body></html>`)
  const doc = iframe.contentDocument
  assert(!doc.querySelector('script,iframe,form,input,base,meta[http-equiv]'), 'Active element survived')
  assert(!doc.querySelector('[onclick],[onerror]'), 'Event handler survived')
  assert(doc.querySelector('a').getAttribute('href') === null, 'JavaScript link survived')
  assert(!window.__emailScriptExecuted, 'Email script executed')
  assert(!iframe.sandbox.contains('allow-scripts'), 'Iframe permits scripts')
  iframe.remove()
})

await test('Unbroken links wrap without expanding ordinary prose', async () => {
  const iframe = await frameFor(`<p><a href="https://example.com">https://example.com/${'long-path'.repeat(40)}</a></p>`, 360)
  assert(iframe.contentDocument.body.scrollWidth <= 360, 'Long link expanded the document')
  iframe.remove()
})

await test('Production component shrinks long HTML, preserves plain/Markdown rendering and opens links safely', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  try {
    root.render(React.createElement(EmailBody, { content: '<div style="height:1800px">Long email</div>' }))
    await waitFor(() => parseFloat(mount.querySelector('iframe')?.style.height) >= 1800, 'Long email did not expand iframe')
    root.render(React.createElement(EmailBody, { content: '<p>Short email</p><a href="https://example.com">Read more</a>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.body.textContent.includes('Short email') && parseFloat(mount.querySelector('iframe')?.style.height) < 150, 'Short email kept long iframe height')
    const link = mount.querySelector('iframe').contentDocument.querySelector('a')
    assert(link.target === '_blank', 'Email link did not open outside reader')
    assert(link.rel.includes('noopener') && link.rel.includes('noreferrer'), 'Email link isolation missing')
    assert(!mount.querySelector('iframe').sandbox.contains('allow-scripts'), 'Production iframe permits scripts')
    root.render(React.createElement(EmailBody, { content: 'Plain text\nSecond line' }))
    await waitFor(() => mount.querySelector('.email-body')?.textContent === 'Plain text\nSecond line', 'Plain text rendering changed')
    assert(!mount.querySelector('iframe'), 'Plain text unexpectedly rendered in iframe')
    root.render(React.createElement(EmailBody, { content: '# Heading\n\n**Bold** text' }))
    await waitFor(() => mount.querySelector('h1')?.textContent === 'Heading', 'Markdown heading rendering changed')
    assert(mount.querySelector('strong')?.textContent === 'Bold', 'Markdown emphasis rendering changed')
    root.render(React.createElement(EmailBody, { content: '<p>HTML again</p>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.body.textContent.includes('HTML again'), 'Switching back to HTML failed')
    await waitFor(() => parseFloat(mount.querySelector('iframe')?.style.height) < 150, 'HTML height stale after switching modes')
  } finally {
    root.unmount()
    mount.remove()
  }
})

await test('Semantic email sections keep their layout and hidden preheaders stay hidden', async () => {
  const iframe = await frameFor(`<style>article > section { padding:13px; } figcaption { color:rgb(40,80,120); }</style>
    <article><header>Newsletter</header><section><div hidden>Inbox preview only</div>
    <figure><figcaption>Image caption</figcaption></figure><footer>Footer</footer>
    <details open><summary>Details title</summary><ruby>漢<rt>かん</rt></ruby><wbr></details></section></article>`)
  try {
    const doc = iframe.contentDocument
    for (const selector of ['article', 'header', 'section', 'figure', 'figcaption', 'footer', 'details[open]', 'summary', 'ruby', 'rt', 'wbr']) {
      assert(doc.querySelector(selector), `${selector} wrapper was stripped`)
    }
    assert(doc.defaultView.getComputedStyle(doc.querySelector('section')).padding === '13px', 'Section layout CSS stopped matching')
    assert(doc.querySelector('[hidden]')?.getClientRects().length === 0, 'Hidden preheader became visible')
    assert(doc.defaultView.getComputedStyle(doc.querySelector('figcaption')).color === 'rgb(40, 80, 120)', 'Caption style stopped matching')
  } finally { iframe.remove() }
})

await test('Responsive image sources and image-map geometry survive', async () => {
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
  const banner = '/favicon.svg'
  const iframe = await frameFor(`<picture><source media="(max-width:480px)" type="image/svg+xml" srcset="${banner} 1x">
    <img src="${pixel}" srcset="${banner}?retina 1x" sizes="(max-width:480px) 100vw, 600px" usemap="#newsletter-map" alt="Banner">
    </picture><map name="newsletter-map"><area shape="rect" coords="0,0,16,16" href="https://example.com"></map>
    <img id="spacer" src="${pixel}" width="1" height="20" alt="">`, 360)
  try {
    const doc = iframe.contentDocument
    assert(doc.querySelector('picture > source')?.getAttribute('srcset')?.includes(banner), 'Picture source was removed')
    assert(doc.querySelector('source').media === '(max-width:480px)', 'Source media condition was removed')
    const img = doc.querySelector('img')
    assert(img.getAttribute('srcset')?.includes(banner), 'Retina image candidates were removed')
    assert(img.getAttribute('sizes')?.includes('100vw'), 'Image sizes were removed')
    assert(img.getAttribute('usemap') === '#newsletter-map', 'Image map reference was removed')
    const area = doc.querySelector('area')
    assert(area.shape === 'rect' && area.coords === '0,0,16,16', 'Image map geometry was removed')
    await waitFor(() => img.complete && img.naturalWidth > 0, 'Responsive image did not load')
    assert(img.currentSrc.endsWith(banner), 'Narrow picture source was not selected')
    iframe.style.width = '920px'
    await nextPaint()
    await waitFor(() => img.currentSrc.endsWith(`${banner}?retina`), 'Wide picture fallback was not selected')
    await waitFor(() => doc.querySelector('#spacer').complete, 'Spacer image did not load')
    assert(doc.querySelector('#spacer').getBoundingClientRect().height === 20, 'Explicit spacer image height was replaced by natural aspect ratio')
  } finally { iframe.remove() }
})

await test('Ordered list numbering and table column/accessibility attributes survive', async () => {
  const iframe = await frameFor(`<ol start="3" reversed><li value="9">Nine</li><li>Eight</li></ol>
    <table><colgroup><col span="2" style="background:rgb(230,240,250)"></colgroup>
    <tr><th id="amount-heading">Amount</th><td headers="amount-heading">100</td></tr></table>`)
  try {
    const doc = iframe.contentDocument
    assert(doc.querySelector('ol').start === 3 && doc.querySelector('ol').reversed, 'Ordered list numbering was reset')
    assert(doc.querySelector('li').value === 9, 'Individual list item value was removed')
    assert(doc.querySelector('col').span === 2, 'Table column span was reset')
    assert(doc.querySelector('td').headers === 'amount-heading', 'Table header association was removed')
  } finally { iframe.remove() }
})

await test('HTML emails containing Markdown examples keep literal code and sender styles', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  try {
    root.render(React.createElement(EmailBody, { content: '<!doctype html><html><head><style>pre { color:rgb(10,70,120); }</style></head><body><pre>\n# Literal heading\n```sh\necho example\n```</pre></body></html>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.querySelector('pre'), 'HTML email was misclassified as Markdown')
    const doc = mount.querySelector('iframe').contentDocument
    assert(doc.querySelector('pre').textContent.includes('# Literal heading'), 'HTML code example was parsed as Markdown')
    assert(doc.defaultView.getComputedStyle(doc.querySelector('pre')).color === 'rgb(10, 70, 120)', 'Email code styling was lost')
  } finally { root.unmount(); mount.remove() }
})

await test('Email body margins fit the auto-sized iframe', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  try {
    root.render(React.createElement(EmailBody, { content: '<body style="margin:40px"><p style="margin:0">Margin email</p></body>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.body.textContent.includes('Margin email'), 'Margin email did not load')
    await nextPaint()
    const iframe = mount.querySelector('iframe')
    assert(iframe.contentDocument.documentElement.scrollHeight <= iframe.clientHeight + 1, 'Body margins were clipped by iframe height')
  } finally { root.unmount(); mount.remove() }
})

await test('Legacy body text, link and background colors remain effective', async () => {
  const iframe = await frameFor('<body text="#123456" link="#009900" vlink="#000099" alink="#ff0000" bgcolor="#faf0e6"><p>Legacy email</p><a href="https://example.com">Website</a></body>')
  try {
    const doc = iframe.contentDocument
    assert(doc.defaultView.getComputedStyle(doc.querySelector('p')).color === 'rgb(18, 52, 86)', 'Body text color was replaced by fallback')
    assert(doc.defaultView.getComputedStyle(doc.querySelector('a')).color === 'rgb(0, 153, 0)', 'Body link color was replaced by fallback')
    assert(doc.defaultView.getComputedStyle(doc.body).backgroundColor === 'rgb(250, 240, 230)', 'Body background was replaced')
    assert(doc.body.getAttribute('vlink') === '#000099' && doc.body.getAttribute('alink') === '#ff0000', 'Legacy link state colors were discarded')
  } finally { iframe.remove() }
})

await test('Percentage-height HTML shrinks after a long message without resize feedback', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  const resizeErrors = []
  const onError = event => { if (event.message?.includes('ResizeObserver loop')) resizeErrors.push(event.message) }
  window.addEventListener('error', onError)
  try {
    root.render(React.createElement(EmailBody, { content: '<div style="height:1800px">Long email</div>' }))
    await waitFor(() => parseFloat(mount.querySelector('iframe')?.style.height) >= 1800, 'Long message did not expand')
    root.render(React.createElement(EmailBody, { content: '<html style="height:100%"><body style="min-height:100%"><p style="margin:0">Short percentage email</p></body></html>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.body.textContent.includes('Short percentage email') && parseFloat(mount.querySelector('iframe')?.style.height) < 150, 'Percentage-height body retained old viewport height')
    const height = mount.querySelector('iframe').style.height
    for (let i = 0; i < 6; i++) await nextPaint()
    assert(mount.querySelector('iframe').style.height === height, 'Percentage-height measurement kept changing')
    assert(resizeErrors.length === 0, 'Height measurement triggered a ResizeObserver loop')
  } finally { window.removeEventListener('error', onError); root.unmount(); mount.remove() }
})

await test('Internal anchors stay in the email and image-map links open outside the reader', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  try {
    root.render(React.createElement(EmailBody, { content: '<a href="#email-section">Jump</a><div style="height:900px"></div><h2 id="email-section">Destination</h2><map name="banner"><area shape="rect" coords="0,0,16,16" href="https://example.com"></map>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.querySelector('a'), 'Anchor email did not load')
    const doc = mount.querySelector('iframe').contentDocument
    assert(doc.querySelector('a').target !== '_blank', 'Internal anchor opens an empty external page')
    const area = doc.querySelector('area')
    assert(area.target === '_blank' && area.rel.includes('noopener') && area.rel.includes('noreferrer'), 'Image-map link navigates inside reader')
    window.scrollTo(0, 0)
    const click = new doc.defaultView.MouseEvent('click', { bubbles: true, cancelable: true })
    doc.querySelector('a').dispatchEvent(click)
    assert(click.defaultPrevented, 'Fragment link attempted to navigate srcdoc')
    await nextPaint()
    assert(window.scrollY > 300, 'Fragment link did not scroll the host reader to its destination')
  } finally { root.unmount(); mount.remove(); window.scrollTo(0, 0) }
})

await test('Opening and closing details resizes an email with a fixed percentage-height body', async () => {
  const mount = document.createElement('div')
  fixtures.append(mount)
  const root = createRoot(mount)
  try {
    root.render(React.createElement(EmailBody, { content: '<html style="height:100%"><body style="height:100%;margin:0"><details><summary>More</summary><div style="height:700px">Long details content</div></details></body></html>' }))
    await waitFor(() => mount.querySelector('iframe')?.contentDocument?.querySelector('details') && parseFloat(mount.querySelector('iframe').style.height) < 150, 'Collapsed details did not fit')
    const iframe = mount.querySelector('iframe')
    const details = iframe.contentDocument.querySelector('details')
    details.querySelector('summary').click()
    await waitFor(() => details.open && parseFloat(iframe.style.height) >= 700, 'Open details content was clipped')
    assert(iframe.contentDocument.documentElement.scrollHeight <= iframe.clientHeight + 1, 'Open details kept a nested vertical scrollbar')
    details.querySelector('summary').click()
    await waitFor(() => !details.open && parseFloat(iframe.style.height) < 150, 'Closing details kept an oversized iframe')
  } finally { root.unmount(); mount.remove() }
})

results.textContent += `\n${passed} passed, ${failed} failed\n`
document.body.dataset.testStatus = failed ? 'failed' : 'passed'
