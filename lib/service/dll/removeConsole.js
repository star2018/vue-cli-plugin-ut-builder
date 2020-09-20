const hasBabelLoader = require('../../plugin/babel/hasBabelLoader')

// 移除console
module.exports = ({ config, merge, isProd }, options) => {
  if (!options || !isProd || !hasBabelLoader(config)) {
    return false
  }

  config.module
    .rule('js')
    .use('babel-loader')
    .loader('babel-loader')
    .tap((options) =>
      merge(options, {
        plugins: [['transform-remove-console', Object.assign({}, options)]],
      })
    )
}
