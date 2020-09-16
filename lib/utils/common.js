const fs = require('fs')
const os = require('os')
const dns = require('dns')
const crypto = require('crypto')
const prettier = require('prettier')
const { promisify } = require('util')

//
const addressUtil = require('address')
const chalk = require('chalk')
const chokidar = require('chokidar')
const upperFirst = require('lodash/upperFirst')
const throttle = require('lodash/throttle')
const debounce = require('lodash/debounce')
const resolve = require('resolve')

const ZipCompress = require('../plugin/webpack/ZipCompress')

const fileUtil = require('./file')
const emitter = require('./emitter')
const logger = require('./logger')

let prettierOptions = null

// 解析prettier配置文件
function resolvePrettierConfig(callback) {
  if (!prettierOptions) {
    const rc = `.prettierrc`
    let configPath = fileUtil.resolvePath(rc)
    if (!fs.existsSync(configPath)) {
      configPath = fileUtil.resolvePath(`${rc}.js`)
      if (!fs.existsSync(configPath)) {
        configPath = ''
      }
    }
    let options = null
    if (configPath) {
      try {
        options = prettier.resolveConfig.sync(configPath)
      } catch (e) {}
    }
    prettierOptions = Object.assign(
      {
        parser: 'babel',
      },
      options
    )
  }
  if (typeof callback === 'function') {
    callback(prettierOptions)
  }
  return Object.assign({}, prettierOptions)
}

//

