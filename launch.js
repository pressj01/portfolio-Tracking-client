const { spawn } = require('child_process')

// Launch the Electron shell so Windows uses the app icon in the taskbar.
// electron/main.js starts or reuses Flask and Vite as needed.
const electron = spawn('npm', ['run', 'electron'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
})

electron.on('exit', (code) => {
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  electron.kill()
  process.exit()
})
