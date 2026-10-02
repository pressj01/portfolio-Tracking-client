const fs = require('fs')
const path = require('path')

const [filename, route = '/', settleArg = '7000'] = process.argv.slice(2)
if (!filename) throw new Error('Usage: node capture_one.js <filename> <route> [settle-ms]')

const settleMs = Number(settleArg)
const output = path.resolve('marketing_video/overview_captures', filename)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9229/json')).json()
  const page = targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page found')

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
    const item = pending.get(message.id)
    clearTimeout(item.timer)
    pending.delete(message.id)
    if (message.error) item.reject(new Error(message.error.message))
    else item.resolve(message.result)
  })

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, 60000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed')
    return result.result?.value
  }

  await call('Page.enable')
  await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 1920,
    screenHeight: 1080,
  })

  await evaluate(`(() => {
    localStorage.setItem('portfolio-tracker-not-financial-advice-v1', 'accepted')
    localStorage.setItem('portfolio-tracker-advice-notices-v1', 'hidden')
    const checkbox = document.querySelector('.nfa-ack input[type="checkbox"]')
    if (checkbox && !checkbox.checked) checkbox.click()
    return true
  })()`)
  await sleep(250)
  await evaluate(`(() => {
    const button = document.querySelector('.nfa-ack button')
    if (button && !button.disabled) button.click()
    window.location.hash = ${JSON.stringify(`#${route}`)}
    return true
  })()`)
  await sleep(settleMs)

  const startedAt = Date.now()
  let previousSignature = ''
  let stableSamples = 0
  let lastStatus = null

  while (Date.now() - startedAt < 45000) {
    lastStatus = await evaluate(`(() => {
      const visible = element => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const leaves = [...document.querySelectorAll('body *')]
        .filter(element => !element.children.length && visible(element))
        .map(element => (element.textContent || '').trim())
        .filter(Boolean)
      const pendingText = leaves.filter(text => /^(loading|fetching|refreshing)(…|\\.{3})?$/i.test(text))
      const busy = [...document.querySelectorAll('[aria-busy="true"], .spinner, .loading-spinner, .skeleton')]
        .filter(visible)
      const bodyText = document.body.innerText || ''
      return {
        ready: document.readyState === 'complete' && bodyText.length > 200 && !pendingText.length && !busy.length && !document.querySelector('.nfa-ack'),
        pendingText,
        busyCount: busy.length,
        signature: [
          bodyText.length,
          document.body.scrollHeight,
          document.querySelectorAll('svg').length,
          document.querySelectorAll('svg path').length,
          document.querySelectorAll('canvas').length,
          document.querySelectorAll('table tbody tr').length,
        ].join(':'),
      }
    })()`)

    if (lastStatus.ready && lastStatus.signature === previousSignature) stableSamples += 1
    else stableSamples = 0
    previousSignature = lastStatus.signature
    if (stableSamples >= 3) break
    await sleep(750)
  }

  if (stableSamples < 3) {
    throw new Error(`Screen did not settle: ${JSON.stringify(lastStatus)}`)
  }

  await evaluate(`(() => {
    document.documentElement.style.scrollBehavior = 'auto'
    document.documentElement.style.overflowX = 'hidden'
    document.body.style.overflowX = 'hidden'
    window.scrollTo(0, 0)
    return true
  })()`)
  await sleep(500)

  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
  ws.close()
  process.stdout.write(`Captured ${filename} after stable load (${lastStatus.signature})\n`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
