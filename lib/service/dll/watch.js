// 监听重编译
// watchRun done invalid
module.exports = ({ plugin, isDev, command }, options) => {
  if (!isDev || command !== 'serve') {
    return false
  }
  plugin.use('^compile-watch', () => [options])
}
