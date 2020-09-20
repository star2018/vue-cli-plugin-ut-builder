const chalk = require('chalk')
//
const logger = require('../../../../utils/logger')
const fileUtil = require('../../../../utils/file')
const commonUtil = require('../../../../utils/common')
//
const registerBabel = require('../../../babel/registerBabel')
//
const MockModule = require('./MockModule')
const helper = require('../helper')

/**
 * 管理mock模块文件
 * @type {module.ModuleManager}
 */
module.exports = class ModuleManager {
  //
  constructor(options, updateCallback) {
    this.options = Object.assign({}, options)
    this.updateCallback = updateCallback || (() => {})
    this.mockFiles = []
    this.mockModules = []
    const { path: mockPath } = this.options
    //
    this.registerBabelTransform()
    //
    const { files, pattern } = this.getMockFiles(mockPath)
    this.loadMockModules(files)
    //
    this.watchModulesFile(pattern)
  }

  //
  registerBabelTransform() {
    const extraIncludeFiles = [
      /([\\/])@babel\1runtime.*?\1esm\1/,
      /([\\/])babel-runtime.*?\1esm\1/,
    ]
    registerBabel({
      ignore: [
        (path) => {
          if (/([\\/])node_modules\1/.test(path)) {
            return !extraIncludeFiles.some((re) => re.test(path))
          }
          return !this.mockFiles.includes(path)
        },
      ],
    })
  }

  // 排除不需要转译的文件
  excludeSomeFiles(files) {
    const { exclude } = this.options
    return exclude ? files.filter((file) => !exclude(file)) : files
  }

  // 获取mock模块文件
  getMockFiles(mockPath) {
    mockPath = helper.getRelMockPath(mockPath)
    if (fileUtil.isGlob(mockPath)) {
      return {
        files: this.excludeSomeFiles(
          fileUtil
            .matchFileSync(mockPath, { nodir: true })
            .map((file) => fileUtil.resolvePath(file))
        ),
        pattern: mockPath,
      }
    }
    const absMockPath = fileUtil.getAbsPath(mockPath)
    let files = []
    if (fileUtil.isDirectory(absMockPath)) {
      logger.log(`Load mock data from ${absMockPath} `)
      files = fileUtil
        .matchFileSync('**/*.js', {
          cwd: absMockPath,
          nodir: true,
        })
        .map((file) => fileUtil.joinPath(absMockPath, file))
    }
    return {
      files: this.excludeSomeFiles(files),
      pattern: `${mockPath.replace(/[\\]/g, '/').replace(/\/+$/g, '')}/**/*.js`,
    }
  }

  // 加载mock数据
  loadMockModules(mockFiles) {
    //
    let hasErrors = false
    this.mockModules = mockFiles.reduce((modules, file) => {
      const module = this.loadModule(file)
      if (module) {
        modules.push(module)
      } else {
        hasErrors = true
      }
      return modules
    }, [])
    //
    if (!hasErrors) {
      logger.log('Mock file parsed successfully.\n')
    }
  }

  loadModule(absPath) {
    let module = null
    try {
      const { options, mockFiles } = this
      if (!mockFiles.includes(absPath)) {
        mockFiles.push(absPath)
      }
      delete require.cache[absPath]
      module = new MockModule({ module: require(absPath), file: absPath }, options)
    } catch (e) {
      logger.error(`\nMock file parse failed [${absPath}] [${e.message}]\n`)
    }
    return module
  }

  // 监听文件变化，重新加载数据
  watchModulesFile(pattern) {
    const { exclude, defaultDisabled } = this.options
    commonUtil.watch(
      pattern,
      (event, file) => {
        if (exclude(file)) {
          return
        }
        logger.echo(
          `Mock ${chalk.cyan(event)}: ${file}, reload mock data. ${
            event === 'add' && defaultDisabled
              ? chalk.yellow(
                  'The new module is disabled by default, you may need to manually enable it.'
                )
              : ''
          }`
        )
        // 更新模块
        this.updateMockModule(file, event)
      },
      {
        delay: 0,
      }
    )
  }

  // 更新模块
  updateMockModule(file, type) {
    const { mockModules, mockFiles, updateCallback } = this
    const absPath = fileUtil.getAbsPath(file)
    // clear
    for (let i = 0; i < mockFiles.length; i++) {
      const file = mockFiles[i]
      if (file === absPath || file.startsWith(absPath)) {
        mockFiles.splice(i, 1)
        break
      }
    }
    for (let i = 0; i < mockModules.length; i++) {
      const moduleFile = mockModules[i].file
      if (moduleFile === absPath || moduleFile.startsWith(absPath)) {
        mockModules.splice(i, 1)
        break
      }
    }
    // reload
    let module = null
    if (type !== 'unlink' && type !== 'unlinkDir') {
      module = this.loadModule(absPath)
      if (module) {
        mockModules.unshift(module)
      }
    }
    // notice
    updateCallback(module)
  }

  getMockModules() {
    const { mockModules } = this
    if (Array.isArray(mockModules)) {
      return [].concat(mockModules)
    }
    return []
  }

  //
}
