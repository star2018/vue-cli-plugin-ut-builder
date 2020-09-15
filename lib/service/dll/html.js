//
const getEnv = require('../../utils/env')

function getPageOptions(page, options) {
  const setup = {}
  Object.keys(options).forEach((pattern) => {
    if (page.match(pattern)) {
      Object.assign(setup, options[pattern])
    }
  })
  return setup
}

function getTemplateParameters(parameters, defined, required, args) {
  const env = getEnv.ENV.ICE_DATA_PROCESS_DEFINED
  const appData = Object.keys(env).reduce((data, key) => {
    data[key] = JSON.stringify(env[key])
    return data
  }, {})
  if (typeof parameters === 'function') {
    parameters = parameters.apply(undefined, args)
  }
  return Object.assign({}, defined, appData, required, parameters)
}

// // HTML模板处理服务
module.exports = ({ plugin, env }, options, projectOptions) => {
  options = Object.assign({}, options)
  const { pluginOptions, pages } = projectOptions
  const { service } = Object.assign({}, pluginOptions)
  //
  const defined = service.define
  const required = {
    NODE_ENV: JSON.stringify(env.NODE_ENV),
    BASE_URL: projectOptions.publicPath,
  }
  //
  Object.keys(pages).forEach((page) => {
    plugin.use(`html-${page}`, (args) => {
      const arg = Object.assign({}, args[0], getPageOptions(page, options))
      const { templateParameters } = arg
      // 模板参数注入环境变量数据
      arg.templateParameters = (...args) => {
        return getTemplateParameters(templateParameters, defined, required, args)
      }
      return [arg]
    })
  })
}
