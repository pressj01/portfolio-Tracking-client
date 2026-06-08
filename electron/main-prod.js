const { app, BrowserWindow, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')
const net = require('net')

let mainWindow
let flaskProcess
app.setAppUserModelId('com.press.portfolio.tracker.client')

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
  console.log('Starting backend:', exePath)
  console.log('Working directory:', cwd)
  console.log('Database directory:', databaseDir)

  flaskProcess = spawn(exePath, [], {
    cwd: cwd,
    env: { ...process.env, PORTFOLIO_DB_DIR: databaseDir },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',  // Create new process group on macOS/Linux for clean tree kill
  })

  flaskProcess.stdout.on('data', (data) => console.log(`Flask: ${data}`))
  flaskProcess.stderr.on('data', (data) => console.error(`Flask: ${data}`))
  flaskProcess.on('error', (err) => console.error('Failed to start backend:', err))
  flaskProcess.on('exit', (code) => console.log('Backend exited with code:', code))
}

function waitForBackend(port, timeout) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = () => {
      const socket = new net.Socket()
      socket.setTimeout(500)
      socket.on('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error('Backend failed to start'))
        } else {
          setTimeout(check, 300)
        }
      })
      socket.on('timeout', () => {
        socket.destroy()
        setTimeout(check, 300)
      })
      socket.connect(port, '127.0.0.1')
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

app.whenReady().then(async () => {
  killStaleBackends()
  startFlask()
  try {
    await waitForBackend(5001, 15000)
    console.log('Backend is ready')
    createWindow()
  } catch (err) {
    console.error(err.message)
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
