import { BrowserWindow } from 'electron'

export async function renderHtmlToPdf(html) {
  if (typeof html !== 'string' || html.length === 0 || html.length > 20 * 1024 * 1024) {
    throw new Error('Report HTML must be a non-empty document no larger than 20 MB.')
  }
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  })

  try {
    await pdfWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise(resolve => setTimeout(resolve, 300))
    const layoutDeadline = Date.now() + 20000
    while (Date.now() < layoutDeadline) {
      const ready = await pdfWindow.webContents.executeJavaScript(
        "!document.querySelector('.flow-section') || window.__flowDone === true"
      ).catch(() => true)
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      printBackground: true,
      landscape: false,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    })
  } finally {
    pdfWindow.close()
  }
}
