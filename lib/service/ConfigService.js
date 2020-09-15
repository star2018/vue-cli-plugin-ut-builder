const { merge } = require('webpack-merge')
const chalk = require('chalk')
const debug = require('debug')('plugin:service:config')
//
const getEnv = require('../utils/env')
const logger = require('../utils/logger')
const fileUtil = require('../utils/file')
const restart = require('../utils/restart')
const emitter = require('../utils/emitter')
const pkgUtil = require('../utils/package')

const { registerShutdown, resolvePackage, watch } = require('../utils/common')
//
const Plugin = require('../plugin')
const registerLoaderPlugins = require('../plugin/babel/registerLoaderPlugins')

const {
  lib: appPkgLib,
  main: appPkgMain,
  assets: appAssets,
} = require('../utils/appPackages')

// 配置服务
// 用于通过配置形式使用插件服务
class ConfigService {
  //
  constructor(setup) {
    const { plugin, options } = setup
    this.plugin = plugin
    this.options = options
    const { pluginOptions } = options
    if (
      pluginOptions === null ||
      typeof pluginOptions !== 'object' ||
      Array.isArray(pluginOptions)
    ) {
      options.pluginOptions = {}
    }
    const { preprocess, service } = options.pluginOptions
    if (service === null || typeof service !== 'object' || Array.isArray(service)) {
      options.pluginOptions.service = {}
    }

    // 添加默认启用的服务
    ConfigService.addDefaultService('define')
    if (preprocess && process.env.NODE_ENV === 'development') {
      ConfigService.addDefaultService('watch')
    }
    // 安装app依赖包
    this.installIceFox(options)
  }

  installIceFox(options) {
    try {
      // 添加转译支持
      const appMain = appPkgMain.replace(/\\/g, '/')
      const appLib = appPkgLib.replace(/\\/g, '/')
      ConfigService.addTranspileDependency((path) => {
        const normalPath = path.replace(/\\/g, '/')
        return normalPath === appMain || normalPath.startsWith(appLib)
      })

      // 添加svg图标构建支持
      const {
        pluginOptions: {
          service: { svgIcon },
        },
      } = options
      options.pluginOptions.service.svgIcon = [
        svgIcon,
        {
          src: fileUtil.joinPath(appAssets, 'icons'),
          prefix: 'ice-icon',
          kebabCaseName: true,
        },
      ]

      // 写入依赖
      const pkg = pkgUtil.read()
      const { icefox: icefoxDeps } = Object.assign({}, pkg.dependencies)
      if (!icefoxDeps) {
        const version = pkgUtil.read({
          cwd: fileUtil.joinPath(__dirname, '../../'),
          cache: false,
        }).dependencies.icefox
        // 添加工程依赖（代码提示支持）
        pkgUtil.write({
          dependencies: {
            icefox: version,
          },
        })
      }
    } catch (e) {
      debug('icefox not installed: %s', e.message)
    }
  }

  checkService(services) {
    const {} = this
    const { removeConsole, removeDebugger } = services
    if (removeDebugger) {
      services['removeDebugger'] = Object.assign({}, removeConsole, removeDebugger)
      delete services['removeConsole']
    }
    return services
  }

  // 链式配置
  chainWebpack() {
    // 添加默认的chain处理回调
    for (const fn of ConfigService.defaultChainWebpack) {
      this.plugin.chainWebpack(fn)
    }

    //  参数为 chainable webpack 实例
    this.plugin.chainWebpack((chainConfig) => {
      const api = this.plugin
      const projectOptions = this.options
      const { pluginOptions } = projectOptions
      const { service: serviceConfig } = pluginOptions

      //
      const env = getEnv()
      const args = env.args
      const rawArgv = env.rawArgv
      const command = getEnv.command
      const commandList = getEnv.commandList
      const NODE_ENV = env.NODE_ENV
      const isDev = NODE_ENV === 'development'
      const isTest = NODE_ENV === 'test'
      const isProd = NODE_ENV === 'production'
      const modernApp = !!env.VUE_CLI_MODERN_MODE
      const modernBuild = !!env.VUE_CLI_MODERN_BUILD
      //
      console.log()
      //
      for (const [name, serviceOptions] of Object.entries(
        this.checkService(serviceConfig)
      )) {
        const serve = ConfigService.getService(name)
        if (!serve) {
          continue
        }
        // 执行服务
        const enabled = serve(
          {
            api,
            plugin: new Plugin({
              chainConfig,
              projectOptions,
              serviceOptions,
            }),
            config: chainConfig,
            isDev,
            isDevelopment: isDev,
            isTest,
            isProd,
            isProduction: isProd,
            env,
            args,
            rawArgv,
            command,
            commandList,
            modernApp,
            modernBuild,
            merge,
            registerShutdown,
            watch,
          },
          serviceOptions,
          projectOptions
        )
        if (enabled !== false) {
          logger.info(`Register service 🚀 '${name}'`)
        }
      }

      console.log()
      // 应用于拦截的默认链式配置
      ConfigService.chainDefaultWebpack(chainConfig)
      this.setTranspileDependencies(chainConfig)
      this.setEntryDependencies(chainConfig)
    })
  }

