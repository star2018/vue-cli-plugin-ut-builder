const EventEmitter = require('events').EventEmitter
//
const { Stomp, FrameImpl } = require('@stomp/stompjs')
const uuidv4 = require('uuid/v4')

const debug = require('debug')('mock:socket:stompManager')

const proxyServer = require('./proxyServer')
const connection = require('./connection')

const helper = require('../helper')

if (typeof TextEncoder === 'undefined' || typeof TextDecoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util')
  global.TextEncoder = TextEncoder
  global.TextDecoder = TextDecoder
}
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws')
}

class StompManager extends EventEmitter {
  constructor(options) {
    super()
    this.subscribes = {}
    this.options = Object.assign({}, options)
  }

  createStompServer(options) {
    const { socket, req } = options
    socket.url = req.url
    //
    const context = uuidv4()
    const server = Stomp.over(socket)
    //
    const {
      setup,
      message: frameHandler,
      error: errorHandler,
    } = this.getStompFrameHandler({
      context,
      server,
      socket,
      req,
    })
    let connect = null
    //
    server.configure({
      debug,
      beforeConnect: () => {
        return new Promise((resolve) => {
          connect = resolve
        })
      },
      onUnhandledFrame: frameHandler,
      onUnhandledMessage: frameHandler,
      onStompError: errorHandler,
    })
    //
    server.activate()
    //
    return {
      send: (body, headers) => {
        this.send(body, headers, socket)
      },
      configure: (options) => {
        options = Object.assign({}, options)
        const handlers = [
          'messageHandler',
          'subscribeHandler',
          'unsubscribeHandler',
          'frameHandler',
          'errorHandler',
        ]
        handlers.forEach((key) => {
          const handler = options[key]
          if (typeof handler === 'function') {
            setup[key] = handler
          }
        })
        if (typeof connect === 'function') {
          connect()
        }
      },
    }
  }

  getStompFrameHandler(setup) {
    setup = Object.assign({}, setup)
    return {
      setup,
      message: (frame) => {
        const { frameHandler } = setup
        const state = Object.assign({}, setup, {
          frame,
        })
        if (!frameHandler) {
          this.handleFrame(state)
        } else {
          frameHandler(state)
        }
      },
      error: (err) => {
        debug(err.message)
      },
    }
  }

  //
  handleFrame(setup) {
    const {
      frame,
      server,
      socket,
      req,
      context,
      messageHandler,
      subscribeHandler,
      unsubscribeHandler,
      errorHandler,
    } = setup
    //
    const { headers: reqHeaders } = req
    const { command, headers } = frame
    const { destination, id } = headers || {}
    const channel = destination || id
    //
    const state = {
      frame,
      headers,
      server,
      socket,
      req,
      context,
      channel,
      id,
    }
    debug('received stomp message. %j', { command, headers })
    if (command === 'CONNECT') {
      const connectHeaders = {}
      connectHeaders['accept-version'] = server.stompVersions.versions.join(',')
      connectHeaders['heart-beat'] = [10000, 10000].join(',')
      connectHeaders['server'] = reqHeaders.host || reqHeaders.origin
      //
      this.transmit(socket, {
        command: 'CONNECTED',
        headers: connectHeaders,
      })
      //
    } else if (command === 'DISCONNECT') {
      this.disconnect(server)
      //
    } else if (command === 'SUBSCRIBE') {
      if (subscribeHandler) {
        subscribeHandler(state)
      }
      debug('stomp subscribed. %s#%s', context, channel)
      //
    } else if (command === 'UNSUBSCRIBE') {
      if (unsubscribeHandler) {
        unsubscribeHandler(state)
      }
      debug('stomp unsubscribed. %s#%s', context, channel)
      //
    } else if (command === 'SEND') {
      if (messageHandler) {
        messageHandler(state)
      }
      debug('stomp received data. %s#%s', context, channel)
      //
    } else if (command === 'ERROR') {
      if (errorHandler) {
        errorHandler(state)
      }
      debug('stomp received error. %s#%s', context, channel)
    }
  }

  //
  connect(stomp) {
    stomp.configure({
      messageHandler: (state) => {
        this.receive(state)
      },
      subscribeHandler: (state) => {
        this.subscribe(state)
      },
      unsubscribeHandler: (state) => {
        const { context, id } = state
        this.unsubscribe(context, id)
      },
      errorHandler: (frame) => {
        debug('Broker reported error: %s', frame.headers['message'])
        debug('Additional details: %s', frame.body)
      },
    })
  }

  //
  subscribe(setup) {
    const { subscribes } = this
    const { server, headers, req, id, socket, context, channel } = setup
    const serveChannel = `${context}#${channel}`
    let co = subscribes[serveChannel]
    if (!co) {
      co = connection(
        null,
        () => {
          this.disconnect(server, channel)
        },
        req.url,
        channel,
        'stomp'
      )
      //
      socket.once('close', () => {
        this.unsubscribe(context)
        co.close()
      })
      //
      subscribes[serveChannel] = co
      //
      proxyServer.emit('connection', co)
    }
    //
    co.subscribes = co.subscribes || {}
    const sender = (data) => {
      this.send(data, headers, socket)
      //
      debug('sending data to client. %s#%s', channel, id)
    }
    co.subscribes[id] = sender
    //
    co.on('mock', sender)
  }

  //
  unsubscribe(context, id) {
    const subscribes = this.subscribes
    for (const key of Object.keys(subscribes)) {
      if (key.startsWith(context)) {
        if (id) {
          const co = subscribes[key]
          const sender = co.subscribes[id]
          if (typeof sender === 'function') {
            co.removeListener('mock', sender)
            delete co[id]
          }
        } else {
          delete subscribes[key]
        }
        break
      }
    }
  }

  //
  receive(state) {
    const { frame, context, channel } = state
    if (!frame.isBodyEmpty()) {
      const { subscribes } = this
      const co = subscribes[`${context}#${channel}`]
      if (co) {
        co.send(frame.body)
      }
    }
  }

  send(data, headers, socket) {
    const { body, binaryBody, contentType, contentLength } = helper.getDataBody(data)
    this.transmit(socket, {
      body,
      binaryBody,
      command: 'MESSAGE',
      skipContentLengthHeader: false,
      headers: Object.assign({}, headers, {
        subscription: headers.id,
        'message-id': Math.floor(Math.random() * 10e8 + Date.now()),
        'content-type': contentType,
        'content-length': contentLength,
      }),
    })
  }

  transmit(
    socket,
    { command, headers, body, binaryBody, skipContentLengthHeader, escapeHeaderValues }
  ) {
    const { pluginName, socketType } = this.options
    const frame = new FrameImpl({
      command,
      headers: Object.assign({}, headers, {
        'mocked-by': pluginName,
        'client-type': socketType,
      }),
      body,
      binaryBody,
      skipContentLengthHeader,
      escapeHeaderValues,
    })
    const rawChunk = frame.serialize()

    debug(`>>> ${frame}`)

    socket.send(rawChunk)
  }

  disconnect(server, channel) {
    try {
      server.disconnect()
      debug(`stomp connection has been closed. ${channel ? `[${channel}]` : ''}`)
    } catch (e) {
      debug('close stomp server error. %s', e.message)
    }
  }

  stringify(data) {
    if (typeof data !== 'string') {
      try {
        data = JSON.stringify(data)
      } catch (e) {
        debug('stringify error. %s', e.message)
        data = ''
      }
    }
    return data
  }
}

let manager = null

module.exports = (options) => {
  if (!manager) {
    manager = new StompManager(options)
  }
  return manager
}
