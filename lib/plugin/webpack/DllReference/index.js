const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')
const chalk = require('chalk')
const ConcatPlugin = require('webpack-concat-plugin')
//
const debug = require('debug')('plugin:DllReference')
//
const CompilerEvent = require('../CompilerEvent')
//
const getPackage = require('../../../utils/package')
const commonUtil = require('../../../utils/common')
const fileUtil = require('../../../utils/file')
const logger = require('../../../utils/logger')
const config = require('./config.dll')
const webpack = require('../index')

let cachedDeps = null
let cachedBundles = null

class DllReference {
  //
  constructor(options, pathSetup) {
    this.options = options = Object.assign({}, options)
    this.pathSetup = Object.assign({}, pathSetup)
    this.context = options.context || process.cwd()
  }

  // 应用插件
  apply(compiler) {
    //
    new CompilerEvent(
      'CachedDllRefWebpackPlugin',
      {
        // build模式时调用
        beforeRun: this.run,
        // dev模式时调用
        watchRun: this.run,
      },
      // context
      this
    ).apply(compiler)
  }

  //
  async run(compiler) {
    if (this.initialized) {
      return
    }
    this.initialized = true
    try {
      //
      debug('compile for dll.')
      // 创建链接库
      const bundles = await this.generateBundles()
      if (bundles.length) {
        // 引用bundles
        this.referenceBundles(bundles, compiler)
        // 合并bundles
        this.concatBundles(bundles, compiler)
      }
      //
    } catch (e) {
      debug(e.message)
    }
  }

  // 引用bundles
  referenceBundles(bundles, compiler) {
    for (const bundle of bundles) {
      const { context, absManifestPath: manifest } = bundle
      // 添加链接库引用插件
      new webpack.DllReferencePlugin({
        //
        context,
        manifest,
        //
      }).apply(compiler)
    }
  }

  // 合并bundles
  concatBundles(bundles, compiler) {
    const isProd = process.env.NODE_ENV === 'production'
    const { options, pathSetup } = this
    const { outputDir, assetsDir } = pathSetup

    //
    const relativePath = path.relative(outputDir, assetsDir)
    const outputPath = `${relativePath ? `${relativePath}/` : ''}js`

    /**
     * ConcatWebpackPlugin存在一个bug
     * 如果使用现代模式构建，需要明确声明命令参数，--no-unsafe-inline
     */

    if (isProd) {
      // 产品模式，生成指定的dll文件

      const assets = Object.assign({}, options)

      for (let [asset, deps] of Object.entries(assets)) {
        if (!Array.isArray(deps)) {
          deps = [deps]
        }

        // 模块dll路径列表
        const modules = deps.reduce((mods, dep) => {
          if (typeof dep === 'string' && (dep = dep.trim())) {
            const module = bundles.find(({ name }) => name === dep)
            if (module && !mods.includes(module.absFilePath)) {
              mods.push(module.absFilePath)
            }
          }
          return mods
        }, [])

        // 根据bundle合并dll
        new ConcatPlugin({
          outputPath,
          uglify: false,
          sourceMap: false,
          fileName: asset.endsWith('.js') ? asset : `${asset}.js`,
          filesToConcat: modules,
          //
        }).apply(compiler)
      }

      //
    } else {
      // 非产品模式，合并所有依赖
      // 合并成一个单独的dll
      new ConcatPlugin({
        outputPath,
        uglify: false,
        sourceMap: false,
        fileName: 'dll-vendors.js',
        filesToConcat: bundles.map(({ absFilePath }) => absFilePath),
        //
      }).apply(compiler)
    }
    //
  }

  // 获取依赖信息
  getDependencies() {
    if (cachedDeps) {
      return Object.assign({}, cachedDeps)
    }
    // 应用缓存，可能存在二次构建
    cachedDeps = {}
    // 构建依赖列表
    const { context, options } = this
    const isProd = process.env.NODE_ENV === 'production'
    const { dependencies: deps } = getPackage({ cwd: context })
    // 非产品模式，构建所有依赖项为dll
    // 产品模式时，构建指定依赖列表
    const moduleList = isProd
      ? Object.values(Object.assign({}, options)).reduce((list, mod) => {
          if (!Array.isArray(mod)) {
            mod = [mod]
          }
          for (let m of mod) {
            if (typeof m === 'string' && (m = m.trim())) {
              list.push(m)
            }
          }
          return list
        }, [])
      : null
    //
    if (deps && typeof deps === 'object') {
      //
      Object.keys(deps).forEach((dep) => {
        try {
          if (moduleList) {
            // 产品模式指定依赖构建
            if (!moduleList.some((mod) => mod === dep)) {
              // 未在依赖列表中，跳过该依赖版本解析
              return
            }
          }
          const module = path.join(context, 'node_modules', dep)
          // 依赖需与依赖版本相关
          const { version } = getPackage({ cwd: module })
          //
          cachedDeps[dep] = {
            module,
            version,
          }
        } catch (e) {
          debug(e.message)
        }
      })
    }
    return Object.assign({}, cachedDeps)
  }

