const path = require('path')
const fs = require('fs')
const readline = require('readline')

const debug = require('debug')('utils:cli')
const shellEscape = require('shell-escape')
const minimist = require('minimist')
const { exec } = require('shelljs')

// 命令行工具集
module.exports = exports = {
  //
  // 对脚本参数值进行转译处理
  escape(str) {
    if (/(?:string|boolean|number)/.test(typeof str)) {
      str = [str]
    }
    if (Array.isArray(str)) {
      str = shellEscape(str)
    }
    str = typeof str === 'string' ? str.trim() : ''
    return str === '' ? '""' : str
  },

  //  执行命令行脚本
  async exec(script, options) {
    return new Promise((resolve, reject) => {
      exec(
        script,
        Object.assign(
          { cwd: process.cwd(), env: process.env, windowsHide: true },
          options
        ),
        (code, stdout, stderr) => {
          if (code === 0) {
            resolve({ code, stdout, stderr })
          } else {
            reject({ code, stdout, stderr })
          }
        }
      )
    })
  },

  // 运行npm脚本
  async runNpmScript(cmd, args, options) {
    const shellArgs = Object.assign({}, exports.trimShellQuotes(args), { _: [] })
    const argv = require('unparse-args')(shellArgs)

    return await exports.exec(`npm run ${cmd} -- ${argv.command_string}`, options)
  },

  // 运行命令行服务
  async runCliService(cmd, args, options) {
    const cli = 'vue-cli-service'

    const { scripts } = require('./package')()
    if (scripts) {
      const exp = new RegExp(`\\b${cli}(?:\\.js)?\\s+(([^\\s]+).*)`)

      for (const script of Object.values(scripts)) {
        const matcher = exp.exec(script)
        if (matcher && matcher[2] === cmd) {
          const stringArgv = require('string-argv')
          const argv = (stringArgv.default ? stringArgv.default : stringArgv)(matcher[1])
          args = Object.assign(minimist(argv), args)
          break
        }
      }
    }

    const bin =
      process.argv[1] || path.resolve(`./node_modules/@vue/cli-service/bin/${cli}.js`)

    const shellArgs = Object.assign({}, exports.trimShellQuotes(args), { _: [cmd] })
    const argv = require('unparse-args')(shellArgs)

    if (!fs.existsSync(bin)) {
      const message = `The dependency of ${cli} was not found.`
      debug(message)

      // 退回到使用当前运行时运行
      const service = process.VUE_CLI_SERVICE
      if (service && typeof service.run === 'function') {
        return await service.run(cmd, shellArgs, argv)
      }

      // 不能执行
      console.error(`\n${message}\n`)
      process.exit(1)
    }

    return await exports.exec(`node ${bin} ${argv.command_string}`, options)
  },

  // 创建终端对话并获取用户输入
  async getQuestionAnswers(questions) {
    if (!Array.isArray(questions)) {
      questions = [questions]
    }
    const quests = questions
      .filter((item) => item && typeof item === 'object' && item.name)
      .map((item) => {
        const prompt = Object.assign({}, item)
        if (prompt.type === 'password') {
          prompt.mask = prompt.mask || '*'
          prompt.message = `${prompt.message.trim()}🗝 `
        }
        return prompt
      })

    if (quests.length) {
      const inquirer = require('inquirer')
      return await inquirer.prompt(quests)
    }
    return {}
  },

  // 补全命令参数
  async fillCommandArgs(argsDefine, interactive = true) {
    //
    const args = {}

    if (!argsDefine || typeof argsDefine !== 'object') {
      return args
    }
    const types = ['string', 'boolean', 'number', 'array']
    const rawArgs = exports.trimShellQuotes(require('minimist')(process.argv.slice(2)))
    const askArgs = []

    for (const [name, define] of Object.entries(argsDefine)) {
      // 非可处理的参数定义
      if (define === null || typeof define !== 'object') {
        args[name] = define
        continue
      }

      const { type, default: def, question } = Object.assign({}, define)

      let exceptTypes
      if (Array.isArray(type)) {
        if (type.every((item) => types.includes(item))) {
          exceptTypes = type
        }
      } else if (types.includes(type)) {
        exceptTypes = [type]
      } else {
        exceptTypes = []
      }

      // 命令参数
      if (rawArgs.hasOwnProperty(name)) {
        const val = rawArgs[name]
        const { validate, filter } = Object.assign({}, question)
        let valid = exceptTypes.includes(typeof val)

        if (valid && typeof validate === 'function') {
          valid = validate(val) === true
        }

        if (valid) {
          args[name] = typeof filter === 'function' ? filter(val) : val
          continue
        }
      }

      // 交互查询
      if (interactive && question && typeof question === 'object') {
        askArgs.push(
          Object.assign(
            {
              default: def,
              type: {
                string: 'input',
                undefined: 'confirm',
                boolean: 'confirm',
                number: 'input',
                array: 'list',
              }[exceptTypes[0]],
            },
            question,
            { name }
          )
        )
        continue
      }

      // 默认值
      if (def !== undefined) {
        args[name] = def
      }
      // end of 'for'
    }

    if (askArgs.length) {
      // 获取用户输入
      Object.assign(args, await exports.getQuestionAnswers(askArgs))
      console.log()
    }

    return exports.trimShellQuotes(args)
  },

  // 去掉shell脚本参数的引号
  trimShellQuotes(obj) {
    //
    const reg = /^(['"])(.*?)\1$/
    const trim = (str) => {
      if (typeof str === 'string') {
        const matcher = reg.exec(str)
        if (matcher) {
          return matcher[2]
        }
      }
      return str
    }

    if (obj && typeof obj === 'object') {
      for (const [name, value] of Object.entries(obj)) {
        obj[name] = trim(value)
      }
      return obj
    }

    return trim(obj)
  },

  // 暂停
  async suspend(clear) {
    console.log()
    await exports.getQuestionAnswers([
      {
        message: 'Press return key for continue.',
        type: 'input',
        name: 'prepare',
      },
    ])
    if (clear) {
      // 清屏
      exports.clearTerminal()
    }
  },

  // 终端清屏
  clearTerminal() {
    if (process.stdout.isTTY) {
      const blank = '\n'.repeat(process.stdout.rows)
      console.log(blank)
      readline.cursorTo(process.stdout, 0, 0)
      readline.clearScreenDown(process.stdout)
    } else {
      console.log()
      process.stdout.write(
        process.platform === 'win32' ? '\x1Bc' : '\x1B[2J\x1B[3J\x1B[H'
      )
    }
  },

  // promisify的stdout
  stdout(data) {
    return new Promise((resolve, reject) => {
      process.stdout.write(data, 'utf8', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  },

  // promisify的stderr
  stderr(data) {
    return new Promise((resolve, reject) => {
      if (data instanceof Error) {
        data = data.message
      }
      process.stderr.write(data, 'utf8', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  },
}
