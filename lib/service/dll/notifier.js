// 系统通知
module.exports = ({ plugin, modernApp, modernBuild, env }, options) => {
  if (!options || env.ICE_BUILD_DISABLE_NOTIFIER) {
    return false
  }

  const fileUtil = require('../../utils/file')

  const { contentImage } = Object.assign({}, options)

  const images = [
    contentImage,
    'notifier.png',
    fileUtil.joinPath(__dirname, '../../assets/webpack.png'),
  ]

  let absContentImage = ''
  for (const img of images) {
    const path = typeof img === 'string' ? img.trim() : ''
    if (path) {
      const absPath = fileUtil.getAbsPath(path)
      if (fileUtil.existsSync(absPath)) {
        absContentImage = absPath
        break
      }
    }
  }

  const skipFirst = modernApp && !modernBuild

  // 构建结果，系统通知服务
  plugin.use(
    {
      configName: 'notifier',
      pluginName: 'webpack-notifier',
    },
    (args) => [
      Object.assign(
        {
          title: 'Webpack',
          alwaysNotify: false,
          excludeWarnings: true,
          skipFirstNotification: skipFirst,
        },
        args[0],
        options,
        {
          contentImage: absContentImage,
        }
      ),
    ]
  )
}
