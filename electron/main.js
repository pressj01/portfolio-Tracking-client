const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let mainWindow
let flaskProcess

function startFlask() {
  const backendDir = path.join(__dirname, '..', 'backend')
  flaskProcess = spawn('python', ['app.py'], {
    cwd: backendDir,
    env: { ...process.env },
  })
  flaskProcess.stdout.on('data', (data) => console.log(`Flask: ${data}`))
  flaskProcess.stderr.on('data', (data) => console.error(`Flask: ${data}`))
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

  // In dev, load from Vite dev server; in production, load built files
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  startFlask()
  // Give Flask a moment to start
  setTimeout(createWindow, 2000)
})

app.on('window-all-closed', () => {
  if (flaskProcess) {
    flaskProcess.kill()
  }
  app.quit()
})

app.on('before-quit', () => {
  if (flaskProcess) {
    flaskProcess.kill()
  }
})
