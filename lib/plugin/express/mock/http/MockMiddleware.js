const fs = require('fs')
const bodyParser = require('body-parser')
const cloneDeep = require('lodash/cloneDeep')
const onFinished = require('on-finished')
const chalk = require('chalk')

//
const helper = require('../helper')
const rawBodyMiddleware = require('../../rawBodyMiddleware')
//
const logger = require('../../../../utils/logger')
const getEnv = require('../../../../utils/env')
const fileUtil = require('../../../../utils/file')
const applyMiddleware = require('../../../../utils/middleware')

//
const MockManager = require('./ModuleManager')
const MockConverter = require('./MockConverter')
const ModuleMaker = require('./ModuleMaker')

const BODY_PARSED_METHODS = ['post', 'put', 'patch']
const STATIC_RESOURCES_REG = /.+?\.(?:js|json|css|png|jpe?g|gif|svg|ico|bmp|eot|ttf|woff|avi|wmv|mpe?g|mov|ra?m|swf|flv|mp4|ogg|webm|midi?|wav|wma|mp3|mpga|manifest|txt|xml|x?html?)$/i

//
const defaultOptions = {
  path: 'mock',
  // 全局延时
  delay: 0,
  // 生成代码中的默认延时
  defaultDelay: 0,
  // 按路径自动初始化创建接口mock模块
  init: true,
  // 自动定位接口位置
  locate: true,
  // 生成代码中是否默认禁用掉mock
  defaultDisabled: false,
  // 动态API路径转换函数
  pathHandler: null,
  // 排除mock，字符串，正则，或函数
  exclude: '',
  // 数据文件
  data: {
    // 输入
    input: 'mock.data.json',
    // 输出
    output: 'mock.output.js',
  },
}

/**
 * mock中间件
 * @type {module.MockMiddleware}
 */
