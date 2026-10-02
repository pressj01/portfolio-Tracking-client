const fs = require('fs')
const path = require('path')

const DEBUG_PORT = 9229
const OUT_DIR = path.resolve(process.argv[2] || 'marketing_video/captures')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForJson(url, attempts = 50) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch (error) {
      lastError = error
    }
    await sleep(200)
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json`)
  const page = targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let requestId = 0
  const pending = new Map()
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation failed')
    }
    return result.result?.value
  }

  const waitForReady = async () => {
    for (let i = 0; i < 80; i += 1) {
      if (await evaluate('document.readyState')) return
      await sleep(100)
    }
  }

  const navigate = async (url, settleMs) => {
    await call('Page.navigate', { url })
    await waitForReady()
    await sleep(settleMs)
  }

  const preparePage = async () => {
    await evaluate(`(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      document.documentElement.style.overflowX = 'hidden'
      document.body.style.overflowX = 'hidden'
      return true
    })()`)
  }

  const capture = async filename => {
    await preparePage()
    await sleep(500)
    const result = await call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(result.data, 'base64'))
  }

  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1920,
    screenHeight: 1080,
  })

  await navigate('http://127.0.0.1:5173/', 1000)
  await evaluate(`(() => {
    localStorage.setItem('portfolio-tracker-not-financial-advice-v1', 'accepted')
    localStorage.setItem('portfolio-tracker-advice-notices-v1', 'hidden')
    location.reload()
    return true
  })()`)
  await sleep(12000)
  await evaluate('window.scrollTo(0, 0)')
  await capture('01-dashboard.png')

  await navigate('http://127.0.0.1:5173/#/holdings', 8000)
  await evaluate(`(() => {
    const link = [...document.querySelectorAll('a')]
      .find(node => node.textContent.trim().toUpperCase() === 'SPYI')
    if (!link) throw new Error('SPYI holding link was not found')
    link.click()
    return true
  })()`)
  await sleep(5000)
  await capture('02-spyi-holding.png')

  await navigate('http://127.0.0.1:5173/#/etf-comparer?tickers=SPYI%2CTSPY%2CGPIX', 14000)
  await evaluate(`(() => {
    const close = document.querySelector('.ticker-research-sheet .modal-close')
    if (close) close.click()
    window.scrollTo(0, 0)
    return true
  })()`)
  await sleep(1000)
  await capture('03-etf-comparer.png')

  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2')]
      .find(node => node.textContent.includes('Comparison'))
    if (heading) heading.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(1000)
  await capture('04-etf-comparer-details.png')

  ws.close()
  process.stdout.write(`Captured demo frames in ${OUT_DIR}\n`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
