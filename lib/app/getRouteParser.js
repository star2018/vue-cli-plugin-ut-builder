const lodashCamelcase = require('lodash/camelCase')

const { getFileBaseName, relativePath, existsSync, joinPath } = require('../utils/file')

const { escapeRegExp, toUnKebabString } = require('../utils/common')

const {
  logIgnoredIndexRoute,
  logRedundantUnknownRoute,
  logInvalidUnknownRoute,
  logIgnoredUnknownChildrenRoutes,
  logIgnoredNamedViewRoutes,
  logInvalidNamedViewRoutes,
} = require('./logger')

const defaultPathFormatSetup = {
  leading: '',
  training: '',
}

function formatPath(path, setup) {
  const { leading = ':', training = '?', camelCase = true } = Object.assign({}, setup)
  const {
    ice_build_router_params_symbol: paramsSymbol = '_',
    ice_build_router_view_symbol: viewSymbol = '@',
  } = process.env

  // /(^|\/)~([^/]+?)(?=\/|$)/g
  const symbolRootNestedReg = /(^|\/)~([^/]+?)(?=\/|$)/g

  // /(^|\/)\[([^/]+?)](?=\/|$)/g
  const symbolNestedReg = /(^|\/)\[([^/]+?)](?=\/|$)/g

  // /(?:\/?@[^/]+|\.[^/]*)$/g
  const symbolViewReg = new RegExp(
    `(?:\\/?${escapeRegExp(viewSymbol)}[^/]+|\\.[^/]*)$`,
    'g'
  )

  const escapedParamsSymbol = escapeRegExp(paramsSymbol)

  // /(^|\/)(?:(_[^\/]*)|([^\/]+?_))(?=\/|$)/g
  const symbolParamsReg = new RegExp(
    `(^|\\/)(?:(${escapedParamsSymbol}[^\\/]*)|([^\\/]+?${escapedParamsSymbol}))(?=\\/|$)`,
    'g'
  )

  // /^(_)?(.*?)(_)?$/
  const paramsReg = new RegExp(
    `^(${escapedParamsSymbol})?(.*?)(${escapedParamsSymbol})?$`
  )

  return path
    .replace(symbolRootNestedReg, '$1$2')
    .replace(symbolNestedReg, '$1$2')
    .replace(symbolViewReg, '')
    .replace(symbolParamsReg, ($0, $1, $2, $3) => {
      return `${$1}${($2 || $3).replace(paramsReg, ($0, $1, $2, $3) => {
        return `${$1 && $2 ? leading : ''}${camelCase ? lodashCamelcase($2) : $2}${
          $3 ? training : ''
        }`
      })}`
    })
}

function getRelativePath(rootDir, file) {
  let pathname
  if (rootDir) {
    const relPath = relativePath(rootDir, file)
    if (relPath.startsWith('./')) {
      pathname = relPath.substring(2)
      if (pathname === '.') {
        pathname = '/'
      }
    }
  }
  return pathname === undefined ? `${getFileBaseName(file, true)}` : pathname
}