module.exports = exports = {
  // 转换为连字符格式字符串
  toKebabString(str) {
    return `${str}`.replace(/-?([A-Z]+)/g, ($0, $1, index) =>
      (!index ? $1 : `-${$1}`).toLowerCase()
    )
  },

  // 取消连字符格式
  toUnKebabString(str) {
    return `${str}`.replace(/-([a-zA-Z])/g, (t, $1) => $1.toUpperCase())
  },

  // 随机的序列数字
  randomSequence(length) {
    return Math.floor(Math.random() * (length || 10e8)) + Date.now()
  },

  // 遍历树（深度优先）
  transverseTree(nodes, callback, parent, root, childrenProp = 'children') {
    if (!nodes || typeof nodes !== 'object') {
      return
    }
    if (!root) {
      root = nodes
    }
    if (!Array.isArray(nodes)) {
      nodes = [nodes]
    }
    for (const node of nodes) {
      const res = callback(node, parent, node[childrenProp], root)
      if (res === 'exit') {
        continue
      }
      const children = node[childrenProp]
      if (
        res === false ||
        exports.transverseTree(children, callback, node, root, childrenProp) === false
      ) {
        return false
      }
      if (res === 'flat') {
        delete node[childrenProp]
      } else if (typeof res === 'function') {
        res(node, parent, node[childrenProp], root)
      }
    }
  },

  // 正则表达式字符转义处理
  escapeRegExp(str) {
    return `${str}`.replace(/[*.?+$^[\](){}|\\]/g, '\\$&')
  },

  // 获取变量标识符生成器
  getIdentifierMaker(type = 'id', init) {
    const namedMadeCount = init && typeof init === 'object' ? init : {}
    return (namespace = 'space') => {
      const identifier = `${type}${upperFirst(
        namespace !== '/'
          ? namespace.replace(/\/(.)/g, ($0, $1) => $1.toUpperCase())
          : 'global'
      )}}`.replace(/[^_a-z$\d]/gi, '')

      const count = namedMadeCount[identifier] || 0
      namedMadeCount[identifier] = count + 1
      return `${identifier}${count || ''}`
    }
  },

  // 生成hash码
  hash(str, length, identifier) {
    let hash = crypto.createHash('md5').update(str).digest('hex')
    if (identifier) {
      hash = hash.replace(/^\d/, 'd')
    }
    if (+length) {
      hash = hash.substring(0, +length)
    }

    return hash
  },

  // 两个集合的差集
  difference(setA, setB) {
    const diff = new Set(setA)
    for (const elem of setB) {
      if (diff.has(elem)) {
        diff.delete(elem)
      } else {
        diff.add(elem)
      }
    }
    return Array.from(diff)
  },

  // 监听文件变化
  watch(pattern, callback, options) {
    const setup = Object.assign({}, options) // throttle
    const delay = setup.delay === undefined ? 500 : setup.delay
    const delayMethod = ['debounce', 'throttle'].includes(setup.method)
      ? setup.method
      : 'debounce'
    const delayHandler = delayMethod === 'debounce' ? debounce : throttle
    delete setup.delay
    delete setup.method

    const watcher = chokidar.watch(
      pattern,
      Object.assign(
        {
          ignoreInitial: true,
          ignored: ['node_modules'],
          disableGlobbing: false,
        },
        setup
      )
    )

    const delaySetup = {
      trailing: true,
      leading: false,
    }
    if (callback && typeof callback === 'object') {
      Object.keys(callback).forEach((event) => {
        const handler = callback[event]
        if (typeof handler === 'function') {
          watcher.on(event, delay ? delayHandler(handler, delay, delaySetup) : handler)
        }
      })
    } else if (typeof callback === 'function') {
      watcher.on('all', delay ? delayHandler(callback, delay, delaySetup) : callback)
    }
    //
    exports.registerShutdown(() => {
      watcher.close()
    })
    emitter.once('before-restart', () => {
      watcher.close()
    })
    return watcher
  },

  // 格式化代码
  formatCode(code, options, callback) {
    const config = resolvePrettierConfig()
    code = prettier.format(code, Object.assign({}, config, options))
    if (typeof callback === 'function') {
      callback(code)
    }
    return code
  },

  // 注册进程关闭回调
  registerShutdown(fn) {
    let run = false
    const wrapper = () => {
      if (!run) {
        run = true
        fn()
      }
    }
    process.on('SIGINT', wrapper)
    process.on('SIGTERM', wrapper)
    process.on('exit', wrapper)
  },

  // 打印服务器监听地址
  async printListeningAddress(server, extra, boxen) {
    const details = server.address()
    let localAddress = null
    let networkAddress = null
    let path = extra && typeof extra === 'object' ? extra.path : ''
    if (typeof path !== 'string') {
      path = ''
    } else {
      path = path.trim()
    }
    if (typeof details === 'string') {
      localAddress = details
    } else if (typeof details === 'object' && details) {
      let { port, address } = details
      address = address === '::' ? 'localhost' : address
      localAddress = `http://${
        address === '0.0.0.0' ? 'localhost' : address
      }:${port}${path}`
      const host = await exports.getNetworkHostIP()
      networkAddress = `http://${host}:${port}${path}`
    }
    if (localAddress || networkAddress) {
      let message = ''
      //
      if (extra) {
        const title = typeof extra === 'object' ? extra.title : extra
        if (title && typeof title === 'string') {
          message += title
        }
      }
      if (localAddress) {
        message += `\n${'  - Local:   '}${chalk['cyan'](localAddress)}`
      }
      if (networkAddress) {
        message += `\n${'  - Network: '}${chalk['cyan'](networkAddress)}`
      }
      if (extra) {
        const foot = typeof extra === 'object' ? extra.foot : ''
        if (foot && typeof foot === 'string') {
          message += `\n${foot}`
        }
      }
      if (boxen) {
        logger.logWithBoxen(message, { margin: 1 })
      } else {
        // print
        console.log(message)
      }

      return {
        local: localAddress,
        network: networkAddress,
      }
    }
  },

  // 获取可用的端口号
  async getNetworkPort(port) {
    const startPort = +port || 8080
    return await require('portfinder').getPortPromise({
      port: startPort,
      startPort,
    })
  },

  // 获取机器在网络上的IP
  async getNetworkHostIP() {
    let address = ''
    try {
      address = addressUtil.ip()
      if (!address) {
        address = await promisify(dns.lookup)(os.hostname())
          .then(({ address }) => address)
          .catch((e) => {
            console.error(`DNS lookup failed: ${e.message}`)
          })
      }
    } catch (e) {
      console.error(e.message)
    }
    if (
      !address ||
      !/^10[.]|^172[.](1[6-9]|2[0-9]|3[0-1])[.]|^192[.]168[.]/.test(address)
    ) {
      // 如果是公网IP地址，就重置为局域网IP显示
      address = '127.0.0.1'
    }
    return address
  },

  // 创建本地网络监听的HTTP服务器
  async createLocalHttpServer(port, handler, closed) {
    const options = port && typeof port === 'object' ? port : { port }
    const { port: exceptPort, host, path } = options
    const servePath = path || '/'
    const actualPort = await exports.getNetworkPort(+exceptPort || 5000)
    const httpServer = require('http').createServer(handler)
    require('killable')(httpServer)
    //
    return new Promise((resolve, reject) => {
      httpServer.listen(
        { host: host || '0.0.0.0', port: actualPort, path: servePath },
        async (err) => {
          if (!err) {
            exports.registerShutdown(() => {
              httpServer.kill(closed)
            })
            const host = await exports.getNetworkHostIP()
            resolve({ server: httpServer, host, port: actualPort, path: servePath })
          } else {
            reject(err)
          }
        }
      )
    })
  },

  // 拷贝内容至剪贴板
  async copyToClipboard(content) {
    try {
      const { write } = require('clipboardy')
      await write(content)
      return true
    } catch (err) {
      console.error(`Cannot copy to clipboard: ${err.message}`)
    }
  },

  // 打开浏览器
  openBrowser(address) {
    try {
      if (typeof address !== 'string' || !(address = address.trim())) {
        return
      }
      const { openBrowser } = require(require('resolve').sync('@vue/cli-shared-utils', {
        basedir: process.cwd(),
      }))
      openBrowser(address)
    } catch (e) {
      //
    }
  },

  // 获取输出路径
  getOutputPath(outputDir, dest) {
    if (typeof dest !== 'string') {
      dest = require('minimist')(process.argv.slice(2))['dest']
    }

    let output = typeof dest === 'string' ? dest : outputDir
    output = typeof output === 'string' ? output.trim() : ''
    if (!output) {
      output = 'dist'
    }

    if (!fileUtil.isAbsolute(output)) {
      output = fileUtil.resolvePath(output)
    }
    return output
  },

  // 格式化路径打印信息
  prettyPrintPaths(paths, minWidth = 0, leading = '  - ') {
    if (!Array.isArray(paths)) {
      paths = [paths]
    }
    const urls = paths.filter((item) => !!item)
    const maxStrLen = urls.reduce((len, b) => Math.max(len, b.type.length), minWidth)

    let message = ''
    urls.forEach((url, index) => {
      const { type, path } = url
      message += `${index ? '\n' : ''}${leading}${`${type}:`.padEnd(
        maxStrLen + 1
      )} ${chalk['cyan'](path)}`
    })
    return message
  },

  // 获取构建资源压缩文件路径
  getZipFilesPath(projectOptions) {
    const { pluginOptions } = Object.assign({}, projectOptions)
    const { service } = Object.assign({}, pluginOptions)
    const { compress } = Object.assign({}, service)

    if (compress) {
      const ZipCompress = require('../plugin/webpack/ZipCompress')
      return new ZipCompress(compress).getZipFiles()
    }

    return []
  },

  // 获取默认的图标目录
  getDefaultIconsDirectory() {
    const defaultDirs = [
      'src/assets/images/icons/',
      'src/assets/images/icon/',
      'src/assets/img/icons/',
      'src/assets/img/icon/',
      'src/assets/icons/',
      'src/assets/icon/',
    ]
    let absPath
    for (const dir of defaultDirs) {
      absPath = fileUtil.resolvePath(dir)
      if (fileUtil.existsSync(absPath)) {
        break
      }
    }
    return absPath
  },

  // 解析包路径，默认从指定的目录或当前工作目录
  resolvePackage(name, basedir) {
    const mainPath = resolve.sync(name, { basedir: basedir || process.cwd() })
    const escapedName = exports.escapeRegExp(name)
    const path = mainPath.replace(
      new RegExp(`(([/\\\\])${escapedName})\\2(?!.*?([/\\\\])${escapedName}\\3).*$`),
      '$1'
    )
    const isSymLink = fs.lstatSync(path).isSymbolicLink()
    return {
      path: isSymLink ? fs.realpathSync(path) : path,
      main: isSymLink ? fs.realpathSync(mainPath) : mainPath,
    }
  },

  // 压缩资源路径成zip压缩包
  async compress(resourcePath, zipName) {
    const context = fileUtil.getAbsPath(resourcePath)
    if (!context) {
      throw new Error('The resource paths cannot be empty.')
    }
    let targetName
    if (fileUtil.isAbsolute(zipName)) {
      targetName = zipName
    } else {
      targetName = fileUtil.joinPath(
        fileUtil.getDirName(context),
        typeof zipName !== 'string'
          ? fileUtil.getFileBaseName(context).replace(/\.[^.]*$/, '')
          : zipName
      )
    }
    const zips = await new ZipCompress(targetName).execWithContext(context)
    return zips[0]
  },
}
