const fs = require('fs')
const path = require('path')

const DEBUG_PORT = Number(process.env.PORTFOLIO_CAPTURE_DEBUG_PORT || 9229)
const BASE_URL = 'http://localhost:5173/'
const OUT_DIR = path.resolve('marketing_video/dashboard_captures')
const REPORT_PATH = path.join(OUT_DIR, 'capture-report.json')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitForJson(url, attempts = 80) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json`)
  const page = targets.find(target => target.type === 'page' && target.url.startsWith(BASE_URL))
  if (!page?.webSocketDebuggerUrl) throw new Error(`No debuggable Portfolio Tracker page found at ${BASE_URL}`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let requestId = 0
  const pending = new Map()
  const networkRequests = new Set()

  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent') networkRequests.add(message.params.requestId)
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
      networkRequests.delete(message.params.requestId)
    }
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
    }, 180000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed'
      throw new Error(description)
    }
    return result.result?.value
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

  await evaluate(`(() => {
    localStorage.setItem('portfolio-tracker-not-financial-advice-v1', 'accepted')
    localStorage.setItem('portfolio-tracker-advice-notices-v1', 'hidden')
    location.hash = '#/'
    location.reload()
    return true
  })()`)

  const getReadyState = () => evaluate(`(() => {
    if (!document.body) {
      return { complete: false, pendingText: [], busyCount: 0, errors: [], missing: ['document body'], holdingsRows: 0, height: 0, signature: 'loading' }
    }
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const leaves = [...document.querySelectorAll('body *')]
      .filter(element => !element.children.length && visible(element))
      .map(element => (element.textContent || '').trim())
      .filter(Boolean)
    const pendingText = leaves.filter(text => /^(loading|fetching|refreshing|updating|calculating|recording|backfilling|repairing)(…|\\.{3})?$/i.test(text))
    const busy = [...document.querySelectorAll('[aria-busy="true"], .spinner, .loading-spinner, .skeleton, .ci-loading')].filter(visible)
    const errors = [...document.querySelectorAll('.alert-error')]
      .filter(visible)
      .map(node => node?.innerText?.trim())
      .filter(Boolean)
    const bodyText = document.body.innerText || ''
    const requiredText = [
      'Portfolio Dashboard',
      'Shared Performance Date Range',
      'Portfolio Value Over Time',
      'Upcoming Dividends This Week',
      'Portfolio',
      'Holdings overview',
      'Common',
      'General',
      'Dividends',
      'Returns',
    ]
    const missing = requiredText.filter(text => !bodyText.includes(text))
    const holdingsRows = document.querySelectorAll('#holdings-overview tbody tr').length
    const signature = [
      bodyText.length,
      document.body.scrollHeight,
      document.querySelectorAll('svg').length,
      document.querySelectorAll('svg path').length,
      holdingsRows,
    ].join(':')
    return {
      complete: document.readyState === 'complete',
      pendingText,
      busyCount: busy.length,
      errors,
      missing,
      holdingsRows,
      height: document.body.scrollHeight,
      signature,
    }
  })()`)

  const waitForStableDashboard = async (label, timeoutMs = 180000) => {
    const started = Date.now()
    let lastSignature = ''
    let stableSamples = 0
    let lastState = null
    while (Date.now() - started < timeoutMs) {
      lastState = await getReadyState()
      if (lastState.errors.length) throw new Error(`${label}: visible dashboard error: ${lastState.errors.join(' | ')}`)
      const ready = lastState.complete
        && lastState.height >= 4000
        && lastState.holdingsRows > 0
        && lastState.busyCount === 0
        && lastState.pendingText.length === 0
        && lastState.missing.length === 0
        && networkRequests.size === 0
      if (ready && lastState.signature === lastSignature) stableSamples += 1
      else stableSamples = 0
      lastSignature = lastState.signature
      if (stableSamples >= 4) return lastState
      await sleep(750)
    }
    throw new Error(`${label}: dashboard did not fully stabilize: ${JSON.stringify(lastState)}`)
  }

  const protectAccountValue = () => evaluate(`(() => {
    const label = [...document.querySelectorAll('.dashboard-headline-card .summary-label')]
      .find(node => node.textContent.trim().startsWith('Portfolio Value'))
    const value = label?.closest('.dashboard-headline-card')?.querySelector('.summary-value')
    if (!value) throw new Error('Portfolio Value headline was not found for privacy protection')
    value.style.filter = 'blur(11px)'
    value.style.opacity = '0.86'
    value.style.userSelect = 'none'
    value.setAttribute('aria-label', 'Private account value')
    return true
  })()`)

  const preparePage = () => evaluate(`(() => {
    document.documentElement.style.scrollBehavior = 'auto'
    document.documentElement.style.overflowX = 'hidden'
    document.body.style.overflowX = 'hidden'
    return true
  })()`)

  const scrollToSelector = (selector, offset = 92) => evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw new Error('Missing capture target: ' + ${JSON.stringify(selector)})
    const top = element.getBoundingClientRect().top + window.scrollY - ${offset}
    window.scrollTo(0, Math.max(0, top))
    return { top: window.scrollY, text: (element.textContent || '').trim().slice(0, 160) }
  })()`)

  const scrollToText = (text, selector = 'h1,h2,h3,summary,.summary-label', offset = 92) => evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(node => (node.textContent || '').trim().includes(${JSON.stringify(text)}))
    if (!element) throw new Error('Missing text capture target: ' + ${JSON.stringify(text)})
    const top = element.getBoundingClientRect().top + window.scrollY - ${offset}
    window.scrollTo(0, Math.max(0, top))
    return { top: window.scrollY, text: (element.textContent || '').trim().slice(0, 160) }
  })()`)

  const clickButton = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find(node => (node.textContent || '').trim() === ${JSON.stringify(text)})
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)})
    button.click()
    return true
  })()`)

  const openDetails = summaryText => evaluate(`(() => {
    const summary = [...document.querySelectorAll('summary')]
      .find(node => (node.textContent || '').includes(${JSON.stringify(summaryText)}))
    if (!summary) throw new Error('Missing details section: ' + ${JSON.stringify(summaryText)})
    summary.parentElement.open = true
    return true
  })()`)

  const capture = async (filename, action = null) => {
    if (action) await action()
    await preparePage()
    await protectAccountValue()
    await sleep(700)
    const state = await getReadyState()
    if (state.errors.length || state.busyCount || state.pendingText.length || state.missing.length) {
      throw new Error(`${filename}: refused partial capture: ${JSON.stringify(state)}`)
    }
    const result = await call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(result.data, 'base64'))
    report.captures.push({ filename, scrollY: await evaluate('window.scrollY'), state })
    process.stdout.write(`Captured ${filename} at y=${report.captures.at(-1).scrollY}\n`)
  }

  const firstReadyState = await waitForStableDashboard('initial dashboard')
  const report = {
    capturedAt: new Date().toISOString(),
    initialReadyState: firstReadyState,
    captures: [],
  }

  await capture('01-headline-metrics.png', () => evaluate('window.scrollTo(0, 0)'))
  await capture('02-timeframes-and-alerts.png', () => scrollToText('Shared Performance Date Range', 'label', 430))
  await capture('03-nav-erosion-boxes.png', () => scrollToSelector('.nav-erosion-summary-row', 170))
  await capture('04-grade-and-risk-boxes.png', () => scrollToText('Portfolio Grade', '.summary-label', 210))
  await capture('05-income-and-yield-boxes.png', () => scrollToText('Lifetime Income', '.summary-label', 360))
  await capture('06-portfolio-value-chart.png', () => scrollToText('Portfolio Value Over Time', 'h3', 100))

  await openDetails('Grade & Exposure Guide')
  await sleep(300)
  await capture('07-grade-exposure-guide.png', () => scrollToText('Grade & Exposure Guide', 'summary', 90))

  await openDetails('Understanding Account Alpha')
  await sleep(300)
  await capture('08-account-alpha-guide.png', () => scrollToText('Understanding Account Alpha', 'summary', 90))
  await capture('09-weekly-calendar.png', () => scrollToText('Upcoming Dividends This Week', 'h3', 95))

  await capture('10-portfolio-all-categories.png', () => scrollToSelector('.portfolio-overview', 92))
  await evaluate(`(() => {
    const root = document.querySelector('.portfolio-overview')
    const category = root?.querySelector('select')
    const option = [...(category?.options || [])].find(item => item.value)
    if (!category || !option) throw new Error('No portfolio category is available')
    category.value = option.value
    category.dispatchEvent(new Event('change', { bubbles: true }))
    return option.textContent
  })()`)
  await sleep(600)
  await capture('11-portfolio-category-drilldown.png', () => scrollToSelector('.portfolio-overview', 92))

  await evaluate(`(() => {
    const root = document.querySelector('.portfolio-overview')
    const selects = root ? [...root.querySelectorAll('select')] : []
    const subcategory = selects[1]
    const option = [...(subcategory?.options || [])].find(item => item.value)
    if (subcategory && option) {
      subcategory.value = option.value
      subcategory.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const gain = selects.at(-1)
    if (gain && [...gain.options].some(item => item.value === 'total')) {
      gain.value = 'total'
      gain.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return { subcategory: option?.textContent || null, totalReturn: true }
  })()`)
  await sleep(600)
  await capture('12-portfolio-holdings-drilldown.png', () => scrollToSelector('.portfolio-overview', 92))

  await capture('13-holdings-overview-controls.png', () => scrollToSelector('#holdings-overview', 92))
  await capture('14-common-table-view.png', () => scrollToSelector('#holdings-overview .ci-table-wrap', 150))

  await clickButton('General')
  await sleep(400)
  await capture('15-general-table-view.png', () => scrollToSelector('#holdings-overview', 92))

  await clickButton('Dividends')
  await sleep(400)
  await capture('16-dividends-table-view.png', () => scrollToSelector('#holdings-overview', 92))

  await clickButton('Returns')
  await sleep(400)
  await capture('17-returns-table-view.png', () => scrollToSelector('#holdings-overview', 92))

  await capture('18-table-columns-and-totals.png', () => scrollToSelector('#holdings-overview .holdings-column-bar', 130))

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  ws.close()
  process.stdout.write(`Dashboard capture complete: ${report.captures.length} fully loaded frames.\n`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
