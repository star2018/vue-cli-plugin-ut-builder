const { ensurePathQuote } = require('../utils/file')

const {
  getIdentifierMaker,
  randomSequence,
  transverseTree,
  escapeRegExp,
} = require('../utils/common')

const { sortRouteChildren } = require('./getModuleBundles')

function getMapRouteParamsToPropsUtil(type) {
  if (type === 'none' || type === 'params') {
    return {}
  }

  const name = `mapRouteParamsToProps`
  const code =
    type === 'query'
      ? `const ${name}=({query})=>({...query})\n`
      : `const ${name}=({params,query})=>({...params,...query})\n`

  return { name, code }
}

function getToArrayUtil() {
  const name = 'toArray'
  const code = `const ${name}=(arr)=>Array.isArray(arr)?arr:[]\n`
  return { name, code }
}

function getBundleImporter(importBundles, importNamesCount, tag, async, type = 'router') {
  const identifierMap = {}
  const makeIdentifier = getIdentifierMaker(type, importNamesCount)
  return (module) => {
    const { bundle, namespace } = Object.assign({}, module)
    if (!bundle) {
      return ''
    }
    const bundlePath = ensurePathQuote(bundle)
    const declared = identifierMap[bundlePath]
    const identifier = declared || makeIdentifier(namespace)
    identifierMap[bundlePath] = identifier
    if (!declared) {
      importBundles.push(
        async
          ? `const ${identifier}=()=>import('${bundlePath}')\n`
          : `import ${identifier} from '${bundlePath}'\n`
      )
    }
    return `${tag}${identifier}${tag}`
  }
}

