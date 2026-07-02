const { spawnSync } = require('child_process')

const scriptArgs = process.argv.slice(2)
if (!scriptArgs.length) {
  console.error('Usage: node scripts/run-python.js <script.py> [args...]')
  process.exit(2)
}

const candidates = process.platform === 'win32'
  ? [['py'], ['python'], ['python3']]
  : [['python3'], ['python']]

for (const [command] of candidates) {
  const result = spawnSync(command, scriptArgs, { stdio: 'inherit' })
  if (result.error?.code === 'ENOENT') continue
  if (result.error) {
    console.error(`Could not launch ${command}: ${result.error.message}`)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

console.error('Python was not found. Install Python 3 or make it available on PATH.')
process.exit(1)
