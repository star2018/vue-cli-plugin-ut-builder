const chalk = require('chalk')
const { asTree } = require('treeify')

const logger = require('../utils/logger')
const emitter = require('../utils/emitter')
const { clearTerminal } = require('../utils/cli')

const {
  getDirName,
  getFileBaseName,
  isDirectory,
  relativePath,
  joinPath,
} = require('../utils/file')

const cwd = process.cwd()

function getRelativePathUnderRoot(pathname, root = cwd) {
  return relativePath(root, pathname).replace(/^\.\//, '')
}

function getIgnoredRoutesTree(modulePath, ignoredRoutes, colorMark) {
  const tree = {}
  const module = getRelativePathUnderRoot(modulePath)
  tree[module] = {}
  for (const [index, routePath] of Object.entries(ignoredRoutes)) {
    const parent = getRelativePathUnderRoot(getDirName(routePath), modulePath)
    const fileName = getFileBaseName(routePath)
    if (parent === '.') {
      tree[module][
        colorMark ? colorMark(fileName, +index) : chalk['red'](`${fileName} -`)
      ] = null
    } else {
      tree[module][parent] = tree[module][parent] || {}
      tree[module][parent][
        colorMark ? colorMark(fileName, +index) : chalk['red'](`${fileName} -`)
      ] = null
    }
  }
  return tree
}

const warnings = []
const errors = []
let printTimer = 0
function printLog() {
  if (!warnings.length && !errors.length) {
    return
  }
  const printWarnings = warnings.concat()
  const printErrors = errors.concat()
  if (printTimer) {
    clearTimeout(printTimer)
  }
  printTimer = setTimeout(() => {
    clearTerminal()

    let log
    while ((log = printWarnings.shift())) {
      logger.warn(chalk['yellow'](typeof log === 'string' ? log : log.message))
    }
    while ((log = printErrors.shift())) {
      logger.error(chalk['red'](typeof log === 'string' ? log : log.message))
    }
    console.log()
  }, 80)
}

let timestamp
let refreshPrintTimer = 0
emitter
  .on('before-entry-update', () => {
    warnings.length = 0
    errors.length = 0
    timestamp = Date.now()
    clearTimeout(refreshPrintTimer)
  })
  .on('after-entry-refresh', () => {
    logger.done(chalk['green'](`Refreshed successfully in ${Date.now() - timestamp}ms\n`))
    clearTimeout(refreshPrintTimer)
    refreshPrintTimer = setTimeout(printLog, 80)
  })
  .on('before-watch-run', () => {
    clearTimeout(refreshPrintTimer)
  })
  .on('after-compile', printLog)

//
module.exports = exports = {
  warn(w) {
    if (typeof w === 'string' || (w && w.message)) {
      warnings.push(w)
    }
  },

  error(e) {
    if (typeof e === 'string' || (e && e.message)) {
      errors.push(e)
    }
  },

  logIgnoredNamedViewRoutes(modulePath, ignoredRoutes) {
    if (ignoredRoutes.length) {
      exports.warn(
        `The ${chalk['cyan'](
          getRelativePathUnderRoot(modulePath)
        )} directory contains a ${chalk['cyan'](
          process.env.ice_build_router_view_symbol || '@'
        )} symbol which is used as the named router view.\n${asTree(
          getIgnoredRoutesTree(modulePath, ignoredRoutes)
        )}`
      )
    }
  },

  logIgnoredUnknownChildrenRoutes(modulePath, ignoredRoutes) {
    if (ignoredRoutes.length) {
      exports.warn(
        `The ${chalk['cyan'](
          getRelativePathUnderRoot(modulePath)
        )} directory is used to match the unknown routing.\n${asTree(
          getIgnoredRoutesTree(modulePath, ignoredRoutes)
        )}`
      )
    }
  },

  logInvalidUnknownRoute(route, unknownRoute) {
    const { pathname } = unknownRoute
    const tree = {}
    const rootPath = getRelativePathUnderRoot(getDirName(pathname))
    const fileName = getFileBaseName(pathname)
    tree[rootPath] = {}
    tree[rootPath][chalk['red'](`${fileName} -`)] = null
    exports.warn(
      `Unknown routing ${chalk['cyan'](
        fileName
      )} must be applied under an nested routing.\n${asTree(tree)}`
    )
  },

  logIgnoredDynamicRoutes(route, dynamicRoutes) {
    if (dynamicRoutes.length > 1) {
      const tree = getIgnoredRoutesTree(
        route.pathname,
        dynamicRoutes.map(({ filePath, pathname }) =>
          filePath ? joinPath(cwd, filePath) : pathname
        ),
        (name, index) => chalk[index ? 'red' : 'green'](index ? `${name} -` : name)
      )
      exports.warn(
        `There are multiple dynamic routes under ${chalk['cyan'](
          getRelativePathUnderRoot(route.pathname)
        )}, and only the first one will take effect.\n${asTree(tree)}`
      )
    }
  },

  logIgnoredIndexRoute(route, indexPath) {
    const {
      pathname,
      component: { bundle },
    } = route
    const tree = {}
    const module = getRelativePathUnderRoot(pathname)
    const bundleName = getFileBaseName(bundle)
    const ignoredPath = getRelativePathUnderRoot(getDirName(indexPath), pathname)
    tree[module] = {}
    tree[module][chalk['green'](bundleName)] = null
    tree[module][ignoredPath] = {}
    tree[module][ignoredPath][chalk['red'](`${getFileBaseName(indexPath)} -`)] = null
    exports.warn(
      `There already have an index component named by ${chalk['cyan'](
        bundleName
      )} under the ${chalk['cyan'](module)} directory.\n${asTree(tree)}`
    )
  },

  logDuplicateDefinition(route, duplicateRoute) {
    const { pathname, filePath, parent, absRoutePath } = route
    const redundantPath = duplicateRoute.pathname
    const tree = {}
    const module = getRelativePathUnderRoot(parent.pathname)
    let root = (tree[module] = {})
    if (isDirectory(pathname)) {
      root = tree[module][getFileBaseName(pathname)] = {}
    }
    root[chalk['green'](getFileBaseName(filePath))] = null
    root = tree[module]
    if (isDirectory(redundantPath)) {
      root = tree[module][getFileBaseName(redundantPath)] = {}
    }
    root[chalk['red'](`${getFileBaseName(duplicateRoute.filePath)} -`)] = null
    exports.warn(
      `There already have an route definition of path ${chalk['cyan'](
        absRoutePath
      )} under the ${chalk['cyan'](module)} directory.\n${asTree(tree)}`
    )
  },

  logRedundantUnknownRoute(route, ignoredRoute) {
    const { pathname, unknown } = route
    const redundantPath = ignoredRoute.pathname
    const tree = {}
    const module = getRelativePathUnderRoot(pathname)
    const bundleName = getFileBaseName(unknown.pathname)
    const ignoredPath = getRelativePathUnderRoot(getDirName(redundantPath), pathname)
    tree[module] = {}
    tree[module][chalk['green'](bundleName)] = null
    tree[module][ignoredPath] = {}
    tree[module][ignoredPath][chalk['red'](`${getFileBaseName(redundantPath)} -`)] = null
    exports.warn(
      `There already have an unknown routing component named by ${chalk['cyan'](
        bundleName
      )} under the ${chalk['cyan'](module)} directory.\n${asTree(tree)}`
    )
  },

  logInvalidNestedRouting(route, routeExt) {
    const { filePath, pathname, children } = route
    const relPath = filePath || getRelativePathUnderRoot(pathname)
    const module = isDirectory(relPath, true)
      ? relPath
      : relPath.replace(/[\\/][^\\/]+$/, '')
    const tree = {}
    tree[module] = {}
    tree[module][chalk['green'](`index${routeExt} +`)] = null
    for (const { pathname, filePath } of children) {
      if (pathname && filePath) {
        let parent = tree[module]
        if (isDirectory(pathname, false)) {
          const baseName = getFileBaseName(pathname)
          parent = tree[module][baseName] || {}
          tree[module][baseName] = parent
        }
        parent[getFileBaseName(filePath)] = null
      }
    }
    exports.warn(
      `There is no route component defined under ${chalk['cyan'](
        module
      )} directory where contains some sub routes.\n${asTree(tree)}`
    )
  },

  logNestedRouteNonRouterView(route, name, namedRoutes, appPath) {
    const { components, component, layout, root, pathname } = route

    const bundles = []
    if (!root) {
      for (const { bundle } of Object.values(
        components || { default: component || {} }
      )) {
        if (bundle) {
          bundles.push(bundle)
        }
      }
    } else {
      bundles.push(layout)
    }

    let routerView
    if (!name || name === 'default') {
      routerView = '<router-view>'
    } else {
      routerView = `<router-view name="${name}">`
    }

    let relPath
    if (root) {
      relPath = layout ? getRelativePathUnderRoot(layout) : ''
    } else {
      relPath = getRelativePathUnderRoot(pathname)
    }

    const module = !isDirectory(relPath, true)
      ? relPath.replace(/[\\/][^\\/]+$/, '') || 'src'
      : relPath

    const rootPath = root ? pathname : joinPath(cwd, module)

    const tree = {}
    tree[module] = {}

    for (const bundle of bundles) {
      let parent = !root ? getRelativePathUnderRoot(getDirName(bundle), rootPath) : ''
      if (parent === '.' || root) {
        tree[module][
          chalk['cyan'](
            bundle
              ? getFileBaseName(bundle)
              : chalk['green'](`${getFileBaseName(appPath)} +`)
          )
        ] = null
      } else {
        tree[module][parent] = tree[module][parent] || {}
        tree[module][parent][chalk['cyan'](getFileBaseName(bundle))] = null
      }
    }

    const plusRouterView = chalk['green'](`${routerView} +`)
    tree[module][plusRouterView] = {}

    const viewsMap = {}
    const resetRoot = root
      ? getRelativePathUnderRoot(pathname, joinPath(cwd, module))
      : ''
    for (const { bundle } of namedRoutes || []) {
      let parent = getRelativePathUnderRoot(getDirName(bundle), rootPath)
      if (root) {
        if (parent === '.') {
          parent = resetRoot
        } else {
          viewsMap[resetRoot] = viewsMap[resetRoot] || {}
          viewsMap[resetRoot][parent] = viewsMap[resetRoot][parent] || {}
          viewsMap[resetRoot][parent][chalk['green'](getFileBaseName(bundle))] = null
          continue
        }
      }
      viewsMap[parent] = viewsMap[parent] || {}
      viewsMap[parent][chalk['green'](getFileBaseName(bundle))] = null
    }

    for (const [name, views] of Object.entries(viewsMap)) {
      tree[module][plusRouterView][name] = views
    }

    let moduleName
    if (root) {
      moduleName = 'layout'
    } else if (!route.parent) {
      moduleName = 'root'
    } else {
      moduleName = module
    }
    exports.warn(
      `There is no ${chalk['cyan'](routerView)} defined under ${chalk['cyan'](
        moduleName
      )} module where contains some sub-views.\n${asTree(tree)}`
    )
  },

  logInvalidNamedViewRoutes(route, components) {
    const { parent, pathname, nestedSetup } = route
    const tree = {}
    const subTree = {}
    const module = getRelativePathUnderRoot(pathname)
    const root = joinPath(cwd, module)
    const routes = Object.keys(components)
      .filter((item) => item !== 'default')
      .map((item) =>
        chalk['green'](getRelativePathUnderRoot(components[item].bundle, root))
      )
    routes.forEach((route) => {
      subTree[route] = null
    })

    let nested
    if (parent) {
      const reg = /[\\/]([^\\/]+)$/
      const root = module.replace(reg, '')
      if (!parent.manualNested) {
        nested = `${chalk['gray'](root)}  ${chalk['cyan']('->')}  ${chalk['gray'](
          root.replace(reg, ($0, $1) => {
            const rootNested = /^~.+/.test($1)
            return `/${rootNested ? '~' : ''}${chalk['green']('[')}${
              rootNested ? $1.replace(/^~/, '') : $1
            }${chalk['green'](']')}`
          })
        )}`
      } else {
        nested = `${chalk['gray'](root)}`
      }
      tree[nested] = {}
      tree[nested][module] = subTree
    }

    if (nestedSetup === 'none') {
      const setup = chalk['green'](`set appNestedRoutes = 'manual' (vue.config.js)`)
      tree[setup] = {}
      tree[setup][nested ? nested : module] = nested ? tree[nested] : subTree
      if (nested) {
        delete tree[nested]
      }
    }

    exports.warn(
      `Named route view under ${chalk['cyan'](
        module
      )} will not take effect for non-nested routing.\n${asTree(tree)}`
    )
  },

  logNonAppIndex(route, routeExt) {
    const tree = {}
    const rootPath = getRelativePathUnderRoot(route.pathname)
    tree[rootPath] = {}
    tree[rootPath][chalk['green'](`index${routeExt} +`)] = null
    exports.warn(
      `There is no app index component under ${chalk['cyan'](rootPath)}.\n${asTree(tree)}`
    )
  },

  logIgnoredBundles(bundles) {
    if (bundles.length) {
      const tree = {}
      for (const bundle of bundles) {
        const dir = getRelativePathUnderRoot(getDirName(bundle))
        tree[dir] = tree[dir] || {}
        tree[dir][chalk['red'](`${getFileBaseName(bundle)} -`)] = null
      }
      exports.warn(
        `As a result of the route has been ignored, these bundles will also be ignored.\n${asTree(
          tree
        )}`
      )
    }
  },
}
