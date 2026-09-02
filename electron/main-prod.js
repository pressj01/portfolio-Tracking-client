const { app, BrowserWindow, nativeImage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')
const { spawn, execSync } = require('child_process')

let mainWindow
let flaskProcess
let backendInstanceToken
let startupLogPath
const backendOutputTail = []
app.setAppUserModelId('com.press.portfolio.tracker.client')

function initializeStartupLog() {
  try {
    const userDataDir = app.getPath('userData')
    fs.mkdirSync(userDataDir, { recursive: true })
    startupLogPath = path.join(userDataDir, 'startup.log')
    fs.writeFileSync(
      startupLogPath,
      `[${new Date().toISOString()}] Portfolio Tracking Client ${app.getVersion()} starting\n`,
      'utf8',
    )
  } catch (error) {
    console.error(`Unable to initialize startup log: ${error.message}`)
  }
}

function logStartup(message, { error = false } = {}) {
  const text = String(message).trimEnd()
  if (error) {
    console.error(text)
  } else {
    console.log(text)
  }
  if (!startupLogPath) return
  try {
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${text}\n`, 'utf8')
  } catch (logError) {
    console.error(`Unable to write startup log: ${logError.message}`)
  }
}

function recordBackendOutput(chunk) {
  // Keep a bounded tail of whatever the backend printed. When it dies during
  // startup its last lines are the only evidence of why, and the failure
  // dialog reads them to say something better than "exited with code 1".
  backendOutputTail.push(String(chunk))
  while (backendOutputTail.length > 60) {
    backendOutputTail.shift()
  }
}

function getAppIcon() {
  const filename = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'
  return path.join(__dirname, '..', 'dist', filename)
}

function killStaleBackends() {
  // Kill any orphaned backend processes from previous runs
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /IM backend.exe /F', { stdio: 'ignore' })
    } else {
      execSync('pkill -f flask-backend/backend', { stdio: 'ignore' })
    }
  } catch (e) {
    // No stale processes found — expected
  }
}

function getBackendPath() {
  const exeName = process.platform === 'win32' ? 'backend.exe' : 'backend'
  const isPacked = app.isPackaged
  if (isPacked) {
    return path.join(process.resourcesPath, 'flask-backend', exeName)
  }
  // Dev fallback
  return path.join(__dirname, '..', 'installer', 'flask-dist', 'backend', exeName)
}

function getBackendCwd() {
  const isPacked = app.isPackaged
  if (isPacked) {
    return path.join(process.resourcesPath, 'flask-backend')
  }
  return path.join(__dirname, '..', 'installer', 'flask-dist', 'backend')
}

function getDatabaseDir() {
  const environmentDir = String(process.env.PORTFOLIO_DB_DIR || '').trim()
  if (environmentDir) {
    return path.resolve(environmentDir)
  }

  // An installed copy can be pointed at an existing database directory by
  // placing its absolute path in this file. Keeping the setting in userData
  // makes it survive application updates without baking a machine-specific
  // path into installers used on other computers.
  const databaseDirectoryConfig = path.join(app.getPath('userData'), 'database-directory.txt')
  try {
    const configuredDir = fs.readFileSync(databaseDirectoryConfig, 'utf8').trim()
    if (configuredDir && fs.existsSync(path.join(configuredDir, 'portfolio.db'))) {
      return path.resolve(configuredDir)
    }
    if (configuredDir) {
      console.warn(`Configured database directory is unavailable: ${configuredDir}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to read database directory configuration: ${error.message}`)
    }
  }

  if (app.isPackaged) {
    const repoBackendDir = path.join(process.resourcesPath, '..', '..', '..', 'backend')
    if (process.execPath.includes(`${path.sep}release${path.sep}win-unpacked${path.sep}`)) {
      try {
        const repoDb = path.join(repoBackendDir, 'portfolio.db')
        if (fs.existsSync(repoDb)) return repoBackendDir
      } catch (e) {
        // Fall through to userData for installed builds or inaccessible paths.
      }
    }
  }
  return app.getPath('userData')
}

function startFlask() {
  const exePath = getBackendPath()
  const cwd = getBackendCwd()
  const databaseDir = getDatabaseDir()
  backendInstanceToken = crypto.randomUUID()
  logStartup(`Starting backend: ${exePath}`)
  logStartup(`Working directory: ${cwd}`)
  logStartup(`Database directory: ${databaseDir}`)

  flaskProcess = spawn(exePath, [], {
    cwd: cwd,
    env: {
      ...process.env,
      PORTFOLIO_DB_DIR: databaseDir,
      PORTFOLIO_BACKEND_TOKEN: backendInstanceToken,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',  // Create new process group on macOS/Linux for clean tree kill
  })

  flaskProcess.stdout.on('data', (data) => {
    recordBackendOutput(data)
    logStartup(`Backend: ${data}`)
  })
  flaskProcess.stderr.on('data', (data) => {
    recordBackendOutput(data)
    logStartup(`Backend: ${data}`, { error: true })
  })
  flaskProcess.on('error', (err) => logStartup(`Failed to start backend: ${err.message}`, { error: true }))
  flaskProcess.on('exit', (code) => logStartup(`Backend exited with code: ${code}`))
}

function waitForBackend(port, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      if (flaskProcess && flaskProcess.exitCode !== null) {
        reject(new Error(`Backend exited during startup with code ${flaskProcess.exitCode}`))
        return
      }

      const req = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        timeout: 750,
      }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            const health = JSON.parse(body)
            if (res.statusCode === 200 && health.ok && health.instance_token === backendInstanceToken) {
              resolve()
              return
            }
          } catch {
            // A different process may be answering on the port while our
            // backend is still starting. Keep polling for our instance token.
          }
          retry()
        })
      })

      let retryScheduled = false
      const retry = () => {
        if (retryScheduled) return
        retryScheduled = true
        req.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error('Backend failed to start'))
        } else {
          setTimeout(check, 300)
        }
      }
      req.on('error', retry)
      req.on('timeout', retry)
    }
    check()
  })
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(getAppIcon())
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Load built files — path differs between dev and packaged
  const distPath = app.isPackaged
    ? path.join(__dirname, '..', 'dist', 'index.html')
    : path.join(__dirname, '..', 'dist', 'index.html')
  mainWindow.loadFile(distPath)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon)
  }
}

function killFlask() {
  if (flaskProcess && !flaskProcess.killed) {
    flaskProcess.kill()
    if (process.platform === 'win32') {
      // On Windows, kill the entire process tree
      try {
        require('child_process').execSync(`taskkill /pid ${flaskProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch (e) {
        // Process may already be dead
      }
    } else {
      // On macOS/Linux, kill the entire process group so child processes
      // (e.g. Werkzeug reloader children) don't become orphaned
      try {
        process.kill(-flaskProcess.pid, 'SIGTERM')
      } catch (e) {
        // Process group may already be dead
      }
    }
  }
}

// Windows Code Integrity — Smart App Control on personal PCs, a WDAC policy on
// managed ones — refuses to load binaries it has neither a trusted signature
// nor a reputation for, and the backend's compiled Python extensions are the
// first ones it meets. The block surfaces as an ordinary ImportError, so
// without this the dialog blames the application for a decision Windows made.
const APPLICATION_CONTROL_BLOCK = /Application Control policy|blocked this file/i

function describeStartupFailure(message) {
  if (!APPLICATION_CONTROL_BLOCK.test(backendOutputTail.join(''))) {
    return message
  }

  return [
    'Windows blocked part of this application from loading.',
    '',
    'Smart App Control, or an Application Control policy set by your IT',
    'administrator, refused one of the backend files. The installation is not',
    'damaged, and reinstalling will not change the decision.',
    '',
    'The blocked file is named in Event Viewer, under Applications and',
    'Services Logs > Microsoft > Windows > CodeIntegrity > Operational.',
    '',
    'On a personal PC, Smart App Control can be turned off in Windows Security',
    '> App & browser control. Be aware that Windows does not allow it to be',
    'turned back on afterwards without reinstalling Windows.',
    '',
    'On a work PC, your IT administrator has to allow the application.',
    '',
    `Underlying error: ${message}`,
  ].join('\n')
}

app.whenReady().then(async () => {
  initializeStartupLog()
  killStaleBackends()
  try {
    startFlask()
    // First launch can be substantially slower while Windows Defender,
    // Gatekeeper, or another security product scans the bundled backend.
    await waitForBackend(5001, 60000)
    logStartup('Backend is ready')
    createWindow()
  } catch (err) {
    const logLocation = startupLogPath || 'the application user-data folder'
    logStartup(err.message, { error: true })
    dialog.showErrorBox(
      'Portfolio Tracking Client could not start',
      `${describeStartupFailure(err.message)}\n\nDiagnostic log:\n${logLocation}`,
    )
    killFlask()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  killFlask()
  app.quit()
})

app.on('before-quit', () => {
  killFlask()
})
