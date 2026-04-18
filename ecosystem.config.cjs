const runtimeDir = process.env.MBILL_RUNTIME_DIR || '/opt/bill/current'
const serverScript = process.env.MBILL_SERVER_SCRIPT || 'server.js'

module.exports = {
  apps: [
    {
      name: 'mbill',
      cwd: runtimeDir,
      script: serverScript,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '900M',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
        MBILL_RUNTIME_DIR: runtimeDir,
        MBILL_SERVER_SCRIPT: serverScript
      }
    }
  ]
}
