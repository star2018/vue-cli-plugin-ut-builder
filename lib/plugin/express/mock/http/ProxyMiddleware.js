const stream = require('stream')
const HttpProxy = require('http-proxy')
const onFinished = require('on-finished')
const chalk = require('chalk')

const { getNetworkHostIP } = require('../../../../utils/common')

module.exports = exports = class ProxyMiddleware {
  constructor(options) {
    const { port } = Object.assign({}, options)
    this.localPort = port
    // 本机网络地址
    getNetworkHostIP().then((ip) => {
      this.networkHost = `${ip}:${port}`
    })
    // 创建代理实例对象
    this.proxy = new HttpProxy({
      ws: false,
      xfwd: true,
      ignorePath: false,
      prependPath: false,
      changeOrigin: true,
      preserveHeaderKeyCase: true,
      proxyTimeout: 5000,
    })
    // 初始化事件监听
    this.initEvents()
  }

  initEvents() {
    this.proxy['on']('proxyRes', (proxyRes, req, res) => {
      // 添加响应头，标明数据涞源
      proxyRes.headers['X-Proxy-Remote'] = req.headers['x-proxy-remote']
      let body = Buffer.from('')
      // 响应数据抽取，供给Mock模块生成数据使用
      proxyRes.on('data', (chunk) => {
        body = Buffer.concat([body, chunk])
      })
      proxyRes.on('end', () => {
        res.rawBody = body
      })
    })
  }

  // 应用中间件
  apply(req, res, next) {
    const { localPort, networkHost } = this
    const { xhr, headers } = req
    const { 'x-proxy-remote': remoteHost } = Object.assign({}, headers)
    // 非ajax请求不代理，没有远程主机信息也不代理
    // 地址为当前内网本机网络地址，也不代理
    if (
      !xhr ||
      !remoteHost ||
      remoteHost === networkHost ||
      remoteHost === `localhost:${localPort}` ||
      remoteHost === `127.0.0.1:${localPort}`
    ) {
      next()
      return
    }

    if (!onFinished.isFinished(res)) {
      // 直接代理ajax转发
      this.webProxy(req, res)
    }
  }

  // 代理直接ajax请求
  webProxy(req, res) {
    req.url = req.originalUrl || req.url
    const target = `http://${req.headers['x-proxy-remote']}/`
    this.proxy['web'](
      req,
      res,
      {
        target,
        buffer: {
          pipe(proxyReq) {
            // 将原始请求的内容数据传给代理请求
            const rawBody = req.rawBody
            let inputStream
            if (rawBody) {
              inputStream = new stream.PassThrough()
              inputStream.end(rawBody)
            } else {
              inputStream = req
            }
            inputStream.pipe(proxyReq)
          },
        },
      },
      this.getErrorHandler(target)
    )
  }

  getErrorHandler(proxy) {
    return (err, req, res) => {
      const headers = req.headers || {}
      const url = req.url
      const host = headers.host
      const code = err.code

      console.log(
        `${chalk['red']('Proxy error:')} Could not proxy request ${chalk['cyan'](
          url
        )} from ${chalk['cyan'](host)} to ${chalk['cyan'](proxy)} (${chalk['red'](code)})`
      )

      if (res.writeHead && !res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'text/plain',
          'X-Proxy-Remote': headers['x-proxy-remote'] || '',
        })
      }
      res.end(
        `Proxy error: Could not proxy request ${url} from ${host} to ${proxy} (${code}).`
      )
    }
  }
}