function escapeObjectString(str, tagObject, tagValue) {
  return `${tagObject}${str
    .replace(new RegExp(`(['"])(${tagValue}.*?${tagValue})\\1`, 'g'), '`$2`')
    .replace(/(['"])(.*?)\1/g, `'$2'`)}${tagObject}`
}

function flattenDeep(routes, checkNested) {
  const list = []

  transverseTree(routes, (child) => {
    const { bundle, children, manualNested } = child
    list.push(child)
    if (bundle) {
      return
    }
    child.path = child.absRoutePath
    if (checkNested && manualNested) {
      child.children = flattenDeep(children, checkNested)
      sortRouteChildren(child, true)
      // 告知遍历器不要进行子树的迭代
      return 'exit'
    }
    // 告知遍历器在子树遍历完成后删除children属性
    return 'flat'
  })
  return list
}

// 转换为非嵌套的路由
function toFlattenRoutes(bundles, flattenRoutesPropName, checkNested) {
  const { children } = bundles
  if (children) {
    delete bundles.children
    bundles = [bundles].concat(flattenDeep(children, checkNested))
  } else {
    bundles = [bundles]
  }

  return bundles.filter((route) => {
    const { components, component, children, bundle, namespace } = route
    if (bundle) {
      route[flattenRoutesPropName] = [{ bundle, namespace }]
    }
    return !!(components || component || bundle || (children && children.length))
  })
}

function getReplacer(setup) {
  const {
    importRoutes,
    importComponent,
    tagObject,
    tagComponent,
    mapProps,
    mapPropsUtil,
    toArrayUtil,
    flattenRoutesPropName,
    routeProps,
  } = setup

  return (key, value) => {
    if (key === 'components') {
      return escapeObjectString(
        JSON.stringify(value, (k, v) => (k ? importComponent(v) : v)),
        tagObject,
        tagComponent
      )
    } else if (key === 'component') {
      return importComponent(value)
    } else if (key === 'props') {
      if (mapProps === 'none') {
        return
      }
      const code = `${tagComponent}${mapPropsUtil.name || true}${tagComponent}`
      if (value === true) {
        return code
      }
      return escapeObjectString(
        JSON.stringify(value, (k, v) => (k ? code : v)),
        tagObject,
        tagComponent
      )
    } else if (key === 'children' || key === flattenRoutesPropName) {
      if (!value.length) {
        return
      }
      for (const [index, child] of Object.entries(value)) {
        const marked = importRoutes(child)
        if (marked) {
          value[index] = marked
          if (!toArrayUtil.name) {
            Object.assign(toArrayUtil, getToArrayUtil())
          }
        }
      }
    }
    //
    if (/^(?:\d+|)$/.test(key) || routeProps.includes(key)) {
      return value
    }
  }
}

// 生成路由配置代码
module.exports = ({ bundles, config, publicPath, importName = 'routerOptions' }) => {
  const {
    build_app_use_router,
    build_app_nested_routes: nestedRoutes,
    build_app_router_mode: routerMode,
    build_code_splitting: async,
    build_router_map_props: mapProps,
  } = config

  if (!bundles || !build_app_use_router) {
    return `const ${importName}=undefined\n`
  }

  const routeProps = [
    'path',
    'name',
    'component',
    'components',
    'children',
    'props',
    'redirect',
    'alias',
  ]

  const routerImports = ['// router\n']
  const componentImports = ['// component\n']
  const utilityImports = []
  const importNamesCount = {
    [importName]: 1,
  }

  if (process.env.NODE_ENV !== 'production') {
    routeProps.push('filePath')
  }

  const tagRoutes = `<${randomSequence(10e8)}>`
  const tagComponent = `<${randomSequence(10e9)}>`
  const tagObject = `<${randomSequence(10e10)}>`
  const tagFlattenRoutes = `<${randomSequence(10e11)}>`
  const flattenRoutesPropName = `${tagFlattenRoutes}[Routes]${tagFlattenRoutes}`
  const flattenRoutes = ['manual', 'none'].includes(nestedRoutes)

  if (flattenRoutes) {
    routeProps.push(flattenRoutesPropName)
  }

  const importRoutes = getBundleImporter(routerImports, importNamesCount, tagRoutes)

  const importComponent = getBundleImporter(
    componentImports,
    importNamesCount,
    tagComponent,
    async,
    'comp'
  )

  const toArrayUtil = { name: '', code: '' }
  const mapPropsUtil = getMapRouteParamsToPropsUtil(mapProps)

  if (flattenRoutes) {
    bundles = toFlattenRoutes(bundles, flattenRoutesPropName, nestedRoutes === 'manual')
  }

  let rootRoute = JSON.stringify(
    bundles,
    getReplacer({
      importRoutes,
      importComponent,
      tagObject,
      tagComponent,
      mapProps,
      mapPropsUtil,
      toArrayUtil,
      flattenRoutesPropName,
      routeProps,
    })
  )

  if (toArrayUtil.name) {
    rootRoute = rootRoute.replace(
      new RegExp(`(['"])${tagRoutes}(.*?)${tagRoutes}\\1`, 'g'),
      `...${toArrayUtil.name}($2)`
    )
  }

  rootRoute = rootRoute
    .replace(new RegExp(`(['"\`])${tagComponent}(.*?)${tagComponent}\\1`, 'g'), '$2')
    .replace(new RegExp(`(['"])${tagObject}(.*?)${tagObject}\\1`, 'g'), '$2')

  let routes
  if (flattenRoutes) {
    routes = rootRoute.replace(
      new RegExp(
        `{\\s*(['"])${escapeRegExp(flattenRoutesPropName)}\\1\\s*:\\s*\\[(.*?)]\\s*}`,
        'g'
      ),
      '$2'
    )
  } else {
    routes = `[${rootRoute}]`
  }

  if (mapPropsUtil.code) {
    utilityImports.push(mapPropsUtil.code)
  }
  if (toArrayUtil.code) {
    utilityImports.push(toArrayUtil.code)
  }

  const routerOptions = `{mode:${JSON.stringify(routerMode)},base:${JSON.stringify(
    publicPath
  )},routes:${routes}}`

  return utilityImports
    .concat(routerImports)
    .concat(componentImports)
    .concat('// router options\n')
    .concat(`const ${importName}=${routerOptions}\n`)
    .join('\n')
}