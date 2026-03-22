function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function printHtmlDocument(title: string, body: string) {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove()
    }, 400)
  }

  const iframeWindow = iframe.contentWindow
  const iframeDocument = iframeWindow?.document

  if (!iframeWindow || !iframeDocument) {
    iframe.remove()
    alert('Unable to open print view right now')
    return
  }

  iframeWindow.onafterprint = cleanup

  iframeDocument.open()
  iframeDocument.write(`<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
  </head>
  <body>${body}</body>
</html>`)
  iframeDocument.close()

  window.setTimeout(() => {
    iframeWindow.focus()
    iframeWindow.print()
    window.setTimeout(cleanup, 60_000)
  }, 120)
}

export function printSimpleTableReport(title: string, subtitle: string, headers: string[], rows: string[][]) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td style="${index >= Math.max(0, row.length - 3) ? 'text-align:right;' : ''}">${escapeHtml(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('')

  printHtmlDocument(
    title,
    `
    <style>
      body { font-family: Arial, sans-serif; padding: 18px; color: #0f172a; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0 0 14px; color: #475569; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
      th { background: #f8fafc; text-align: left; }
    </style>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <p>Generated: ${escapeHtml(new Date().toLocaleString('en-IN'))}</p>
    <table>
      <thead>
        <tr>${headerHtml}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `
  )
}