function setFilePath(module, pathname) {
  module.filePath = relativePath(process.cwd(), pathname).replace(/^\.\//, '')
}

function isIndexComponent(module) {
  const { pathname, children } = module
  if (!children) {
    return /^index\./i.test(getFileBaseName(pathname))
  }
  return false
}

function isUnknownRoute(module) {
  const { ice_build_router_params_symbol: paramsSymbol = '_' } = process.env
  // /^_{1,2}$/
  return new RegExp(`^${escapeRegExp(paramsSymbol)}{1,2}$`).test(
    getFileBaseName(module.pathname, true)
  )
}

function matchNamedView(fileName) {
  const { ice_build_router_view_symbol: viewSymbol = '@' } = process.env
  const escapedSymbol = escapeRegExp(viewSymbol)
  // /^(?:@|[^@]+@)([^.]+)(?:\.|$)/
  const regSource = `^(?:${escapedSymbol}|[^${escapedSymbol}]+${escapedSymbol})([^.]+)(?:\\.|$)`
  const matcher = new RegExp(regSource).exec(fileName)

  if (matcher) {
    return matcher[1]
  }
  return ''
}

function sortModuleProps(module, before = [], after = []) {
  const cloned = Object.assign({}, module)
  const keys = Object.keys(module)
  const beforeProps = before.filter((prop) => keys.includes(prop))
  const centerProps = keys.filter(
    (prop) => !before.includes(prop) && !after.includes(prop)
  )
  const afterProps = after.filter((prop) => keys.includes(prop))

  for (const key of keys) {
    delete module[key]
  }

  beforeProps
    .concat(centerProps)
    .concat(afterProps)
    .forEach((prop) => {
      module[prop] = cloned[prop]
    })
}

function getAbsoluteRoutePath(route) {
  const paths = [route.path]
  let parent
  while ((parent = route.parent)) {
    const { path } = parent
    paths.unshift(!path || path === '/' ? '' : path)
    route = parent
  }
  return paths.join('/')
}

function setPathAndName(route, parent, context) {
  const { pathname, name } = route
  if (typeof name === 'undefined') {
    route.name = toUnKebabString(
      formatPath(
        getRelativePath(context, pathname),
        Object.assign(
          {
            camelCase: false,
          },
          defaultPathFormatSetup
        )
      )
    )
  }

  //
  if (typeof route.path !== 'undefined') {
    route.absRoutePath = route.path
    return
  }

  if (parent) {
    const path = formatPath(getRelativePath(parent.pathname, pathname))
    if (/^(?:\?|)$/.test(path)) {
      route.path = ''
      route.absRoutePath = ''
    } else {
      route.path = path
      route.absRoutePath = getAbsoluteRoutePath(route)
    }
  } else {
    route.path = '/'
    route.absRoutePath = '/'
  }
  return route
}

function setIndexComponent(route, indexPath, context) {
  if (!route.component) {
    route.component = {
      bundle: indexPath,
      namespace: formatPath(getRelativePath(context, indexPath), defaultPathFormatSetup),
    }
    setFilePath(route, indexPath)
  } else {
    logIgnoredIndexRoute(route, indexPath)
  }
}

function setUnknownRoute(route, unknownRoute) {
  if (!route.root && !route.declareNested) {
    logInvalidUnknownRoute(route, unknownRoute)
  } else if (!route.unknown) {
    route.unknown = unknownRoute
  } else {
    logRedundantUnknownRoute(route, unknownRoute)
  }
}

function setNamedViewComponents(route, namedView, namedViewPathname, context) {
  const components = route.components || {}
  route.components = components
  components[namedView] = {
    bundle: namedViewPathname,
    namespace: `${formatPath(
      getRelativePath(context, namedViewPathname),
      defaultPathFormatSetup
    )}/${namedView}`,
  }
}

function checkNamedViewComponents(route) {
  const { components, component: routeComponent, parent } = route
  if (components) {
    if (!parent || parent.declareNested || parent.root) {
      if (!components.default) {
        if (routeComponent) {
          components.default = routeComponent
          delete route.component
        }
      } else if (routeComponent) {
        delete route.component
      }
      route.props = Object.keys(components).reduce((props, key) => {
        props[key] = true
        return props
      }, {})
    } else {
      delete route.components
      logInvalidNamedViewRoutes(route, components)
      return checkNamedViewComponents(route)
    }
  } else if (routeComponent) {
    route.props = true
  }
  return { components, component: routeComponent }
}

function findSpecialRouteModule(route, logger) {
  const { pathname } = route
  let special = null
  for (const module of route.children) {
    if (isIndexComponent(module)) {
      special = module
      break
    }
  }

  const ignoredRoutes = route.children
    .filter((route) => route !== special)
    .map((route) => route.pathname)
  logger(pathname, ignoredRoutes)

  return special
}

function findUnknownRoute(route) {
  return findSpecialRouteModule(route, logIgnoredUnknownChildrenRoutes)
}

function findNamedViewComponent(route) {
  return (findSpecialRouteModule(route, logIgnoredNamedViewRoutes) || {}).pathname
}

function resolveChildrenRoutes(route, context) {
  //
  let dirIndexPath = ''
  let dirUnknownRoute = null
  const { children, ignoredChildren } = route
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    const { pathname: childPathname } = child
    const fileName = getFileBaseName(childPathname)
    const namedView = matchNamedView(fileName)
    const unknownRoute = !namedView ? isUnknownRoute(child) : false
    let namedViewPathname = namedView ? childPathname : ''

    if (child.children) {
      const childChildren = child.children
      if (!namedView) {
        if (unknownRoute) {
          if (!dirUnknownRoute) {
            dirUnknownRoute = findUnknownRoute(child)
          }
          // 移除非子路由模块(unknownRoute)
          children.splice(index--, 1)
          ignoredChildren.push(child)
        } else if (
          fileName === 'index' &&
          childChildren.length === 1 &&
          isIndexComponent(childChildren[0])
        ) {
          dirIndexPath = childChildren[0].pathname
          // 移除非子路由模块(indexDirComponent)
          children.splice(index--, 1)
          ignoredChildren.push(child)
        }

        continue
      }

      // dir named view
      namedViewPathname = findNamedViewComponent(child)
      if (!namedViewPathname) {
        // 移除非子路由模块(invalidDirNamedView)
        children.splice(index--, 1)
        ignoredChildren.push(child)
        continue
      }
    }

    if (namedView) {
      setNamedViewComponents(route, namedView, namedViewPathname, context)
    } else if (unknownRoute) {
      setUnknownRoute(route, child)
    } else if (isIndexComponent(child)) {
      setIndexComponent(route, childPathname, context)
    } else {
      continue
    }

    // 移除非子路由模块(namedView、indexDirNamedView、indexComponent、unknownRoute)
    children.splice(index--, 1)
    ignoredChildren.push(child)
  }

  return { indexPath: dirIndexPath, unknownRoute: dirUnknownRoute }
}

