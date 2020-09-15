//
const webpack = require('../../plugin/webpack')
//
const commonUtil = require('../../utils/common')
const emitter = require('../../utils/emitter')
const getEnv = require('../../utils/env')

function getRuntimeValue(key) {
  const defined = getEnv.ENV.ICE_DATA_PROCESS_DEFINED
  return JSON.stringify(defined[key])
}

function getDefinedEnv(args, env, options) {
  const prop = 'process.env'
  const arg = Object.assign({}, args[0])
  const appData = env.ICE_DATA_PROCESS_DEFINED
  //
  arg[prop] = Object.assign(
    {},
    arg[prop],
    // 配置文件中的数据
    Object.keys(options).reduce((data, key) => {
      data[key] = JSON.stringify(options[key])
      return data
    }, {}),
    // 环境变量里的数据
    Object.keys(appData).reduce((data, key) => {
      // 声明为运行时值，可重编译
      data[key] = webpack.DefinePlugin.runtimeValue(() => getRuntimeValue(key), true)
      return data
    }, {})
  )
  //
  return [arg]
}

function reloadEnv() {
  const dotenv = require('dotenv')
  const path = require('path')
  const fs = require('fs')
  const envFiles = ['.env.development.local', '.env.development', '.env.local', '.env']
  const env = process.env
  // 清除原来的值
  Object.keys(env).forEach((key) => {
    if (/^(?:vue_)?app_.+$/i.test(key)) {
      delete env[key]
    }
  })
  // 加载环境变量文件
  for (const file of envFiles) {
    try {
      const absPath = path.resolve(file)
      if (fs.existsSync(absPath)) {
        dotenv.config({ path: absPath })
      }
    } catch (e) {}
  }
  // 刷新环境变量定义
  return getEnv()
}

// 环境变量定义
module.exports = ({ plugin, env, isDev }, options) => {
  //
  options = Object.assign({}, options)
  //
  plugin.use('define', (args) => {
    return getDefinedEnv(args, env, options)
  })
  //
  if (isDev) {
    commonUtil.watch(
      '.env?(.development)?(.local)',
      () => {
        // 刷新环境变量定义
        const env = reloadEnv()
        emitter.emit('env-change', env)
        emitter.emit('invalidate', 'env file has been changed')
      },
      { delay: 300, cwd: process.cwd() }
    )
  }
}
