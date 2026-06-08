const { spawn } = require('child_process')

// Use the dev Electron shell for local work so the app reads backend/portfolio.db,
// the same database used by Flask from the terminal.
const child = spawn('npm', ['run', 'electron'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  child.kill()
  process.exit()
})
