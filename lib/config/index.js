//
const lodashMerge = require('lodash/merge')
const mergeWebpack = require('webpack-merge')
const anymatch = require('anymatch')
//
const logger = require('../utils/logger')
const getEnv = require('../utils/env')
const entryManager = require('../app/entryManager')
//
const PluginProxy = require('./ConfigPluginProxy')
const ConfigProxy = require('../service/ConfigService')

//
const defaultConfig = require('./default')

// 配置生成
class Config {
  //
  constructor(setup, usedAsService) {
    setup = Object.assign({}, setup)
    let { pluginOptions } = setup
    pluginOptions = Object.assign({}, pluginOptions)
    const { service, services } = pluginOptions
    delete pluginOptions['services']

    setup.pluginOptions = Object.assign(pluginOptions, {
      // 兼容使用 services 配置属性名
      service: Object.assign({}, service, services),
    })

    this.options = lodashMerge(defaultConfig(), setup)
    this.usedAsService = !!usedAsService
  }

  // 输出配置对象
  toConfig() {
    const projectOptions = this.options
    projectOptions.pages = entryManager(projectOptions).toEntryPoints()
    projectOptions.chainWebpack = this.toChainWebpack()
    projectOptions.configureWebpack = this.toConfigureWebpack()
    // 对开发服务器进行配置
    this.configureDevServer()
    // 返回工程构建配置
    return projectOptions
  }

  configureDevServer() {
    const { options: projectOptions } = this
    const devServer = Object.assign({}, projectOptions.devServer)
    const watchOptions = Object.assign({}, devServer.watchOptions)
    const { ignored } = watchOptions
    const { open, before } = devServer
    const { transpileDependencies, entryDependencies } = ConfigProxy
    const devServerOptions = {
      ...devServer,
      watchOptions: {
        ...watchOptions,
        // 文件watch会默认排除node_modules目录，这里处理下
        ignored(filePath) {
          if (
            // icefox、.code、.assets目录需要进行watch
            // 被添加的依赖文件需要watch
            /([/\\])(?:icefox|\.code|\.assets)(?:\1|$)(?!node_modules)/.test(filePath) ||
            anymatch(transpileDependencies, filePath) ||
            anymatch(entryDependencies, filePath)
          ) {
            return false
          }
          if (ignored && anymatch(ignored, filePath)) {
            return true
          }
          return /node_modules/.test(filePath)
        },
      },
    }
    if (open) {
      // webpack-dev-server 与 vue-cli 会重复打开浏览器
      // 这里屏蔽掉 dev-server 打开浏览器的操作
      devServerOptions.before = function (app, server, ...others) {
        const { options } = server
        if (options !== null && typeof options === 'object') {
          options.open = false
        }
        if (typeof before === 'function') {
          before.apply(this, [app, server, ...others])
        }
      }
    }
    projectOptions.devServer = devServerOptions
  }

  // 构建链式配置服务
  toChainWebpack() {
    const options = this.options
    const { chainWebpack } = options
    return (chainConfig) => {
      if (typeof chainWebpack === 'function') {
        // 调用用户链式服务
        chainWebpack(chainConfig, options)
      }
      if (!this.usedAsService) {
        // 挂载内部插件服务
        new ConfigProxy({
          plugin: new PluginProxy({ chainConfig }),
          options,
          // 执行链式配置
        }).chainWebpack()
      }
    }
  }

  // 构造简单配置服务
  toConfigureWebpack() {
    const options = this.options
    const { configureWebpack } = options
    return (rawWebpack) => {
      let webpackConfig
      if (typeof configureWebpack === 'function') {
        // 调用用户配置服务
        webpackConfig = configureWebpack(rawWebpack, options)
      } else {
        // 简单配置对象
        webpackConfig = configureWebpack
      }
      if (!this.usedAsService) {
        if (webpackConfig && typeof webpackConfig === 'object') {
          // 合并webpack配置
          rawWebpack = mergeWebpack(rawWebpack, webpackConfig)
        }
        // 调用内部简单配置服务
        return new ConfigProxy({
          plugin: new PluginProxy({ rawWebpack }),
          options,
        }).configureWebpack()
      }
      //
      return webpackConfig
    }
  }
}

module.exports = (options, usedAsService) => {
  const config = new Config(options, usedAsService).toConfig()
  // 注册应用已配置环境变量
  const envSetup = getEnv()
  envSetup.registerVariables('ICE_BUILD_ENTRY_CONFIGURED', true)
  if (!process.env.ICE_BUILD_CONFIGURE_PRINTED) {
    // 打印关键配置信息
    logger.print({
      env: envSetup.ICE_BUILD_ENTRY_SETUP,
      data: envSetup.ICE_DATA_APP_DEFINED,
      entry: envSetup.ICE_BUILD_ENTRY_POINTS,
    })
    process.env.ICE_BUILD_CONFIGURE_PRINTED = '1'
  }

  return config
}
