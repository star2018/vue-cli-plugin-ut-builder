const { Client } = require('ssh2')
const scp2 = require('scp2')
const chalk = require('chalk')

const { readPrivateKey } = require('./key')
const { suspend, trimShellQuotes, fillCommandArgs, getQuestionAnswers } = require('./cli')

const debug = require('debug')('utils:ssh')

const validator = require('./validator')
const logger = require('./logger')

// 默认的参数查询配置
const defaultQuestions = (conditions) => ({
  host: {
    type: 'string',
    question: {
      message: 'Please enter the remote host:',
      when: () => !conditions.host,
      filter: (answer) => answer.trim(),
      validate: (answer) =>
        validator.isIP(answer) ||
        validator.isDomainName(answer) ||
        'Invalid host address, please re-enter it',
    },
  },
  port: {
    type: 'number',
    question: {
      message: 'Please enter the remote port:',
      default: 22,
      when: () => !conditions.port,
      filter: (answer) => +answer,
      validate: (answer) =>
        (!isNaN(answer) && answer > 0 && answer < 65535) ||
        'Invalid host port, please re-enter it',
    },
  },
  user: {
    type: 'string',
    question: {
      message: 'Please enter the username:',
      default: 'root',
      when: () => !conditions.user,
      filter: (answer) => answer.trim(),
      validate: (answer) =>
        validator.isNotEmptyString(answer) ||
        'The username cannot be empty, please re-enter it',
    },
  },
  pwd: {
    question: {
      type: 'password',
      message: 'Please enter the password:',
      when: () => !conditions.privateKey,
      filter: (answer) => answer.trim(),
      validate: (answer) =>
        validator.isNotEmptyString(answer) ||
        'The password cannot be empty, please re-enter it',
    },
  },
  interactive: {
    type: 'boolean',
    default: true,
  },
  'private-key': {
    type: ['string', 'boolean'],
    default: false,
  },
})

// 校验密码交互
const validatePasswordQuestion = [
  {
    type: 'input',
    name: 'username',
    default: 'root',
    message: 'Please enter the username:',
    filter: (answer) => answer.trim(),
    validate: (answer) =>
      validator.isNotEmptyString(answer) ||
      'The username cannot be empty, please re-enter it',
  },
  {
    type: 'password',
    name: 'password',
    message: 'Please enter the password:',
    filter: (answer) => answer.trim(),
    validate: (answer) =>
      validator.isNotEmptyString(answer) ||
      'The password cannot be empty, please re-enter it',
  },
]

// 是否是校验错误异常
function isAuthError(err) {
  return !!(err && err.level === 'client-authentication')
}

// 交互式重连
async function interactiveReconnect(args, spinner) {
  let count = 5 // 最大重连数

  const inquire = async () => {
    const { username, password } = await getQuestionAnswers(validatePasswordQuestion)
    console.log()
    return await createConnection(
      Object.assign({}, args, {
        username,
        password,
      }),
      spinner
    ).catch(async (err) => {
      if (!--count || !isAuthError(err)) {
        throw err
      }
      return await inquire()
    })
  }

  return await inquire()
}

// 进行ssh连接
async function connect(args, interactive, spinner) {
  const { privateKey, privateKeyPath } = args
  if (privateKey && privateKeyPath) {
    spinner.info(
      `Try to authenticate by the private key '${chalk['cyan'](privateKeyPath)}'.\n`
    )
  }
  // 创建连接
  return await createConnection(args, spinner).catch(async (err) => {
    if (!isAuthError(err)) {
      throw err
    }

    if (args.privateKey) {
      // 本次使用公钥验证
      args.privateKey = ''
      args.passphrase = ''

      if (interactive || (args.user && args.pwd)) {
        // 切换至用户名密码登录
        spinner.info(`${chalk['cyan']('Switched to use password for logon.')}\n`)
        return connect(args, interactive, spinner)
      }
      // 本次使用密码验证
    } else if (interactive) {
      // 重新输入密码登录
      return await interactiveReconnect(args, spinner)
    }
    // 不能继续登录
    throw err
  })
}

// 执行命令
function execCommand(co, command, pipe) {
  if (typeof command !== 'string') {
    return Promise.resolve('')
  }
  return new Promise((resolve, reject) => {
    const script = command.trim()
    co.exec(script, (err, stream) => {
      if (err) {
        reject(err)
        return
      }
      let buffer
      const { stdout, stderr } = Object.assign(
        {
          stdout: process.stdout,
          stderr: process.stderr,
        },
        pipe
      )
      if (pipe) {
        if (stdout) {
          stream.pipe(stdout)
        }
        if (stderr) {
          stream.stderr.pipe(stderr)
        }
      } else {
        buffer = Buffer.from('')
        stream
          .on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk])
          })
          .stderr.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk])
          })
      }
      //
      stream.once('close', (code, signal) => {
        if (pipe) {
          if (stdout) {
            stream.unpipe(stdout)
          }
          if (stderr) {
            stream.stderr.unpipe(stderr)
          }
        }
        const output = buffer ? buffer.toString().trim() : ''
        if (`${code}` !== '0') {
          const error = new Error(output)
          error.code = code
          error.signal = signal
          error.script = script
          reject(error)
        } else {
          resolve(output)
        }
      })
    })
  })
}

