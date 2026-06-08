const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Prefer the packaged executable because Windows gets the taskbar icon from
// the .exe itself. Fall back to dev Electron when no packaged build exists.
const packagedExe = path.join(
  __dirname,
  'release',
  'win-unpacked',
  'Portfolio Tracking Client.exe',
)
const hasPackagedExe = fs.existsSync(packagedExe)

const child = spawn(hasPackagedExe ? packagedExe : 'npm', hasPackagedExe ? [] : ['run', 'electron'], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: !hasPackagedExe,
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})

process.on('SIGINT', () => {
  child.kill()
  process.exit()
})
