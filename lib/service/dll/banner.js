const webpack = require('webpack')
const logger = require('../../utils/logger')
const shell = require('../../utils/cli')
const strUtil = require('../../utils/string')

// 获取提交hash
async function getGitCommitHash() {
  let hash = ''
  try {
    const res = await shell.exec('git rev-parse HEAD', { silent: true })
    if (res.code === 0) {
      hash = res.stdout.trim()
    }
  } catch (e) {
    logger.error(e.message)
  }
  return hash
}

// 过滤注释内容
function filterComment(str, data, hash) {
  if (typeof str === 'string') {
    const snippets = strUtil.getFilterSnippets(true)
    const { name, version } = snippets
    delete snippets.name
    delete snippets.version
    return strUtil.filter(
      str,
      Object.assign(snippets, data, {
        CommitHash: hash,
        GitHash: hash,
        GitCommitHash: hash,
        PackageName: name,
        PackageVersion: version,
      }),
      '',
      true
    )
  }
  return `${str}`
}

/**
 * 可用附加变量：
 * CommitHash: hash,
 * GitHash: hash,
 * GitCommitHash: hash,
 * PackageName: name,
 * PackageVersion: version
 * timestamp: +now,
 * time: `${hour}${minutes}${seconds}`,
 * date: `${year}${month}${date}`,
 * datetime: `${year}${month}${date}${hour}${minutes}${seconds}`,
 * @return Promise
 */
async function getOptions(options) {
  // 取得Git提交hash
  const commitHash = await getGitCommitHash()

  // 格式化参数
  if (typeof options === 'string' || typeof options === 'function') {
    options = {
      banner: options,
    }
  } else {
    options = Object.assign({}, options)
    if (typeof options.banner !== 'string' && typeof options !== 'function') {
      // 默认的注释内容
      options.banner =
        'Date: [datetime]\nPackage: [PackageName]\nVersion: [PackageVersion]\nCommit: [CommitHash]'
    }
  }

  // 处理用户参数
  const { banner } = options
  const proxyBanner = (data) =>
    filterComment(typeof banner === 'function' ? banner(data) : banner, data, commitHash)

  return Object.assign({}, options, { banner: proxyBanner })
}

// 应用注释插件
async function applyPlugin(compiler, options) {
  // 获取配置参数
  options = await getOptions(options)
  // 应用插件
  new webpack.BannerPlugin(options).apply(compiler)
}

// 产品构建模式，添加版本注释等
module.exports = ({ plugin, isProd }, options) => {
  if (!isProd || !options) {
    return false
  }
  // 使用编译器事件插件，监听webpack的开始编译事件
  plugin.use(
    {
      pluginName: 'CompilerEvent',
      configName: 'webpack-banner-config',
    },
    () => [
      'BannerConfigWebpackPlugin',
      {
        beforeRun: async (compiler) => applyPlugin(compiler, options),
      },
    ]
  )
}
