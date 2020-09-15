const fs = require('fs')

const fileUtil = require('../utils/file')
const pkg = require('../utils/package')
const env = require('../utils/env')
const debug = require('debug')('service:command')

// 命令行服务
class CommandService {
  //
  constructor(setup) {
    const { plugin, options } = setup
    this.plugin = plugin
    this.options = options

    const { command, commandList } = env
    if (commandList.includes(command)) {
      // 执行命令的webpack配置
      plugin.chainWebpack((chainConfig) => {
        Object.values(CommandService.commands).forEach((module) => {
          const { chainWebpack } = module
          if (typeof chainWebpack === 'function') {
            chainWebpack(chainConfig, options)
          }
        })
      })
    }
  }

  // 注册命令
  registerCommand() {
    const { plugin, options } = this
    // 批量注册自定义命令
    const commands = CommandService.commands
    const { command: currentCommand, commandList, isHelp } = env

    Object.keys(commands).forEach((name) => {
      const module = commands[name]

      let { help } = module
      if (isHelp && typeof help === 'function') {
        help = help(options)
      }

      let cmd
      if (currentCommand === name) {
        debug(`command init: ${name}:${currentCommand}:${commandList}`)
        // 初始化命令模块
        cmd = module(plugin, options)
      } else {
        cmd = () => {}
      }

      // 注册命令
      if (help && typeof help === 'object') {
        plugin.registerCommand(name, help, cmd)
      } else {
        plugin.registerCommand(name, cmd)
      }
    })
  }
}

// 可用的命令列表
CommandService.commands = {}
// 命令模式
CommandService.commandModes = {}
// 加载所有命令
CommandService.loadCommands = function () {
  try {
    const cwd = fileUtil.joinPath(__dirname, 'commands')
    const files = fs.readdirSync(cwd)
    const commands = CommandService.commands
    const modes = CommandService.commandModes
    const scripts = {}

    // 加载
    for (const file of files) {
      //
      const absPath = fileUtil.joinPath(cwd, file)
      const name = fileUtil.getFileBaseName(absPath, true)

      if (commands.hasOwnProperty(name)) {
        console.error(`\nThe name of command with '${name}' already exists.\n`)
        process.exit(1)
      }

      const module = require(absPath)
      const { script, defaultMode } = Object.assign({}, module)
      const scriptName = typeof script === 'string' ? script.trim() : ''
      const mode = typeof defaultMode === 'string' ? defaultMode.trim() : ''

      // 自定义命令
      commands[name] = module

      // 默认的命令模式
      if (mode) {
        modes[name] = mode
      }

      // 脚本命令名称
      if (scriptName) {
        scripts[name] = `vue-cli-service ${scriptName}`
      }
    }

    const scriptNames = Object.keys(scripts)
    if (scriptNames.length) {
      const pkgScripts = Object.assign({}, pkg.read().scripts)
      for (const name of scriptNames) {
        if (!pkgScripts.hasOwnProperty(name)) {
          // 写入新的命令脚本至 package.json 文件中
          pkg.write(
            { scripts },
            {
              normalize: false,
              overwrite: false,
            }
          )
          break
        }
      }
    }
  } catch (e) {
    console.error(e.message)
  }
}

// 加载所有命令
CommandService.loadCommands()

module.exports = CommandService
