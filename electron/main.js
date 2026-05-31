const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const http = require('http')
const { spawn, execSync } = require('child_process')

// In dev, Electron loads the UI from the Vite dev server and talks to a Flask
// backend on port 5001. The backend's database lives in backend/portfolio.db
// (config.py falls back there when PORTFOLIO_DB_DIR is unset). The packaged
// build uses electron/main-prod.js instead, so this file is the dev entry.
const isDev = process.env.NODE_ENV !== 'production'

const PROJECT_ROOT = path.join(__dirname, '..')
const BACKEND_DIR = path.join(PROJECT_ROOT, 'backend')
const FLASK_HEALTH_URL = 'http://127.0.0.1:5001/api/profiles'
const VITE_URL = 'http://localhost:5173'

let mainWindow
// Only set when WE spawned the process — so we don't kill a server the user
// started themselves (e.g. via `npm run dev:all` in a terminal).
let flaskProcess = null
let viteProcess = null

function killTree(proc) {
  if (!proc) return
  try {
    // Kill the whole tree (py launcher + python.exe child, or npm + vite child)
    execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' })
  } catch {
    try { proc.kill() } catch {}
  }
}

// Resolve true if something answers an HTTP request at `url`, false otherwise.
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1500, () => { req.destroy(); resolve(false) })
  })
}

// Poll `url` until it responds or `timeoutMs` elapses.
function waitFor(url, { timeoutMs = 45000, intervalMs = 500 } = {}) {
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = async () => {
      if (await ping(url)) return resolve(true)
      if (Date.now() - start > timeoutMs) return resolve(false)
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

function startFlask() {
  // Dev: leave PORTFOLIO_DB_DIR unset so config.py uses backend/portfolio.db —
  // the same database used when launching Flask from a terminal. (Setting it to
  // Electron's userData folder would point at a separate, empty database.)
  const env = { ...process.env }
  if (!isDev) {
    env.PORTFOLIO_DB_DIR = app.getPath('userData')
  }
  flaskProcess = spawn('py', ['app.py'], { cwd: BACKEND_DIR, env })
  flaskProcess.stdout.on('data', (data) => console.log(`Flask: ${data}`))
  flaskProcess.stderr.on('data', (data) => console.error(`Flask: ${data}`))
  flaskProcess.on('exit', (code) => {
    console.error(`Flask process exited (code ${code})`)
    flaskProcess = null
  })
}

function startVite() {
  // shell:true so Windows resolves npm.cmd correctly.
  viteProcess = spawn('npm', ['run', 'dev'], {
    cwd: PROJECT_ROOT,
    shell: true,
    env: { ...process.env },
  })
  viteProcess.stdout.on('data', (data) => console.log(`Vite: ${data}`))
  viteProcess.stderr.on('data', (data) => console.error(`Vite: ${data}`))
  viteProcess.on('exit', (code) => {
    console.error(`Vite process exited (code ${code})`)
    viteProcess = null
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL(VITE_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function boot() {
  // Start the backend only if nothing is already serving on 5001. This lets the
  // icon work on its own, while also coexisting with a Flask/Vite already
  // running from `npm run dev:all` (we reuse those instead of double-binding).
  if (!(await ping(FLASK_HEALTH_URL))) {
    startFlask()
  }
  if (isDev && !(await ping(VITE_URL))) {
    startVite()
  }

  // Wait until both servers actually respond before opening the window — no more
  // blind 2-second guess that opens a broken UI when the backend isn't up.
  const flaskOk = await waitFor(FLASK_HEALTH_URL)
  const viteOk = isDev ? await waitFor(VITE_URL) : true

  if (!flaskOk || !viteOk) {
    const missing = [
      !flaskOk && 'backend (Flask, port 5001)',
      !viteOk && 'frontend (Vite, port 5173)',
    ].filter(Boolean).join(' and ')
    dialog.showErrorBox(
      'Portfolio Tracker failed to start',
      `The ${missing} did not come up in time.\n\n` +
      'Check that Python ("py") and Node ("npm") are installed and on PATH, ' +
      'and that ports 5001/5173 are free, then relaunch.\n\n' +
      'You can also start everything from a terminal with: npm run dev:all',
    )
    killTree(flaskProcess)
    killTree(viteProcess)
    app.quit()
    return
  }

  createWindow()
}

app.whenReady().then(boot)

app.on('window-all-closed', () => {
  killTree(flaskProcess)
  killTree(viteProcess)
  app.quit()
})

app.on('before-quit', () => {
  killTree(flaskProcess)
  killTree(viteProcess)
})