module.exports = class MockMiddleware {
  //
  constructor(options, projectOptions) {
    if (typeof options !== 'object') {
      options = { path: typeof options !== 'string' ? '' : options }
    }
    this.options = Object.assign(cloneDeep(defaultOptions), options)
    //
    this.pluginName = getEnv().PLUGIN_NAME
    this.creatingApi = {}
    this.initialized = false
    //
    let { outputDir } = projectOptions || {}
    // 应用静态公共资源目录
    this.appPublicFolders = ['public'].concat(outputDir).reduce((folders, path) => {
      if (typeof path === 'string') {
        path = path.trim()
      } else {
        path = ''
      }
      if (path) {
        const absPath = fileUtil.resolvePath(path)
        if (!folders.includes(absPath) && fileUtil.isDirectory(absPath)) {
          folders.push(absPath)
        }
      }
      return folders
    }, [])
  }

  init() {
    if (this.initialized) {
      return
    }
    this.initialized = true
    try {
      this.initBuiltInFiles()
      this.initConverter()
      this.initManager()
      this.initMaker()
    } catch (e) {
      logger.error(e.message)
    }
  }

  // 创建内建文件
  initBuiltInFiles() {
    const { path: mockPath } = this.options
    const absMockPath = helper.makeAbsModulesPath(mockPath)
    if (absMockPath) {
      const mockjs = fileUtil.joinPath(absMockPath, 'mock.demo.js')
      if (!fs.existsSync(mockjs)) {
        // 拷贝示例文件
        fileUtil.copySingleFileSync(
          fileUtil.joinPath(__dirname, '..', 'template', 'mock.js'),
          fileUtil.joinPath(absMockPath, 'mock.demo.js')
        )
        logger.log(`Generated for mock. [${mockjs}]`)
      }
    }
  }

  // 初始化mock数据转换器
  initConverter() {
    const options = this.options
    const { data } = options
    const { input: dataFile, output: tplFile } = Object.assign(
      {},
      defaultOptions.data,
      data
    )
    if (!dataFile || !tplFile) {
      return null
    }
    options.data = { input: dataFile, output: tplFile }
    //
    this.converter = new MockConverter(Object.assign({}, options, { watch: true }))
  }

  // 初始化mock模块管理器
  initManager() {
    const options = this.options
    //
    this.manager = new MockManager(
      //
      Object.assign({}, options, {
        exclude: (file) => {
          let { data, path: mockPath } = this.options
          let excludeDataFile = false
          if (!fileUtil.isAbsolute(file)) {
            file = fileUtil.resolvePath(file)
          }
          mockPath = helper.getRelMockPath(mockPath)
          if (this.converter) {
            let { input, output } = data
            input = fileUtil.isAbsolute(input)
              ? input
              : fileUtil.resolvePath(mockPath, input)
            output = fileUtil.isAbsolute(output)
              ? output
              : fileUtil.resolvePath(mockPath, output)
            //
            excludeDataFile = file === input || file === output
          }
          return (
            excludeDataFile || file === fileUtil.resolvePath(mockPath, 'mock.demo.js')
          )
        },
      }),
      // updated
      (module) => {
        if (module) {
          const { creatingApi } = this
          Object.keys(creatingApi).forEach((api) => {
            const { method, path } = creatingApi[api]
            if (module.match(method, path)) {
              delete creatingApi[api]
            }
          })
        }
      }
    )
  }

  // 初始化模块生成器
  initMaker() {
    const options = this.options
    this.maker = new ModuleMaker(Object.assign({}, options))
  }

  // 判断是否对该请求应用Mock
  shouldMock(req) {
    const { method, headers } = req
    // 只处理满足restful规范对接口请求
    if (!/^(?:get|post|put|patch|delete)$/i.test(method)) {
      return false
    }

    const pathname = this.getRequestPath(req)

    if (!pathname || pathname === '/') {
      return false
    }

    // 不处理内部请求
    if (/^\/(?:sockjs-node\/|__open-in-editor).+/.test(pathname)) {
      return false
    }

    // websocket协议升级请求，不进行mock
    if (helper.isWebSocketHandshake(req)) {
      return false
    }

    if (!req.xhr && method === 'GET') {
      const accept = headers ? headers.accept : ''
      if (
        accept &&
        (accept.indexOf('text/html') !== -1 ||
          accept.indexOf('image/*') !== -1 ||
          accept.indexOf('audio/*') !== -1 ||
          accept.indexOf('video/*') !== -1)
      ) {
        return false
      }

      // 静态资源
      if (STATIC_RESOURCES_REG.test(pathname)) {
        return false
      }

      // 公共静态资源
      const { appPublicFolders } = this
      for (const folder of appPublicFolders) {
        const maybePublicPath = fileUtil.joinPath(folder, pathname.replace(/^\//, ''))
        if (fs.existsSync(maybePublicPath)) {
          return false
        }
      }
    }

    const { exclude } = this.options
    if (exclude) {
      if (exclude instanceof RegExp) {
        return !exclude.test(pathname)
      }

      const type = typeof exclude
      if (type === 'string') {
        return !pathname.match(exclude)
      }

      if (type === 'function') {
        return !exclude(pathname, req)
      }
    }

    return true
  }

  // 应用express中间件
  apply(req, res, next) {
    if (!this.initialized) {
      this.init()
    }
    if (!this.shouldMock(req)) {
      // 不处理该请求
      return next()
    }
    const mock = this.matchMock(req)
    if (mock) {
      this.handleMockRequest(mock, { req, res, next })
    } else {
      this.makeMockModule(req, res)
      next()
    }
  }

  //
  handleMockRequest(mock, { req, res, next }) {
    // 匹配
    const { method, path, disabled } = mock
    if (disabled) {
      const location = this.getMockLocation(mock)
      logger.echo(
        `Mock ${chalk.gray('disabled')}: ${method.toUpperCase()} ${chalk.cyan(path)} ${
          location ? `[${location}]` : ''
        }`
      )
      // 下一个中间件
      next()
    } else {
      //
      this.handleMock(mock, { req, res, next })
    }
  }

  // 获取请求的路径地址
  getRequestPath(req) {
    let { path } = req
    if (path === undefined) {
      path = req.url.replace(/[?#].*/, '')
    }
    if (typeof path === 'string') {
      path = path.trim().replace(/^\/{2,}/, '/')
      if (path !== '/') {
        path = path.replace(/\/+$/, '')
      }
    }
    return path || ''
  }

  // 根据请求对象匹配模块
  matchMock(req) {
    const exceptPath = this.getRequestPath(req)
    const exceptMethod = req.method

    const mockModules = this.manager.getMockModules()
    //
    for (const module of mockModules) {
      const result = module.match(exceptMethod, exceptPath)
      if (result) {
        const { match, mock } = result
        req.params = helper.parseDynamicParams(match, mock.keys)
        return mock
      }
    }
  }

  // 获取mock源码定位
  getMockLocation(mock) {
    const location = this.maker.getMockLocation(mock)
    const [, file, loc] = /^(.*?)(:\d+:\d+)$/.exec(location)
    return `${fileUtil.relativePath(process.cwd(), file).replace(/^\.[/\\]/, '')}${loc}`
  }

  // 创建mock模块
  makeMockModule(req, res) {
    const { method } = req
    const { pathHandler } = this.options
    const requestPath = this.getRequestPath(req)
    const filter =
      typeof pathHandler === 'function' ? pathHandler : helper.filterDynamicPathParams
    //
    let apiPath = ''
    try {
      apiPath = filter(requestPath, method)
    } catch (e) {
      console.error(e)
    }
    const trimmedApiPath =
      (typeof apiPath === 'string' ? apiPath.trim() : '') || requestPath
    const api = `${method} ${trimmedApiPath}`
    if (!this.creatingApi[api]) {
      this.creatingApi[api] = {
        path: requestPath,
        method,
      }
      // 未匹配
      const maker = this.maker
      const setup = { method, path: trimmedApiPath }
      // 完成代理请求后，根据远程服务器返回到数据创建mock模块
      if (!res) {
        maker.makeMockModule(setup)
      } else {
        onFinished(res, () => {
          setup.data = res.rawBody
          maker.makeMockModule(setup)
        })
      }
    }
  }

  // 处理mock
  handleMock(mock, { req, res, next }) {
    let { method, path, handler, delay } = mock
    const task = () => {
      const location = this.getMockLocation(mock)
      logger.echo(
        `Mock ${chalk['cyan']('matched')}: ${method.toUpperCase()} ${chalk.cyan(path)} ${
          location ? `[${location}]` : ''
        }`
      )
      if (!onFinished.isFinished(res)) {
        if (!handler) {
          handler = mock.handler = this.createHandler(mock)
        }
        // 执行本地mock处理程序
        handler(req, res, next)
      }
    }
    if ((delay = Math.max(delay - 30, 0))) {
      setTimeout(task, delay)
    } else {
      task()
    }
  }

  // 创建mock处理程序
  createHandler({ data, method }) {
    const limit = '5mb'
    //
    const middleware = BODY_PARSED_METHODS.includes(method)
      ? [
          // 保证远程代理能获取到原始请求的内容
          rawBodyMiddleware(),
          // 二进制流
          bodyParser.raw({
            limit,
          }),
          // json格式
          bodyParser.json({
            limit,
            strict: false,
          }),
          // 表单格式
          bodyParser.urlencoded({
            limit,
            extended: true,
          }),
        ]
      : []
    //
    middleware.push(this.handleMockData(data))
    //
    return (req, res, next) => {
      // 对当前请求应用中间件
      applyMiddleware(middleware, req, res, next)
    }
  }

  // 处理mock数据内容
  handleMockData(data) {
    return (req, res, next) => {
      //
      const doNext = (err) => {
        if (!next || onFinished.isFinished(res)) {
          return
        }
        next(err)
        // 防止重复被调用
        next = null
      }
      // 发送数据
      const sendJSON = (data) => {
        if (next) {
          if (data !== undefined && !onFinished.isFinished(res)) {
            res.setHeader('X-Mocked-By', this.pluginName)
            res.json(data)
          } else {
            // 使用代理服务器处理
            doNext()
          }
        }
      }
      if (typeof data === 'function') {
        const mockRes = data(req, res, doNext)
        if (mockRes instanceof Promise) {
          mockRes.then(sendJSON).catch(doNext)
        } else if (mockRes !== undefined) {
          sendJSON(mockRes)
        } else {
          doNext()
        }
      } else {
        sendJSON(data)
      }
    }
  }

  //
}