// 处理连接就绪事件
function handleReady(co, spinner) {
  // 同步系统基础信息
  return execCommand(co, 'uptime')
    .then((out) => {
      spinner.info(`${out}\n`)
      spinner.succeed('The ssh server has been successfully connected.\n')
      return co
    })
    .catch((err) => {
      try {
        co.end()
      } catch (e) {
        console.error(e)
      }
      throw err
    })
}

// 创建连接对象
function createConnection(args, spinner) {
  return new Promise((resolve, reject) => {
    const setup = Object.assign(
      {
        readyTimeout: 10000,
      },
      args,
      {
        tryKeyboard: false,
        authHandler(methodsLeft, partialSuccess, callback) {
          if (methodsLeft === null) {
            callback(setup.privateKey ? 'publickey' : 'password')
          } else {
            callback(false)
          }
        },
      }
    )

    let conn = new Client()

    let catchError = (err) => {
      err = err || new Error('Connect failed.')
      if (conn) {
        try {
          conn.end()
        } catch (e) {
        } finally {
          conn = null
          spinner.fail(
            isAuthError(err)
              ? `Authentication failure. By ${
                  args.privateKey ? 'public key' : 'password'
                }.`
              : err.message
          )
          console.log()
        }
      }
      reject(err)
      catchError = null
    }

    process.once('uncaughtException', catchError)
    spinner.start('Waiting for connect to the server...')
    try {
      conn
        .once('ready', () => resolve(handleReady(conn, spinner)))
        .once('error', catchError)
        // 进行连接
        .connect(setup)
    } catch (e) {
      catchError(e)
    }
  })
}

// 加载私钥
async function loadPrivateKey(privateKeyPath, privateToken, interactive) {
  let privateKey
  let passphrase

  privateKeyPath = trimShellQuotes(privateKeyPath)

  if (typeof privateKeyPath === 'string' || privateKeyPath === true) {
    if (privateKeyPath === true) {
      privateKeyPath = undefined
    }

    // 获取私钥信息
    const { content, passphrase: token, path } = await readPrivateKey(
      privateKeyPath,
      privateToken,
      interactive
    )

    privateKey = content
    privateKeyPath = path
    passphrase = token
  }
  return { privateKey, passphrase, privateKeyPath }
}

// 解析参数
async function resolveArgs(options, urlResolver, interactive) {
  const { questions, url, privateKey } = options
  const argsDefine = defaultQuestions({
    privateKey,
  })

  for (const [key, value] of Object.entries(questions)) {
    if (questions[key] !== undefined) {
      argsDefine[key] = value
    }
  }

  // 从url中解析主机用户信息
  if (url && typeof url === 'string') {
    const parsedUrl = require('parse-url')(url)
    if (typeof urlResolver === 'function') {
      Object.assign(argsDefine, urlResolver(parsedUrl, argsDefine))
    } else {
      const { resource: host, protocol, port, user } = parsedUrl
      if (protocol === 'ssh') {
        argsDefine.host = host
        if (port !== null) {
          argsDefine.port = port
        }
        if (user) {
          argsDefine.user = user
        }
      }
    }
  }

  // 获取连接参数
  return await fillCommandArgs(argsDefine, interactive)
}

// 打印连接地址信息
function printAddress(details, echo = logger) {
  const { user, host, port } = details
  echo.info(`The connection address is: `)
  //
  logger.logWithBoxen(`${chalk['cyan'](`${user}@${host}${port ? `:${port}` : ''}`)}`)
}

// 文件传输
class FileTransferClient extends scp2.Client {
  constructor(sftp, progressHandler) {
    super()
    this.sftpClient = sftp
    if (typeof progressHandler === 'function') {
      this.on('transfer', (buf, lastCursor, length) => {
        progressHandler(Math.floor((100 * (+lastCursor || 0)) / (+length || 1)))
      })
    }
  }

  sftp(callback) {
    callback(null, this.sftpClient)
  }

  close() {
    if (this.sftpClient) {
      this.sftpClient.end()
      this.sftpClient = null
    }
    this.emit('close')
  }
}

