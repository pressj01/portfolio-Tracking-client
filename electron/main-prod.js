const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const net = require('net')

let mainWindow
let flaskProcess

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

function startFlask() {
  const exePath = getBackendPath()
  const cwd = getBackendCwd()
  console.log('Starting backend:', exePath)
  console.log('Working directory:', cwd)

  flaskProcess = spawn(exePath, [], {
    cwd: cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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
}

function killFlask() {
  if (flaskProcess && !flaskProcess.killed) {
    flaskProcess.kill()
    // On Windows, also kill the process tree
    if (process.platform === 'win32') {
      try {
        require('child_process').execSync(`taskkill /pid ${flaskProcess.pid} /T /F`, { stdio: 'ignore' })
      } catch (e) {
        // Process may already be dead
      }
    }
  }
}

app.whenReady().then(async () => {
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
