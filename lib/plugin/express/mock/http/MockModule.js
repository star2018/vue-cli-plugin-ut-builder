const pathToRegexp = require('path-to-regexp')
//
const logger = require('../../../../utils/logger')
//
const helper = require('../helper')

/**
 * mock module定义
 * @type {module.MockModule}
 */
module.exports = class MockModule {
  //
  constructor({ module, file }, options) {
    this.options = Object.assign({}, options)
    this.file = file
    const { delay, disabled, locate } = module
    //
    const exports = helper.getModuleDefaultExport(module)
    //
    this.mocks = Object.keys(exports).map((key) => {
      const data = exports[key]
      return this.normalize(key, data, { delay, disabled, locate, file })
    })
  }

  // 格式化
  normalize(api, data, { delay, disabled, locate, file }) {
    const type = typeof data
    if (type !== 'function' && type !== 'object') {
      logger.error(
        `\nMock value of "${api}" should be function or object, but got ${type}\n`
      )
    }
    const { delay: globalDelay, locate: globalLocate } = this.options
    const { method, path } = helper.parseApiPath(api)
    const keys = []
    const re = pathToRegexp(path, keys)
    delay = isNaN(delay)
      ? Math.max(Math.floor(+globalDelay || 0), 0)
      : Math.max(Math.floor(+delay), 0)
    locate = typeof locate === 'boolean' ? locate : !!globalLocate
    return {
      data,
      delay,
      locate,
      disabled,
      method,
      path,
      re,
      keys,
      file,
    }
  }

  // 执行匹配
  match(exceptMethod, exceptPath) {
    //
    exceptMethod = exceptMethod.toLowerCase()
    //
    for (const mock of this.mocks) {
      const { method, re } = mock
      if (method === exceptMethod) {
        const match = re.exec(exceptPath)
        if (match) {
          return {
            mock,
            match,
          }
        }
      }
    }
  }

  //
}