class SSH {
  // 连接
  async connect(questions, extra) {
    const {
      'private-key': privateKeyPath = false,
      suspend: waiting = true, // 连接前暂停执行，等待用户确认
      interactive = true, // 是否启用控制台交互
      url = '', // url地址，用于解析用户名及连接地址信息
    } = Object.assign({}, require('minimist')(process.argv.slice(2)), questions)

    if (waiting && interactive) {
      debug('do suspend.')
      await suspend(true)
    }

    const spinner = logger.logWithSpinner()
    this.spinner = spinner

    spinner.info('Prepare for connecting to the remote ssh server.\n')

    debug('load private key.')

    // 加载私钥，用于使用公钥登录情形
    const {
      privateKey,
      passphrase,
      privateKeyPath: usedPrivateKeyPath,
    } = await loadPrivateKey(
      privateKeyPath,
      questions ? questions.passphrase : '',
      interactive
    ).catch((err) => {
      spinner.fail(
        chalk['red'](err ? err.message : 'Cannot use the public key for logon.')
      )
      console.log()
      spinner.info(`${chalk['cyan']('Switched to use password for logon.')}\n`)
      return {}
    })

    const { urlHandler } = Object.assign({}, extra)

    debug('resolve ssh args.')

    const args = await resolveArgs(
      { questions, url, privateKey },
      urlHandler,
      interactive
    )

    // 打印连接地址信息
    const { host, user, pwd, port } = args
    printAddress({ user, host, port }, spinner)

    const setup = Object.assign({}, args, {
      host,
      port,
      privateKey,
      privateKeyPath: usedPrivateKeyPath,
      passphrase,
      username: user,
      password: pwd,
    })

    this.remote = {
      host,
      port,
    }

    debug('waiting for connect the server')

    this.co = await connect(setup, interactive, spinner)
      //
      .then((co) => {
        const { registerShutdown } = require('./common')
        registerShutdown(async () => {
          co.once('close', (hasError) => {
            co = null
            if (!hasError) {
              spinner.succeed('The connection has been successfully closed.\n')
            } else {
              spinner.fail('An error occurred while closing the connection.\n')
            }
          }).end()

          await execCommand(co, 'exit')
          co = null
        })
        return co
      })
      //
      .catch(() => {
        spinner.fail('Cannot connect to the ssh server.\n')
        return null
      })

    return this.co
  }

  // 上传文件至服务器
  async upload(src, dest, progressHandler) {
    const { co, remote } = this
    if (!co) {
      throw new Error('Not connected.')
    }
    const { host, port } = remote
    return await this.scp(src, `user@${host}:${port}:${dest}`, progressHandler)
  }

  // 从服务器下载
  async download(src, dest, progressHandler) {
    const { co, remote } = this
    if (!co) {
      throw new Error('Not connected.')
    }
    const { host, port } = remote
    return await this.scp(`user@${host}:${port}:${src}`, dest, progressHandler)
  }

  // 拷贝文件
  async scp(from, to, progressHandler) {
    const { co } = this
    if (!co) {
      throw new Error('Not connected.')
    }
    const sftp = await new Promise((resolve, reject) => {
      co.sftp((err, sftp) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(err))
        } else {
          resolve(sftp)
        }
      })
    })
    //
    return await new Promise((resolve, reject) => {
      scp2.scp(from, to, new FileTransferClient(sftp, progressHandler), (err) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(err))
        } else {
          resolve()
        }
      })
    })
  }

  // 执行命令
  async exec(...commands) {
    return await this.execWithPipe.apply(this, [false].concat(commands))
  }

  // 以管道输出形式执行命令脚本
  async execWithPipe(pipe, ...commands) {
    const { co } = this
    if (!co) {
      throw new Error('Not connected.')
    }

    const res = []
    while (commands.length) {
      const cmd = commands.shift()
      let out
      // 串行执行
      if (Array.isArray(cmd)) {
        out = await Promise.all(
          // 并行执行
          cmd.map((s) => execCommand(co, s, pipe))
        )
      } else {
        out = await execCommand(co, cmd, pipe)
      }
      res.push(out)
    }
    return res
  }

  // 开启shell交互
  async shell(win, opts) {
    const { co } = this
    if (!co) {
      throw new Error('Not connected.')
    }
    return await new Promise((resolve, reject) => {
      co.shell(win, (opts = Object.assign({}, opts)), (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        process.on('uncaughtException', (err) => {
          console.error(`\n${err ? err.message : 'uncaught exception'}.\n`)
        })
        const { encoding } = opts
        if (encoding) {
          stream.setEncoding(encoding)
        }

        process.stdin.pipe(stream.stdin)
        stream.stdout.pipe(process.stdout)
        stream.stderr.pipe(process.stderr)
        stream.once('close', (code, signal) => {
          process.stdin.unpipe(stream.stdin)
          stream.stdout.unpipe(process.stdout)
          stream.stderr.unpipe(process.stderr)
          console.log()

          if (`${code}` !== '0') {
            const err = new Error('An error occurred and the shell has been terminated.')
            err.code = code
            err.signal = signal
            reject(err)
          } else {
            resolve(code)
          }
        })
      })
    })
  }

  // 退出
  async exit() {
    if (!this.co) {
      return 0
    }
    debug('ready to exit.')

    await this.exec('exit')

    this.spinner.succeed('Logout successfully.\n')

    await new Promise((resolve) => {
      this.co.once('close', resolve).end()
      this.co = null
    })

    debug('exited.')
    return 0
  }
}

//
module.exports = exports = async (args, options) => {
  const ssh = new SSH()
  const co = await ssh.connect(args, options)
  return co ? ssh : null
}