  // 简单配置
  configureWebpack() {
    // 参数为原始到webpack配置对象
    return this.plugin.configureWebpack((/*webpackConfig*/) => {
      // 返回的配置会被调用方合并
      return {
        plugins: [],
      }
    })
  }

  // 开发服务配置
  configureDevServer() {
    // 参数为 express app 实例
    this.plugin.configureDevServer((express, devServer) => {
      this.devServer = devServer
      if (process.env.NODE_ENV === 'development') {
        // 启用跨域访问中间件
        this.enableCORSMiddleware()
        //
        emitter.once('restart', (reason) => {
          logger.warn(
            chalk.bold.bgYellow.black(
              `Since ${reason}, you may be need to restart the server.`
            )
          )
          // this.restart(reason)
        })
        emitter.on('invalidate', (config, callback) => {
          // 触发webpack重新编译
          this.devServer.invalidate(callback)
        })
      }
    })
  }

  // 跨域访问中间件
  enableCORSMiddleware() {
    const { devServer } = this
    if (devServer) {
      devServer.use(
        require('cors')({
          // optionsSuccessStatus: 200,
          preflightContinue: true,
          origin: true,
          credentials: true,
        })
      )
    }
  }

  // 代理服务器配置
  configureProxyServer() {
    // 配置代理服务器
    new Plugin({
      projectOptions: this.options,
    }).configureProxyServer((config) => {
      const { onProxyRes, onProxyReqWs, target, headers } = config
      Object.assign(config, {
        onProxyReqWs: proxyFunc(onProxyReqWs, (proxyReq) => {
          proxyReq.setHeader('X-Proxy-Socket-Remote', target)
        }),
        onProxyRes: proxyFunc(onProxyRes, (proxyRes, req, res) => {
          // 将远程转发地址加到响应头里
          proxyRes.headers['X-Proxy-Remote'] = target
          // 保存代理响应的内容
          let body = Buffer.from('')
          proxyRes.on('data', (chunk) => {
            body = Buffer.concat([body, chunk])
          })
          proxyRes.on('end', () => {
            res.rawBody = body
          })
        }),
        headers: Object.assign({ 'X-Proxy-Remote': target }, headers),
      })
    })
  }

  // 启用默认的服务
  enableDefaultService() {
    const defaultServices = ConfigService.defaultEnabledServices
    const projectOptions = this.options
    const { pluginOptions } = projectOptions
    const { service: serviceConfig } = pluginOptions

    for (const [name, options] of Object.entries(defaultServices)) {
      const config = serviceConfig[name]
      if (!config) {
        serviceConfig[name] = options || true
        continue
      }
      if (typeof config !== 'object' || Array.isArray(config)) {
        serviceConfig[name] = config
      } else {
        serviceConfig[name] = Object.assign({}, options, config)
      }
    }
  }

  setTranspileDependencies(chainConfig) {
    const dependencies = ConfigService.transpileDependencies.map((item) => {
      if (typeof item === 'string') {
        item = fileUtil.getAbsPath(item)
      }
      return item
    })
    if (!dependencies.length) {
      return
    }
    const jsRule = chainConfig.module.rule('js')
    const includeHandler = (filePath) => {
      for (const dep of dependencies) {
        if (typeof dep === 'string') {
          if (dep.replace(/\\/g, '/') === filePath.replace(/\\/g, '/')) {
            return true
          }
        } else if (dep instanceof RegExp) {
          if (dep.test(filePath)) {
            return true
          }
        } else if (typeof dep === 'function') {
          if (dep(filePath)) {
            return true
          }
        }
      }
      return false
    }
    const excludeCondition = jsRule.exclude
    for (const exclude of excludeCondition.values()) {
      if (typeof exclude === 'function') {
        // vue cli 默认会阻止 node_modules 目录下文件的转译
        excludeCondition.delete(exclude)
        excludeCondition.add((filePath) => {
          if (includeHandler(filePath)) {
            return false
          }
          return exclude(filePath)
        })
      }
    }
  }

  setEntryDependencies(chainConfig) {
    const dependencies = ConfigService.entryDependencies.map((item) => {
      if (typeof item === 'string') {
        item = fileUtil.getAbsPath(item)
      }
      return item
    })
    if (!dependencies.length) {
      return
    }
    new Plugin({
      chainConfig,
      projectOptions: this.options,
    }).use(
      {
        pluginName: 'CompilerEvent',
        configName: 'entry-dependencies',
      },
      () => [
        'EntryDependenciesPlugin',
        {
          entryOption: (context, entry) => {
            Object.keys(entry).forEach((key) => {
              const page = entry[key]
              if (Array.isArray(page)) {
                entry[key] = page.concat(dependencies.concat(page.pop()))
              } else {
                entry[key] = dependencies.concat(page)
              }
            })
          },
        },
      ]
    )
  }

