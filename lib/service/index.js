const getEnv = require('../utils/env')
const strUtil = require('../utils/string')
const ConfigService = require('./ConfigService')
const CommandService = require('./CommandService')
const Plugin = require('../plugin')
const configManager = require('../config')

let configured = false

// 导出插件服务
exports = module.exports = (api, projectOptions) => {
  if (configured) {
    return
  }

  const isHelp = getEnv.isHelp
  const isDevelopment = process.env.NODE_ENV === 'development'

  if (isDevelopment && !isHelp) {
    // 捕捉异常，防止进程退出
    process.on('uncaughtException', (err) => {
      console.error(err ? err.message || err : 'uncaughtException')
    })
  }

  //
  if (process.env.ICE_BUILD_DLL_REFERENCE_FORK) {
    // fork出来的进程
    api.chainWebpack((chain) => {
      require('../plugin/webpack/DllReference/config')(chain, process.cwd())
    })
    return
  }

  const env = getEnv()

  // 以插件形式被调用
  if (!isHelp && !env['ICE_BUILD_ENTRY_CONFIGURED']) {
    // 需要对应用进行配置
    Object.assign(
      projectOptions,
      configManager(require('../utils/userConfig') || projectOptions, true)
    )
    const { publicPath, outputDir } = projectOptions
    if (typeof publicPath === 'string') {
      projectOptions.publicPath = strUtil.ensureSlash(publicPath).replace(/^\.\//, '')
    }
    projectOptions.outputDir = strUtil.removeSlash(outputDir)
  }

  //
  const service = new ConfigService({
    plugin: api,
    options: projectOptions,
  })

  // 注册命令行服务
  new CommandService({
    plugin: api,
    options: projectOptions,
  }).registerCommand()

  if (!isHelp) {
    // 加载用户自定义定插件和服务
    const { pluginOptions } = projectOptions
    const { registerService, registerPlugin } = pluginOptions

    if (registerService && typeof registerService === 'object') {
      // 注册用户服务
      for (const [name, serve] of Object.entries(registerService)) {
        ConfigService.registerService(name, serve)
      }
    }
    if (registerPlugin && typeof registerPlugin === 'object') {
      // 注册用户插件
      for (const [name, plugin] of Object.entries(registerPlugin)) {
        Plugin.registerPlugin(name, plugin)
      }
    }

    // 启用默认服务
    service.enableDefaultService()

    if (isDevelopment) {
      // 配置开发服务器
      service.configureDevServer()
    }

    // 配置webpack
    service.chainWebpack()
    service.configureWebpack()

    //
    if (isDevelopment) {
      // 配置代理服务器
      service.configureProxyServer()
    }
  }

  //
  configured = true
}

// 导出注册服务
exports.registerService = ConfigService.registerService
// 导出注册插件
exports.registerPlugin = Plugin.registerPlugin
// 命令模式定义
exports.defaultModes = CommandService.commandModes
