const debug = require('debug')('service:entry')
// require('debug').enable('service:entry')
//
const getEnv = require('../utils/env')
const logger = require('../utils/logger')
const fileUtil = require('../utils/file')
const commonUtil = require('../utils/common')
const emitter = require('../utils/emitter')
const ConfigService = require('../service/ConfigService')

const generate = require('./generatorManager')
const defaultBuildConfig = require('./default')

// 构建入口管理器
class EntryManager {
  //
  constructor(projectOptions) {
    this.env = getEnv()
    this.options = projectOptions = Object.assign({}, projectOptions)
    const { pluginOptions, publicPath } = projectOptions
    const { preprocess, htmlTemplate, moduleEntry, service } = Object.assign(
      {},
      pluginOptions
    )
    const { mock } = Object.assign({}, service)
    const { args, registerVariables } = this.env
    const isProd = process.env.NODE_ENV === 'production'

    const entry = args.entry
    this.config = this.getConfig(preprocess)
    const config = this.config

    if (config['build_app_router_mode'] === '') {
      if (isProd) {
        config['build_app_router_mode'] = config['build_mpa'] ? 'history' : 'hash'
      } else {
        config['build_app_router_mode'] = 'hash'
      }
    }

    this.httpMock = !!mock && mock.http !== false && !isProd

    if (htmlTemplate && typeof htmlTemplate === 'string') {
      config['build_html_template'] = htmlTemplate
    }
    if (entry && typeof entry === 'string') {
      config['build_module_entry'] = entry
    } else if (moduleEntry && typeof moduleEntry === 'string') {
      config['build_module_entry'] = moduleEntry
    }

    this.publicPath =
      typeof publicPath === 'string' && publicPath !== '/'
        ? `/${publicPath.replace(/(?:^\/+)|(?:\/+$)/g, '')}/`
        : '/'
    this.context = preprocess ? this.getRootPath() : ''
    config['build_module_root'] = fileUtil
      .relativePath(process.cwd(), this.context)
      .replace(/^\.\//, '')

    let entrySetup = Object.assign({}, config)
    if (preprocess) {
      const { build_router_params_symbol, build_router_view_symbol } = entrySetup
      if (!build_router_params_symbol) {
        logger.error(`\nThe symbol of router params cannot be empty.\n`)
        process.exit(1)
      } else if (!build_router_view_symbol) {
        logger.error(`\nThe symbol of named router-view cannot be empty.\n`)
        process.exit(1)
      } else if (build_router_params_symbol === build_router_view_symbol) {
        logger.error(
          `\nThe router symbol cannot be equal. (${build_router_params_symbol})\n`
        )
        process.exit(1)
      } else {
        const reservedSymbol = ['[', '~']
        if (reservedSymbol.includes(build_router_params_symbol)) {
          logger.error(
            `\nThe symbol of router params cannot be reserved symbol ${build_router_params_symbol}.\n`
          )
          process.exit(1)
        } else if (reservedSymbol.includes(build_router_view_symbol)) {
          logger.error(
            `\nThe symbol of named router-view cannot be reserved symbol ${build_router_view_symbol}.\n`
          )
          process.exit(1)
        }
      }

      process.env.ice_build_router_params_symbol = build_router_params_symbol
      process.env.ice_build_router_view_symbol = build_router_view_symbol

      const { appPlugins } = Object.assign({}, preprocess)
      if (appPlugins === false) {
        config.build_app_plugins = ''
        entrySetup.build_app_plugins = ''
      } else if (typeof appPlugins === 'string') {
        config.build_app_plugins = appPlugins
        entrySetup.build_app_plugins = appPlugins
      }

      // 添加转译支持
      ConfigService.addTranspileDependency(/[/\\]node_modules[/\\]\.code[/\\].+?\.js$/)

      // 清理临时代码目录
      fileUtil.removeSync('node_modules/.code')
      // 清除入口变量
      delete entrySetup['build_module_entry']
    } else {
      const { build_module_entry, build_html_template } = entrySetup
      entrySetup = {
        build_module_entry,
        build_html_template,
      }
    }

    // 可打印变量设置
    registerVariables('ICE_BUILD_ENTRY_SETUP', entrySetup)

    if (preprocess) {
      // 处理路由模式
      const {
        build_app_use_router: useRouter,
        build_app_router_mode: routerMode,
      } = entrySetup

      if (useRouter && routerMode === 'history') {
        ConfigService.addChainWebpack((config) => {
          const { devServer } = config

          if (!devServer.get('historyApiFallback')) {
            devServer.set('historyApiFallback', true)
            registerVariables('history-api-fallback', true)
            process.env['history-api-fallback'] = true
          }
        })
      }
    }
  }

  getRootPath() {
    const { build_module_root } = this.config
    const root = fileUtil.isDirectory(build_module_root, true)
      ? fileUtil.getAbsPath(build_module_root)
      : ''

    if (!root) {
      logger.warn(
        `\nModule root path of '${build_module_root}' must be a exists directory.\n`
      )
    }
    return root
  }

  validateConfig(name, val) {
    const {} = this
    let valid
    switch (name) {
      case 'build_app_router_mode':
        valid = ['hash', 'history', ''].includes(val)
        break
      case 'build_router_map_props':
        valid = ['all', 'params', 'query', 'none'].includes(val)
        break
      case 'build_app_nested_routes':
        valid = ['manual', 'auto', 'none'].includes(val)
        break
      default:
        valid = true
    }
    return valid
  }

  // 获取构建配置
  getConfig(preprocess) {
    const preprocessOptions = Object.assign({}, preprocess)
    const env = this.env
    const constants = Object.assign({}, defaultBuildConfig)
    const envKeys = Object.keys(env)
    const optionsKeys = Object.keys(preprocessOptions)

    return Object.keys(constants).reduce((defined, item) => {
      const def = constants[item]
      const type = typeof def
      let val = undefined
      for (const key of envKeys) {
        if (key.toLowerCase() === item) {
          val = env[key]
          break
        }
      }
      //
      for (const key of optionsKeys) {
        if (
          item
            .toLowerCase()
            .replace(/^build_/i, '')
            .replace(/_(.)/g, (t, m) => m.toUpperCase()) === key
        ) {
          val = preprocessOptions[key]
          break
        }
      }

      //
      if (
        typeof val !== type ||
        (typeof val === 'string' && !(val = val.trim())) ||
        !this.validateConfig(item, val)
      ) {
        defined[item] = def
      } else {
        defined[item] = val
      }
      return defined
    }, {})
  }

  getFilter(filter) {
    const {} = this.config
    if (typeof filter === 'string') {
      filter = filter.trim()
    } else {
      filter = ''
    }

    const matcher = /^\/(.+)(?=\/(gi|ig|g|i)?$)/.exec(filter)
    if (matcher) {
      try {
        filter = new RegExp(matcher[1], matcher[2])
        return filter
      } catch (e) {
        logger.error(`\nThe expression for module path filter is invalid: ${e.message}\n`)
      }
    }

    if (filter) {
      filter = filter
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
        .filter((s) => !!s)
      //
      if (!filter.length) {
        filter = ''
      }
    }
    return filter
  }

  // 获取入口模块路径
  getEntryModules(entry, filter) {
    const modules = {}
    const entryPattern = typeof entry === 'string' ? entry.split(',') : []
    const targets = this.getFilter(filter)

    // 获取构建入口
    for (let entry of entryPattern) {
      const pattern = entry.trim()
      if (!pattern) {
        continue
      }

      // 匹配路径模式
      fileUtil.matchFileSync(pattern, { nodir: true, dot: false }).forEach((file) => {
        const dirName = fileUtil.getShortDirName(file)
        if (targets) {
          if (targets instanceof RegExp) {
            // 正则过滤
            if (!targets.test(dirName)) {
              return
            }
          } else if (targets.indexOf(dirName.toLowerCase()) === -1) {
            // 枚举过滤
            return
          }
        }

        // 去重
        modules[file] = 1
      })
    }

    return Object.keys(modules)
  }

  // 创建构建入口
  toEntryPoints() {
    const entryPages = {}
    const { build_mpa } = this.config
    const { legacyModules, componentModules, rootApp } = this.getBuildModules()

    if (componentModules.length || !legacyModules.length) {
      if (build_mpa) {
        if (componentModules.length) {
          this.buildMPAEntry(componentModules, entryPages)
        }
      } else {
        this.buildSPAEntry(componentModules, entryPages)
        entryPages.index.module = rootApp
      }

      // 监听文件变化，重新生成entry
      this.watch(entryPages)
    }

    if (legacyModules.length) {
      this.buildLegacyEntry(legacyModules, entryPages)
    }

    return this.formatEntries(entryPages)
  }

  // 获取构建模块
  getBuildModules() {
    const { config, options } = this
    const {
      build_module_entry,
      build_module_root,
      build_route_extensions,
      build_module_filter,
      build_root_app_path,
    } = config
    const { pluginOptions } = options
    const { preprocess } = Object.assign({}, pluginOptions)

    const rootApp = fileUtil.getAbsPath(build_root_app_path)
    const entryGlob = preprocess
      ? fileUtil.joinPath(build_module_root, `**/*${build_route_extensions}`)
      : build_module_entry

    // 入口模块
    const modules = this.getEntryModules(
      entryGlob.replace(/\\/g, '/'),
      build_module_filter
    )

    // 普通入口模块
    const legacyModules = []
    // 组件入口模块
    const componentModules = []

    for (const module of modules) {
      const absModule = fileUtil.getAbsPath(module)
      if (!absModule) {
        continue
      }
      if (!preprocess || absModule === rootApp || !absModule.endsWith('.vue')) {
        legacyModules.push(absModule)
      } else {
        componentModules.push(absModule)
      }
    }

    return { legacyModules, componentModules, rootApp, preprocess }
  }

  //
  watch(entryPoints) {
    if (process.env.NODE_ENV !== 'development') {
      return
    }
    this.setWatchedEntryPoints(entryPoints)

    // 不重复watch
    if (this.watcher) {
      return
    }

    const { build_module_router_name, build_module_store_name } = this.config
    const routerName = build_module_router_name.replace(/^\/+/g, '')
    const storeName = build_module_store_name.replace(/^\/+/g, '')
    //
    let timer = 0
    const handler = (type, file) => {
      debug('file has been changed (%s): %s', type, file)
      if (!['addDir', 'unlinkDir'].includes(type) && !/\.(?:jsx?|vue)$/i.test(file)) {
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => {
        emitter.emit('before-entry-update')
        this.context = this.getRootPath()
        this.toEntryPoints()
        emitter.emit('after-entry-update')
      }, 80)
    }
    //
    this.watcher = commonUtil.watch(
      // 监听文件的变化
      ['**/', `**/@(*.vue|${routerName}|${storeName}|main.js)`],
      {
        add: handler.bind(this, 'add'),
        unlink: handler.bind(this, 'unlink'),
        addDir: handler.bind(this, 'addDir'),
        unlinkDir: handler.bind(this, 'unlinkDir'),
        change: handler.bind(this, 'change'),
      },
      {
        cwd: fileUtil.resolvePath('src'),
        delay: 0,
        nodir: false,
      }
    )
  }

  formatEntries(entries) {
    // 格式化
    const entryPoints = []
    const pages = {}
    Object.keys(entries).forEach((key) => {
      const { entry, template, filename, legacy, spa, module, moduleName } = entries[key]
      //
      pages[key] = {
        entry,
        template,
        filename,
      }
      //
      entryPoints.push({
        entry,
        filename,
        module,
        moduleName,
        legacy,
        spa,
      })
    })
    //
    if (!entryPoints.length) {
      // 没有入口文件，则退出
      logger.error('\nMust include at least one entry.\n')
      process.exit(2)
    }
    // 修改名称
    this.modifyEntryName(pages, entryPoints)
    this.convertToAbsPath(pages, entryPoints)
    // 注册环境变量
    this.env['registerVariables']('ICE_BUILD_ENTRY_POINTS', entryPoints)
    //
    return pages
  }

  //
  setWatchedEntryPoints(pages) {
    const { config, entries: prevEntries } = this
    const { build_mpa } = config
    const currEntries = Object.keys(pages).map((key) => pages[key].entry)
    this.entries = currEntries
    if (prevEntries && commonUtil.difference(prevEntries, currEntries).length) {
      if (build_mpa) {
        const deleted = prevEntries.filter((entry) => !currEntries.includes(entry))
        for (const entry of deleted) {
          try {
            fileUtil.removeSync(entry)
          } catch (e) {
            debug(e.message)
          }
        }
        // emitter.emit('invalidate')
        emitter.emit('restart', 'entries has been changed')
      }
    }
  }

  buildLegacyEntry(modules, entryPages) {
    const { options, config } = this
    const { indexPath } = options
    const { build_html_template } = config
    const length = modules.length

    for (const module of modules) {
      const moduleName =
        length === 1 ? 'index' : fileUtil.getShortDirName(module).replace(/\W/g, '')
      const fileName = length === 1 ? indexPath || 'index.html' : `${moduleName}.html`
      //
      const entry = fileUtil.getAbsPath(module)
      //
      entryPages[moduleName.toLowerCase()] = {
        entry,
        moduleName,
        module: entry,
        template: build_html_template,
        filename: fileName,
        legacy: true,
      }
    }
  }

  //
  buildMPAEntry(files, entryPages) {
    const { config, publicPath, httpMock, context } = this
    const { build_html_template } = config
    //
    const entryPoints = generate({
      type: 'mpa',
      context,
      publicPath,
      files,
      config,
      httpMock,
    })
    //
    for (const point of entryPoints) {
      const { entry, module, moduleName } = point
      entryPages[moduleName.toLowerCase()] = {
        entry,
        module,
        moduleName,
        template: build_html_template,
        filename: `${moduleName}.html`,
      }
    }
  }

  //
  buildSPAEntry(files, entryPages) {
    const { config, options, publicPath, httpMock, context } = this
    const { build_html_template } = config
    const { indexPath } = options
    //
    const entryPoints = generate({
      type: 'spa',
      context,
      publicPath,
      httpMock,
      files,
      config,
    })
    //
    entryPages.index = {
      entry: entryPoints[0].entry,
      moduleName: 'index',
      template: build_html_template,
      filename: indexPath || 'index.html',
      spa: true,
    }
  }

  // 映射页面资源名称
  modifyEntryName(pages, points) {
    const { pluginOptions } = this.options
    const { pageNameMap } = Object.assign({}, pluginOptions)
    // 映射名称
    if (pageNameMap) {
      const hasOwnProperty = Object.prototype.hasOwnProperty
      const existNames = Object.keys(pages).reduce((names, page) => {
        names[page] = true
        return names
      }, {})

      for (const [name, page] of Object.entries(pageNameMap)) {
        if (!page) {
          continue
        }
        const targetName = pageNameMap[name]
        if (!hasOwnProperty.call(existNames, targetName)) {
          const entry = points.find((point) => point.filename === page.filename)
          page.filename = `${targetName}.html`
          if (entry) {
            entry.filename = page.filename
          }
          existNames[targetName] = true
          delete existNames[name]
        } else {
          logger.error(
            `\n[pluginOptions.pageNameMap] The file name of '${targetName}' already exists. (${name} => ${targetName})\n`
          )
        }
      }
    }
  }

  // 转换为绝对路径
  convertToAbsPath(pages, points) {
    const { outputDir, indexPath } = this.options
    let dirName = ''
    if (typeof indexPath === 'string' && indexPath.trim()) {
      dirName = fileUtil.getDirName(indexPath, outputDir)
    } else if (!fileUtil.isAbsolute(outputDir)) {
      dirName = fileUtil.resolvePath(outputDir)
    } else {
      dirName = outputDir
    }
    if (dirName) {
      const { build_kebab_case_path } = this.config

      for (const page of Object.values(pages)) {
        let pageName = page.filename
        if (build_kebab_case_path) {
          const hyphenName = pageName.replace(/[A-Z]+/g, (t, index) =>
            (!index ? t : `-${t}`).toLowerCase()
          )
          //
          if (hyphenName !== pageName) {
            const entry = points.find((point) => point.filename === pageName)
            if (entry) {
              entry.filename = hyphenName
            }
            pageName = hyphenName
          }
        }
        page.filename = fileUtil.joinPath(dirName, pageName)
      }
    }
  }

  destroy() {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}

let manager = null

module.exports = (options) => {
  if (manager) {
    manager.destroy()
  }
  manager = new EntryManager(options)
  return manager
}