  // 生成链接库
  async generateBundles() {
    if (cachedBundles) {
      return [...cachedBundles]
    }
    // 可能二次构建，缓存bundle信息
    cachedBundles = []
    //
    const entries = []
    const context = this.context
    const output = config.outputDir
    const deps = this.getDependencies()
    //
    const env = process.env.NODE_ENV
    Object.keys(deps).forEach((name) => {
      const { version } = deps[name]
      // 这里也将执行环境变量纳入唯一值hash中
      // 不同环境变量，打包不同的dll代码
      const filename = `${commonUtil.hash(`${env}#${name}@${version}`, 0, true)}`
      const absFilePath = path.join(output, filename)
      const manifest = `${filename}.manifest.json`
      const absManifestPath = path.join(output, manifest)
      //
      cachedBundles.push({
        name,
        context,
        version,
        filename,
        manifest,
        absFilePath,
        absManifestPath,
      })
      // 如果不存在链接文件或清单文件，则需重新构建连接库
      if (!fs.existsSync(absFilePath) || !fs.existsSync(absManifestPath)) {
        entries.push({
          name,
          filename,
        })
      }
    })
    // 创建动态链接文件
    await this.makeDllBundle(entries, output).then(debug)
    // 当前已链接的bundles
    return [...cachedBundles]
  }

  // 进度打印
  logWithSpinner(msg) {
    const spinner = this.spinner
    if (!spinner) {
      return
    }
    spinner.text = `${chalk.cyan('[DLL]')} ${msg}`
    spinner.start()
  }

  // 执行dll依赖打包
  makeDllBundle(entries, output) {
    // 没有需要重新构建的链接库，则成功返回
    if (!entries.length) {
      return Promise.resolve('No entry files need to be packaged.')
    }
    if (!fs.existsSync(output)) {
      fileUtil.mkdir(output)
    }
    //
    const context = this.context
    //
    return new Promise((resolve, reject) => {
      this.spinner = logger.logWithSpinner()
      // 使用子进程生成动态链接文件
      const forked = fork(path.join(__dirname, 'fork'), [], {
        cwd: context,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: {
          // 此环境变量设置后，执行环境中本插件不执行额外操作
          ICE_BUILD_DLL_REFERENCE_FORK: true,
          // 环境变量设置
          NODE_ENV: process.env.NODE_ENV,
        },
      })
      // 接收子进程构建结果消息
      forked.on('message', (message) => {
        const { type, payload } = message
        if (type === 'progress') {
          const { percent, message: msg } = Object.assign({}, payload)
          // 进度消息
          this.logWithSpinner(`${Math.floor(percent * 100)}% ${msg}`)
        } else if (type === 'failed') {
          //
          this.spinner.fail('Errors occurred while build for DLL.\n')
          this.spinner = null
          // 构建失败
          reject(new Error('Build for dll failed.'))
          //
        } else if (type === 'done') {
          this.spinner.succeed('Build for DLL successful.\n')
          this.spinner = null
          // 关闭子进程
          forked.send({
            type: 'close',
          })
          resolve()
        }
      })
      // 进度提示开启
      this.logWithSpinner('0% building')
      //
      // 通知子进程生成dll文件
      forked.send({
        type: 'build',
        payload: {
          context,
          entry: entries.reduce((entry, { name, filename }) => {
            entry[filename] = [name]
            return entry
          }, {}),
          // 输出配置很关键，需要与引用配置相应匹配
          output: {
            path: output,
            filename: '[name]',
            library: '[name]',
            libraryTarget: 'umd',
          },
        },
      })
      //
    })
  }
}

DllReference.default = DllReference
module.exports = DllReference
