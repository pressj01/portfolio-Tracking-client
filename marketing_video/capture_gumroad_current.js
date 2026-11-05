const fs = require('fs')
const path = require('path')

const DEBUG_PORT = Number(process.env.PORTFOLIO_CAPTURE_DEBUG_PORT || 9230)
const BASE_URL = 'http://localhost:5173/'
const OUT_DIR = path.resolve('marketing_video/gumroad_current_captures')
const REPORT_PATH = path.join(OUT_DIR, 'capture-report.json')
const ONLY = new Set(process.argv.slice(2))
const wants = id => ONLY.size === 0 || ONLY.has(id)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()
  const page = targets.find(target => target.type === 'page' && /^https?:\/\/(localhost|127\.0\.0\.1):5173\//.test(target.url))
  if (!page?.webSocketDebuggerUrl) throw new Error(`No Portfolio Tracker page found on debugging port ${DEBUG_PORT}`)

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
    }, 90000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })

  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Evaluation failed')
    }
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
    document.documentElement.style.scrollBehavior = 'auto'
    return true
  })()`)

  const pageState = () => evaluate(`(() => {
    if (!document.body) return { ready: false, signature: 'loading', height: 0, pending: [] }
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const leaves = [...document.querySelectorAll('body *')]
      .filter(element => !element.children.length && visible(element))
      .map(element => (element.textContent || '').trim())
      .filter(Boolean)
    const pending = leaves.filter(text => /^(loading|fetching|refreshing|updating|calculating)(…|\.{3})?$/i.test(text))
    const busy = [...document.querySelectorAll('[aria-busy="true"],.spinner,.loading-spinner,.dc-chip-spinner,.skeleton')]
      .filter(visible)
    const bodyText = document.body.innerText || ''
    return {
      ready: document.readyState === 'complete' && bodyText.length > 200 && pending.length === 0 && busy.length === 0,
      signature: [bodyText.length, document.body.scrollHeight, document.querySelectorAll('svg').length, document.querySelectorAll('table tbody tr').length].join(':'),
      height: document.body.scrollHeight,
      pending,
      busyCount: busy.length,
      heading: document.querySelector('h1')?.textContent?.trim() || '',
    }
  })()`)

  const waitForStable = async label => {
    const started = Date.now()
    let lastSignature = ''
    let stable = 0
    let state = null
    while (Date.now() - started < 90000) {
      state = await pageState()
      if (state.ready && state.signature === lastSignature) stable += 1
      else stable = 0
      lastSignature = state.signature
      if (stable >= 3) return state
      await sleep(750)
    }
    throw new Error(`${label} did not stabilize: ${JSON.stringify(state)}`)
  }

  const navigate = async route => {
    await call('Page.navigate', { url: `${BASE_URL}#${route}` })
    const state = await waitForStable(route)
    await evaluate(`(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      document.documentElement.style.overflowX = 'hidden'
      document.body.style.overflowX = 'hidden'
      window.scrollTo(0, 0)
      return true
    })()`)
    await sleep(500)
    return state
  }

  const protectPrivateValues = () => evaluate(`(() => {
    const privateLabels = new Set([
      'Portfolio Value', 'Current Portfolio Value', 'Current Value', 'Account Value',
      'Total Invested', 'Start Value', 'End Value', 'Starting Wealth'
    ])
    const labels = [...document.querySelectorAll('.summary-label,.dc-stat-label,label')]
    let protectedCount = 0
    for (const label of labels) {
      const text = (label.textContent || '').trim()
      if (!privateLabels.has(text)) continue
      const container = label.closest('.summary-card,.dashboard-headline-card,.dc-stat-card,.dc-field,.card') || label.parentElement
      const candidates = container ? [...container.querySelectorAll('.summary-value,.dc-stat-value,input')] : []
      for (const value of candidates) {
        value.style.filter = 'blur(11px)'
        value.style.opacity = '0.86'
        value.style.userSelect = 'none'
        protectedCount += 1
      }
    }
    return protectedCount
  })()`)

  const capture = async (filename, y) => {
    await evaluate(`window.scrollTo(0, ${Math.round(y)})`)
    await sleep(600)
    const protectedCount = await protectPrivateValues()
    const actualY = await evaluate('window.scrollY')
    const screenshot = await call('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(screenshot.data, 'base64'))
    return { filename, requestedY: y, actualY, protectedCount }
  }

  const evenlySpacedPositions = async (maxFrames = 7) => {
    const dimensions = await evaluate(`({ height: document.body.scrollHeight, viewport: window.innerHeight })`)
    const maxY = Math.max(0, dimensions.height - dimensions.viewport)
    if (!maxY) return [0]
    const desired = Math.min(maxFrames, Math.max(2, Math.ceil(maxY / 820) + 1))
    return Array.from({ length: desired }, (_, index) => Math.round(maxY * index / (desired - 1)))
  }

  const report = { capturedAt: new Date().toISOString(), debugPort: DEBUG_PORT, pages: [] }
  const capturePage = async ({ id, route, maxFrames = 7, beforeCapture = null }) => {
    const state = await navigate(route)
    if (beforeCapture) await beforeCapture()
    await waitForStable(`${route} after setup`)
    const positions = await evenlySpacedPositions(maxFrames)
    const captures = []
    for (let index = 0; index < positions.length; index += 1) {
      captures.push(await capture(`${id}-${String(index + 1).padStart(2, '0')}.png`, positions[index]))
    }
    report.pages.push({ id, route, state, positions, captures })
    process.stdout.write(`Captured ${id}: ${captures.length} current frames across ${state.height}px\n`)
  }

  const loadDividendExample = async () => {
    await evaluate(`(() => {
      const reset = [...document.querySelectorAll('button')]
        .find(node => node.textContent.trim() === 'Reset')
      if (!reset) throw new Error('Dividend Calculator reset control was not found')
      reset.click()
      return true
    })()`)
    await sleep(500)
    await evaluate(`(() => {
      const fromPortfolio = [...document.querySelectorAll('button')]
        .find(node => node.textContent.trim().startsWith('From Portfolio'))
      if (!fromPortfolio || fromPortfolio.disabled) throw new Error('From Portfolio is not available')
      fromPortfolio.click()
      return true
    })()`)
    await sleep(500)
    await evaluate(`(() => {
      const deselectAll = [...document.querySelectorAll('.dc-ticker-bar + div button')]
        .find(node => node.textContent.trim() === 'Deselect All')
      if (!deselectAll) throw new Error('No portfolio tickers were available in the calculator picker')
      deselectAll.click()
      return true
    })()`)
    await sleep(200)
    for (let index = 0; index < 3; index += 1) {
      await evaluate(`(() => {
        const box = [...document.querySelectorAll('.dc-ticker-bar + div tbody input[type="checkbox"]')]
          .find(node => !node.checked)
        if (!box) throw new Error('Not enough portfolio tickers were available')
        box.click()
        return true
      })()`)
      await sleep(150)
    }
    await evaluate(`(() => {
      const add = document.querySelector('.dc-ticker-bar + div button.btn-primary')
      if (!add || add.disabled) throw new Error('Selected portfolio tickers could not be added')
      add.click()
      return true
    })()`)
    await waitForStable('dividend tickers')
    await evaluate(`(() => {
      const calculate = [...document.querySelectorAll('button')]
        .find(node => node.textContent.trim() === 'Calculate')
      if (calculate && !calculate.disabled) calculate.click()
      return true
    })()`)
    await waitForStable('dividend results')
  }

  if (wants('total-return')) await capturePage({ id: 'total-return', route: '/total-return', maxFrames: 6 })
  if (wants('gains-losses')) await capturePage({ id: 'gains-losses', route: '/gains-losses', maxFrames: 6 })
  if (wants('growth')) await capturePage({ id: 'growth', route: '/growth?tab=dollars', maxFrames: 6 })
  if (wants('watchlist')) await capturePage({
    id: 'watchlist',
    route: '/watchlist',
    maxFrames: 3,
    beforeCapture: async () => {
      await evaluate(`(() => {
        localStorage.setItem('dashboard_watchlist_shown_v1', '1')
        const toggle = document.querySelector('.wl-home-toggle input[type="checkbox"]')
        if (toggle && !toggle.checked) toggle.click()
        return true
      })()`)
      await sleep(800)
    },
  })

  if (wants('dashboard-watchlist')) {
  await navigate('/')
  await evaluate(`localStorage.setItem('dashboard_watchlist_shown_v1', '1')`)
  await call('Page.reload', { ignoreCache: false })
  await waitForStable('dashboard watchlist')
  const watchlistY = await evaluate(`(() => {
    const card = document.querySelector('.home-watchlist')
    if (!card) throw new Error('The current Dashboard watchlist card did not load')
    return Math.max(0, card.getBoundingClientRect().top + window.scrollY - 110)
  })()`)
  const dashboardWatchlist = await capture('dashboard-watchlist-01.png', watchlistY)
  report.pages.push({ id: 'dashboard-watchlist', route: '/', captures: [dashboardWatchlist] })
  process.stdout.write('Captured the current embedded Dashboard watchlist card.\n')
  }

  if (wants('dividend-portfolio')) await capturePage({
    id: 'dividend-portfolio',
    route: '/dividend-calculator',
    maxFrames: 8,
    beforeCapture: async () => {
      await loadDividendExample()
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.dc-goal-mode-toggle button')]
          .find(node => node.textContent.trim() === 'Portfolio Growth')
        if (button && button.getAttribute('aria-checked') !== 'true') button.click()
        return true
      })()`)
      await sleep(800)
    },
  })

  if (wants('dividend-income')) await capturePage({
    id: 'dividend-income',
    route: '/dividend-calculator',
    maxFrames: 8,
    beforeCapture: async () => {
      await loadDividendExample()
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('.dc-goal-mode-toggle button')]
          .find(node => node.textContent.trim() === 'Income Growth')
        if (!button) throw new Error('Income Growth control was not found')
        if (button.getAttribute('aria-checked') !== 'true') button.click()
        return true
      })()`)
      await sleep(800)
    },
  })

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
  ws.close()
  process.stdout.write(`Current-screen capture complete: ${REPORT_PATH}\n`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
