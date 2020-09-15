const path = require('path')

//
module.exports = ({ plugin, modernApp, modernBuild }, options) => {
  if (!options || (modernApp && !modernBuild)) {
    return false
  }
  const cwd = process.cwd()
  // 未使用文件查找服务
  plugin.use('^unused', (args) => [
    Object.assign(
      {
        directories: [path.join(cwd, 'src')],
        root: cwd,
      },
      args[0],
      options
    ),
  ])
}
