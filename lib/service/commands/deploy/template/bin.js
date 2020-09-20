const path = require('path')
const pm2 = require('pm2')

// 服务名
const SERVER_NAME = 'node-mock-server'

// 启动服务
function start(argv) {
  pm2.connect((err) => {
    if (err) {
      console.error(err)
      process.exit(2)
    }

    pm2.start(
      {
        name: SERVER_NAME,
        script: path.join(__dirname, 'node_modules/.bin', 'vue-cli-service'),
        cwd: __dirname,
        args: ['serve'].concat(argv),
        exec_mode: 'fork',
        instances: 1,
        kill_timeout: 3000,
        max_memory_restart: '300M',
      },
      (err) => {
        pm2.disconnect()
        if (err) {
          throw err
        }
      }
    )
  })
}

// 关闭服务
function stop() {
  pm2.connect((err) => {
    if (err) {
      console.error(err)
      process.exit(2)
    }

    pm2.stop(SERVER_NAME, (err) => {
      pm2.disconnect()
      if (err) {
        throw err
      }
    })
  })
}

// 执行服务
const argv = process.argv
const cmd = argv[3]
if (cmd === 'start') {
  start(argv.slice(4))
} else if (cmd === 'stop') {
  stop()
}
