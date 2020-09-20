// 显示未使用babel-loader的警告
let showLoaderWarning = function() {
  const chalk = require('chalk')
  require('../../utils/logger').warn(
    chalk.yellowBright.bold(`Can't found babel-loader! You should use it as default.\n`)
  )
  showLoaderWarning = null
}

// 检查是否有babel-loader
module.exports = function(config) {
  const module = config.module
  const yes = module.rules.has('js') && module.rule('js').uses.has('babel-loader')
  if (!yes && showLoaderWarning) {
    showLoaderWarning()
  }
  return yes
}