  restart(reason) {
    const devServer = this.devServer
    if (!devServer) {
      debug('Server is not ready, restart does not work.')
      return
    }
    if (reason) {
      logger.info(`Since ${chalk.cyan(reason)}, try to restart server...`)
    } else {
      logger.info(`Try to restart server...`)
    }
    // 目前没有暂未灵活实现重启
    emitter.emit('before-restart')
    devServer.close(restart)
  }
}

// 代理回调函数
function proxyFunc(original, proxy, context) {
  if (typeof original === 'function') {
    return (...args) => {
      original.apply(context, args)
      proxy.apply(context, args)
    }
  } else {
    return context ? proxy.bind(context) : proxy
  }
}

// 设置resolve别名
function setResolveAlias(config) {
  const alias = {
    icefox$: appPkgMain,
  }

  try {
    const { path } = resolvePackage('vue')
    alias['vue$'] = fileUtil.joinPath(path, 'dist/vue.esm.js')
  } catch (e) {}

  for (const [key, value] of Object.entries(alias)) {
    config.resolve.alias.set(key, value)
  }
}

// 已注册的服务
ConfigService.services = {}
ConfigService.defaultEnabledServices = {}

ConfigService.defaultChainWebpack = []

ConfigService.transpileDependencies = []
ConfigService.entryDependencies = []

// 添加默认启用的服务配置
ConfigService.addDefaultService = function (service, options) {
  if (typeof service === 'string') {
    const name = service
    service = {}
    service[name] = options
  }
  if (service && typeof service === 'object') {
    const defaultServices = ConfigService.defaultEnabledServices
    for (const [name, setup] of Object.entries(service)) {
      if (!setup) {
        if (!defaultServices[name]) {
          defaultServices[name] = true
        }
        continue
      }
      if (typeof setup !== 'object' || Array.isArray(setup)) {
        defaultServices[name] = setup
      } else {
        defaultServices[name] = Object.assign({}, options, setup)
      }
    }
  }
}

// 默认的配置处理函数
ConfigService.addChainWebpack = function (fn) {
  if (typeof fn === 'function') {
    ConfigService.defaultChainWebpack.push(fn)
  }
}

// 添加需要转译的依赖
ConfigService.addTranspileDependency = function (deps) {
  ConfigService.transpileDependencies.push(deps)
}

// 添加入口依赖
ConfigService.addEntryDependency = function (deps) {
  ConfigService.entryDependencies.push(deps)
}

// 配置默认的chain操作
ConfigService.chainDefaultWebpack = function (chainConfig) {
  // alias
  setResolveAlias(chainConfig)
  //
  try {
    // @babel/plugin-proposal-export-namespace-from
    // 支持 export * as xxx from 'xxx'
    registerLoaderPlugins(chainConfig, {
      name: '@babel/plugin-proposal-export-namespace-from',
      alias: ['proposal-export-namespace-from'],
      options: {},
    })
  } catch (e) {
    debug(e.message)
  }
  try {
    // @babel/plugin-proposal-export-default-from
    // 支持 export default from 'xxx'
    registerLoaderPlugins(chainConfig, {
      name: '@babel/plugin-proposal-export-default-from',
      alias: ['proposal-export-default-from'],
      options: {},
    })
  } catch (e) {
    debug(e.message)
  }
}

// 注册服务
ConfigService.registerService = function (name, service) {
  if (typeof name !== 'string') {
    logger.error(`\n[registerService] The type of name must be a string. (${name})\n`)
    process.exit(1)
  }
  const services = ConfigService.services
  const hyphenName = name.replace(/([A-Z]+)/g, '-$1').toLowerCase()
  if (Object.prototype.hasOwnProperty.call(services, hyphenName)) {
    logger.error(`\n[registerService] The service name of '${name}' already exists.\n`)
    process.exit(1)
  }
  if (typeof service !== 'function') {
    logger.error(`\n[registerService] Service must be a function. (${name})\n`)
    process.exit(1)
  }
  services[hyphenName] = service
  debug(`Register service 👉 '${name}'`)
}

// 获取服务
ConfigService.getService = function (name) {
  if (typeof name === 'string') {
    const services = ConfigService.services
    // 将驼峰名转换为连字符名称
    const hyphenName = name.replace(/([A-Z]+)/g, '-$1').toLowerCase()
    if (Object.prototype.hasOwnProperty.call(services, hyphenName)) {
      return services[hyphenName]
    }
    const dll = ConfigService.loadDLL(name)
    if (dll) {
      return dll
    }
  }
  logger.warn(`[getService] Service load failed. (${name})`)
}

// 加载内部服务
ConfigService.loadDLL = function (name) {
  let service = null
  try {
    service = require(`./dll/${name}`)
    ConfigService.registerService(name, service)
  } catch (e) {}
  return service
}

// 加载所有内部服务
ConfigService.loadAllDLL = function () {
  for (const name of fileUtil.getFileName('dll/*.js', {
    noExt: true,
    cwd: __dirname,
  })) {
    ConfigService.registerService(name, require(`./dll/${name}`))
  }
}

//
module.exports = ConfigService