//
module.exports = exports = (routerConfigPath, context) => {
  // 解析路由配置
  return (route, parent) => {
    const { pathname, relativePath, children, ignoredChildren } = route
    setPathAndName(route, parent, context)

    if (!children) {
      // 路由组件
      route.component = {
        bundle: pathname,
        namespace: relativePath,
      }
      checkNamedViewComponents(route)
      setFilePath(route, pathname)
      sortModuleProps(route, ['filePath', 'name', 'path'])
      return
    }

    const { indexPath, unknownRoute } = resolveChildrenRoutes(route, context)
    if (indexPath) {
      setIndexComponent(route, indexPath, context)
    }
    if (unknownRoute) {
      setUnknownRoute(route, unknownRoute)
    }

    checkNamedViewComponents(route)

    // 自定义路由配置
    let router = joinPath(pathname, routerConfigPath)
    if (existsSync(router)) {
      children.push({
        bundle: router,
        namespace: relativePath,
      })
    }

    // 未知路由匹配组件，放在最后
    const actualUnknownRoute = route.unknown
    if (actualUnknownRoute) {
      const index = children.findIndex((item) => item === actualUnknownRoute)
      if (index !== -1) {
        children.splice(index, 1)
      }
      children.push(actualUnknownRoute)
      actualUnknownRoute.parent = route
      actualUnknownRoute.path = '*'
      // 通配路由名称
      actualUnknownRoute.name = `${route.name.replace(/\/+$/, '')}/*`
    }

    // 属性排序
    sortModuleProps(route, ['filePath', 'name', 'path'], ['children'])
  }
}

exports.defaultPathFormatSetup = defaultPathFormatSetup
exports.getRelativePath = getRelativePath
exports.formatPath = formatPath
exports.sortModuleProps = sortModuleProps
