const webpack = require('../../plugin/webpack')
const commonUtil = require('../../utils/common')
const emitter = require('../../utils/emitter')

let isFirstCompile = true
function printAddress(mockSocket, open) {
  return new Promise((resolve) => {
    mockSocket.printListenAddress((address) => {
      if (isFirstCompile) {
        isFirstCompile = false
        if (address && open) {
          commonUtil.openBrowser(address.local)
        }
      }
      //
      resolve()
    })
  })
}

//
module.exports = (
  { api, plugin, isDev, command, env: { args } },
  options,
  projectOptions
) => {
  if (!options || !isDev || command !== 'serve') {
    return false
  }

  const { ws, http } = Object.assign({}, options)
  let mockHttp = null
  if (http !== false) {
    const MockMiddleware = require('../../plugin/express/mock/http/MockMiddleware')
    mockHttp = new MockMiddleware(options, projectOptions)
  }
  const SocketMockServer = require('../../plugin/express/mock/socket/index')

  let mockSocket = null
  if (ws) {
    // websocket mock服务器
    mockSocket = new SocketMockServer(ws)
    const mockContext = mockSocket.getMockContext()
    plugin.configureProxyServer((config, ctx, ctxModifier) => {
      // 修改代理上下文，排除mock上下文
      mockContext.forEach((context) => {
        ctx = `(?:^(?!${context}))${ctx}`
      })
      ctxModifier(ctx)
    })
  }

  const open = args.open || Object.assign({}, projectOptions.devServer).open
  const hooks = {}

  if (mockHttp) {
    let defined
    hooks.watchRun = async (compiler) => {
      if (defined) {
        return
      }
      let port = process.env.MOCK_HTTP_PORT
      if (!port) {
        port = await new Promise((resolve) => {
          emitter.once('after-http-server-start', resolve)
        })
      }
      new webpack.DefinePlugin({
        'process.env': {
          MOCK_HTTP_PORT: JSON.stringify(port),
        },
      }).apply(compiler)
      defined = true
    }

    hooks.entryOption = () => {
      mockHttp.init()
    }
  }

  if (mockSocket) {
    hooks.done = () => printAddress(mockSocket, open)
  }

  if (Object.keys(hooks).length) {
    //
    plugin.use(
      { pluginName: 'CompilerEvent', configName: 'CompilerEventMockSocket' },
      () => ['MockSocketWebpackPlugin', hooks]
    )
  }

  //
  api.configureDevServer((express, devServer) => {
    const { listen } = devServer
    devServer.listen = (port, host, fn) => {
      const server = listen.call(devServer, port, host, fn)
      if (!server) {
        return
      }

      // 应用mock中间件
      if (mockHttp) {
        express.use(mockHttp['apply'].bind(mockHttp))
        // 初始化ajax转发代理中间件
        const ProxyMiddleware = require('../../plugin/express/mock/http/ProxyMiddleware')
        const httpProxy = new ProxyMiddleware({ port })
        express.use(httpProxy.apply.bind(httpProxy))
      }

      if (mockSocket) {
        mockSocket['over'](server)
      }
      process.env.MOCK_HTTP_PORT = port
      emitter.emit('after-http-server-start', port)
    }
  })
}
