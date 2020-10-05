const path = require('path')
const chalk = require('chalk')
const { resolvePackage } = require('./common')
const logger = require('../utils/logger')

/**
 * 检查是否安装less
 * @returns {boolean}
 */
function detectLess() {
  try {
    resolvePackage('less')
    return true
  } catch (e) {
    return false
  }
}

/**
 * 检查是否安装less-loader
 * @returns {boolean}
 */
function detectLessLoader() {
  try {
    resolvePackage('less-loader')
    return true
  } catch (e) {
    return false
  }
}

let pkgRoot = ''
let mainPath = ''
let sources = ''

/**
 * 检查是否安装icefox等依赖
 * 如果没有安装，则提醒安装，并退出程序。
 */
function detectDependencies() {
  const dependencies = []
  if (!detectLess()) {
    dependencies.push('less@3')
  }
  if (!detectLessLoader()) {
    dependencies.push('less-loader@5')
  }
  let hasIceFoxInstalled
  try {
    const pkg = require(path.resolve(process.cwd(), 'package.json'))
    if (pkg && pkg.name === 'icefox') {
      // 本地开发
      sources = pkg.sources
      mainPath = path.resolve(sources, 'index.js')
      pkgRoot = process.cwd()
    } else {
      sources = 'src'
      ;({ main: mainPath, path: pkgRoot } = resolvePackage('icefox'))
    }
    hasIceFoxInstalled = true
  } catch (e) {
    hasIceFoxInstalled = false
  }

  if (dependencies.length || !hasIceFoxInstalled) {
    let message = !hasIceFoxInstalled ? chalk.cyanBright('npm i icefox') : ''
    if (dependencies.length) {
      message += chalk.gray('\n\nafter finished then:\n\n')
      message += chalk.cyanBright(`npm i -D ${dependencies.join(' ')}`)
    }
    logger.error(`Some dependencies were not found. Please install it first.`)
    logger.logWithBoxen(message)

    // 退出程序
    process.exit(2)
  }
}

// 检测依赖安装情况
detectDependencies()

module.exports = exports = {
  // 包根目录
  root: pkgRoot,
  // 包入口文件
  main: mainPath,
  // 应用的包目录
  lib: path.join(pkgRoot, sources),
  // 代码目录：app
  app: path.join(pkgRoot, sources, 'app'),
  // 代码目录：plugins
  plugins: path.join(pkgRoot, sources, 'plugins'),
  // 代码目录：components
  components: path.join(pkgRoot, sources, 'components'),
  // 静态资源目录
  assets: path.join(pkgRoot, sources, 'assets'),
}
