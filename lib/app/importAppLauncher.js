const endOfLine = require('os').EOL
const { ensurePathQuote, joinPath } = require('../utils/file')

// icefox代码目录：app
let appDir

module.exports = ({ config, importName = 'createApp' }) => {
  const { build_app_use_vuex: store, build_app_use_router: router } = config

  if (!appDir) {
    appDir = require('../utils/appPackages').app
  }

  let type
  if (store && router) {
    type = 'full'
  } else if (store && !router) {
    type = 'withStore'
  } else if (!store && router) {
    type = 'withRouter'
  } else {
    type = 'only'
  }

  const createAppFile = joinPath(appDir, `${type}.js`)

  return [`// app creator${endOfLine}`]
    .concat(`import ${importName} from '${ensurePathQuote(createAppFile)}'${endOfLine}`)
    .join(endOfLine)
}
