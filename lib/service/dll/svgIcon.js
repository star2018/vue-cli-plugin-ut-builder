const lodashTemplate = require('lodash/template')
const {
  getDefaultIconsDirectory,
  toKebabString,
  formatCode,
  hash,
  randomSequence,
} = require('../../utils/common')

const {
  existsSync,
  getAbsPath,
  ensurePathQuote,
  writeFileSync,
  removeSync,
  relativePath,
} = require('../../utils/file')

const Service = require('../../service/ConfigService')
const emitter = require('../../utils/emitter')

const defaultIconPath = getDefaultIconsDirectory()

const codeTemplate = lodashTemplate(
  `
function importModules(require) {
  var keys = require.keys()
  for(var k = 0; k < keys.length; k++) {
    require(keys[k]);
  }
}
<% for (var i = 0; i < existPaths.length; i++) { %>
  importModules(require.context(<%= existPaths[i] %>, true, /\\.svg$/));
<% } %>
`,
  {
    interpolate: /<%=([\s\S]+?)%>/g,
  }
)

let fileHash

//
function generateBundleFile(output, paths) {
  const code = formatCode(
    codeTemplate({
      existPaths: paths
        .filter((path) => existsSync(path))
        .map((path) => `'${ensurePathQuote(path)}'`),
    })
  )
  const codeHash = hash(code)
  if (fileHash !== codeHash) {
    fileHash = codeHash
    writeFileSync(output, code, { encoding: 'utf8' })
  }
}

// 创建svg图标导入文件
function createSvgIconImporter(iconPaths) {
  let timer = 0
  const output = getAbsPath('node_modules/.assets/icons/importSvgIcons.js')
  const update = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      emitter.emit('before-entry-update')
      generateBundleFile(output, iconPaths)
      emitter.emit('after-entry-update')
    }, 80)
  }

  // 清理文件
  removeSync(output)
  // 加载器
  return () => {
    if (existsSync(output)) {
      update()
    } else {
      generateBundleFile(output, iconPaths)
    }
    return output
  }
}

function parseOptions(options) {
  const parsedOptions = []
  for (const opts of Array.isArray(options) ? options : [options]) {
    let config
    if (opts !== null && typeof opts === 'object') {
      const { src, prefix, kebabCaseName } = Object.assign({}, opts)
      if (typeof src === 'string') {
        config = {
          src,
          kebabCaseName,
          prefix: typeof prefix === 'string' ? prefix.replace(/-+\s*$/, '') : '',
        }
        if (kebabCaseName === undefined) {
          config.kebabCaseName = !!config.prefix
        }
      }
    } else if (opts === true || typeof opts === 'string') {
      config = {
        src: opts === true ? defaultIconPath : opts,
        prefix: '',
        kebabCaseName: false,
      }
    }

    let src = config ? config.src : ''
    if (src) {
      config.src = src = getAbsPath(src)
      if (!parsedOptions.some((item) => item.src === src)) {
        parsedOptions.push(config)
      }
    }
  }
  return parsedOptions
}

// 处理svg图标
module.exports = ({ plugin, isProd, config, watch }, options) => {
  if (!options) {
    return false
  }

  const parsedOpts = parseOptions(options)
  if (!parsedOpts.length) {
    return false
  }

  const iconPaths = parsedOpts.map((opts) => opts.src)

  // 默认的svg加载规则是使用file-loader进行base64处理
  // 这里排除图标svg
  config.module.rule('svg').exclude.add(iconPaths)

  // 添加svg图标加载器
  config.module
    .rule('svg-icons')
    .test(/\.svg$/)
    .include.add(iconPaths)
    .end()
    .use('svg-sprite-loader')
    .loader(require.resolve('svg-sprite-loader'))
    .options({
      symbolId(filePath) {
        for (const { src, prefix, kebabCaseName } of parsedOpts) {
          const relPath = relativePath(src, filePath)
          if (relPath.startsWith('./')) {
            const name = relPath.replace(/(?:^\.\/|\..*$)/g, '')
            const iconPrefix = prefix ? `${prefix}-` : ''
            return `${iconPrefix}${kebabCaseName ? toKebabString(name) : name}`
          }
        }
        return `icon${randomSequence(10e10)}`
      },
    })

  //
  const importer = createSvgIconImporter(iconPaths)

  // 注册svg图标依赖
  Service.addEntryDependency(importer())

  if (!isProd) {
    // 监听文件的变化
    watch(
      iconPaths,
      {
        addDir: importer,
        unlinkDir: importer,
      },
      {
        delay: 0,
        nodir: false,
      }
    )
  }
}
