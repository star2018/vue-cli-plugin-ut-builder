const beginTimestamp = process.env.ICE_BUILD_COMMAND_TIMESTAMP || Date.now()
//
module.exports = ({ plugin, isDev, modernApp, modernBuild }, options) => {
  if (!options || isDev || (modernApp && !modernBuild)) {
    return false
  }
  // 构建耗时统计服务
  plugin.use('^time-cost', (args) => [
    Object.assign(
      {
        beginTimestamp,
      },
      args[0],
      options
    ),
  ])
}
