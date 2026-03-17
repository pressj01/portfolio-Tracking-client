const { spawn, exec } = require('child_process')
const path = require('path')
const http = require('http')
const projectDir = __dirname

// Start Flask backend
const flask = spawn('py', ['backend/app.py'], {
  cwd: projectDir,
  stdio: 'inherit',
  shell: true,
})

// Start Vite dev server
const vite = spawn('npx', ['vite'], {
  cwd: projectDir,
  stdio: 'inherit',
  shell: true,
})

// Wait for Vite to be ready, then open browser
function waitAndOpen() {
  const req = http.get('http://localhost:5173', () => {
    exec('start http://localhost:5173')
  })
  req.on('error', () => {
    setTimeout(waitAndOpen, 500)
  })
}

setTimeout(waitAndOpen, 2000)

// Keep running until Ctrl+C
process.on('SIGINT', () => {
  flask.kill()
  vite.kill()
  process.exit()
})
