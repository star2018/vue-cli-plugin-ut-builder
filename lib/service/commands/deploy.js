const fs = require('fs')
const { promisify } = require('util')
const chalk = require('chalk')

const validator = require('../../utils/validator')
const commonUtil = require('../../utils/common')
const fileUtil = require('../../utils/file')
const stringUtil = require('../../utils/string')
const logger = require('../../utils/logger')
const env = require('../../utils/env')

const ConfigService = require('../ConfigService')
const debug = require('debug')('command:deploy')

// 受保护的路径
const protectedPaths = [
  '/',
  '/dev',
  '/lost+found',
  '/misc',
  '/proc',
  '/sbin',
  '/boot',
  '/etc',
  '/lib',
  '/lib64',
  '/media',
  '/mnt',
  '/sys',
]

// 默认的备份目录
const defaultBackupPath = '/opt/ftp/web'
// mock资源部署路径
const defaultMockDeployPath = '/usr/share/ice-builder/mock-server/mock'

// 上色
function color(str, def = 'cyan') {
  return chalk[def](str)
}

// 显示脚本命令错误
function echoError(exec, spinner) {
  return (exec instanceof Promise ? exec : Promise.resolve(exec)).catch((err) => {
    const { message } = err || {}
    if (message) {
      if (spinner) {
        spinner.log(`${chalk['red'](message)}\n`)
      } else {
        console.error(`${message}\n`)
      }
      err.message = ''
    } else if (spinner) {
      spinner.stop()
    }
    throw err
  })
}

// check部署路径
function checkPath(str, excludes, interactive) {
  if (!Array.isArray(excludes)) {
    excludes = []
  }

  let flag = 0
  if (typeof str !== 'string') {
    str = ''
  } else {
    str = str.trim()
  }

  if (!str) {
    flag = 1
  } else {
    const matcher = /^~([/\\].+)/.exec(str)
    if (matcher) {
      str = fileUtil.joinPath('/user', matcher[1])
    }

    if (
      protectedPaths.some(
        (path) => str === path || (path !== '/' && str.startsWith(path))
      )
    ) {
      flag = 2
    } else if (excludes.some((path) => str.startsWith(path))) {
      flag = 3
    } else if (!str.startsWith('/') || !validator.isLocalPath(str)) {
      flag = 1
    }
  }

  let message
  if (flag) {
    switch (flag) {
      case 1:
        message = `Invalid target path${interactive ? ', please re-enter it' : ''}.`
        break
      case 2:
        message = `Cannot use the protected path${
          interactive ? ', please re-enter it' : ''
        }.`
        break
      case 3:
        message = `Subdirectories are not allowed${
          interactive ? ', please re-enter it' : ''
        }.`
        break
    }
  }

  return message || true
}

// 打印详情
function printDetails(details, spinner) {
  const {
    host,
    deploy,
    backup,
    resource,
    overwrite,
    mockDeployPath,
    mockResource,
  } = details

  const cwd = process.cwd()
  const relativePath = (path) =>
    path && fileUtil.relativePath(cwd, path).replace(/^\.\//, '')

  const message = commonUtil.prettyPrintPaths(
    [
      {
        type: 'Local Resources',
        path: relativePath(resource),
      },
      {
        type: 'Mock Resources',
        path: relativePath(mockResource),
      },
      {
        type: 'Remote Address',
        path: host,
      },
      {
        type: 'Deploy Path',
        path: deploy,
      },
      {
        type: 'Mock Deploy Path',
        path: mockDeployPath,
      },
      {
        type: 'Backup Path',
        path: backup || chalk['bgYellow']['black']('no need to backup (--no-backup)'),
      },
      {
        type: 'Write Mode',
        path: overwrite
          ? 'overwrite only'
          : chalk['bgYellow']['black']('delete before write (--no-overwrite)'),
      },
    ],
    0,
    '- '
  )

  spinner.info(`Details of the deployment:`)
  logger.logWithBoxen(message)
}

// 获取服务器上的目录路径
async function getServerPath(setup) {
  const { co, path, interactive, spinner, excludes, questionMessage } = setup
  const errorMessage = path ? checkPath(path, excludes, interactive) : null

  let targetPath = path
  if (typeof errorMessage === 'string') {
    if (!interactive) {
      throw new Error(errorMessage)
    }
    targetPath = ''
  }

  if (!targetPath && !interactive) {
    throw new Error('Deployment paths need to be specified.')
  }

  const { getQuestionAnswers } = require('../../utils/cli')

  do {
    // 先输入
    if (!targetPath) {
      const { path } = await getQuestionAnswers({
        name: 'path',
        message: questionMessage || 'Please enter the path:',
        filter: (answer) => answer.trim(),
        validate: (answer) => checkPath(answer, excludes, true),
      })
      console.log()
      targetPath = path
    }

    // 检查服务器上路径是否存在
    if (targetPath) {
      spinner.start('Checking...')
      let [path] = await echoError(
        co.exec(`cd ${targetPath} && pwd`),
        spinner
      ).catch(() => [])

      // 不存在则提示创建
      if (!path) {
        let mkdir

        if (interactive) {
          const { mk } = await getQuestionAnswers({
            name: 'mk',
            type: 'confirm',
            default: true,
            message: `The path named by '${color(
              targetPath
            )}' upon server is not exists, do you want to make it now?`,
          })
          mkdir = mk
          console.log()
        } else {
          spinner.info(
            'Automatically create non-existent paths due to interactive disabled.\n'
          )
          mkdir = true
        }

        if (mkdir) {
          spinner.start('Executing...')
          await echoError(co.exec(`mkdir -p ${targetPath}`), spinner)
          const [pwd] = await echoError(co.exec(`cd ${targetPath} && pwd`), spinner)
          path = pwd
          spinner.succeed(
            `The path named by '${color(
              targetPath
            )}' upon server has been successfully made.\n`
          )
        }
      } else {
        spinner.info(
          `The path named by '${color(targetPath)}' upon server is exists already.\n`
        )
      }
      //
      targetPath = path
    }

    // 不存在目标路径时，则再次输入
  } while (!targetPath)

  return targetPath
}

// 获取操作路径
async function getWorkingPaths(setup) {
  const {
    co,
    path,
    backup,
    spinner,
    backupPath,
    mockDeployPath,
    interactive,
    zipFiles,
    zipIndex,
  } = setup
  // app resources
  const appZipFiles = zipFiles
    .filter(({ type }) => type === 'app')
    .map(({ file }) => file)

  // mock resources
  const mockZipFiles = zipFiles
    .filter(({ type }) => type === 'mock')
    .map(({ file }) => file)

  const deployPath = await getServerPath({
    questionMessage: 'Please enter the deployment path upon server:',
    excludes: backupPath ? [backupPath] : [],
    interactive,
    spinner,
    path,
    co,
  })

  spinner.info(`Got the deployment path: ${color(deployPath)}\n`)

  const bkPath = backup
    ? await getServerPath({
        questionMessage: 'Please enter the backup path upon server:',
        excludes: [deployPath],
        interactive,
        spinner,
        path: backupPath,
        co,
      })
    : ''

  if (bkPath) {
    spinner.info(`Got the backup path: ${color(bkPath)}\n`)
  }

  let fileIndex
  if (appZipFiles.length > 1) {
    const { getQuestionAnswers } = require('../../utils/cli')

    if (!/^\d+$/.test(zipIndex) || zipIndex < 0 || zipIndex >= appZipFiles.length) {
      if (interactive) {
        const { index } = await getQuestionAnswers({
          message: 'Which file do you want to deploy?',
          name: 'index',
          type: 'list',
          default: 0,
          choices: appZipFiles.map((file, index) => ({
            name: fileUtil.getFileBaseName(file),
            value: index,
          })),
        })
        fileIndex = index
      } else {
        fileIndex = 0
      }
    } else {
      fileIndex = zipIndex
    }
  } else {
    fileIndex = 0
  }

  const mkDeployPath = mockZipFiles.length
    ? await getServerPath({
        questionMessage: 'Please enter the mock resource deployment path upon server:',
        excludes: [deployPath].concat(bkPath ? [bkPath] : []),
        interactive,
        spinner,
        path: mockDeployPath,
        co,
      })
    : ''

  return {
    deploy: deployPath,
    backup: bkPath,
    resource: appZipFiles[fileIndex],
    mockDeployPath: mkDeployPath,
    mockResource: mockZipFiles[0] || '',
  }
}

// 安装命令行工具包
async function installPackage(co, pkg, spinner) {
  if (typeof pkg === 'string') {
    pkg = { cmd: pkg }
  }
  const { cmd, install } = Object.assign({}, pkg)
  const [bin] = await co.exec(`which ${cmd}`).catch(() => [])
  if (!bin) {
    spinner.warn(`Cannot found the command line utility of ${cmd} on server.\n`)
    spinner.info(`Waiting for install the command line utility of ${cmd} on server...\n`)

    const pkgManagers = ['yum', 'apt-get']
    let installed = false
    while (pkgManagers.length) {
      const mgr = pkgManagers.shift()
      const [mgrBin] = await echoError(co.exec(`which ${mgr}`), spinner).catch(() => [])
      if (mgrBin) {
        const pkgName = install ? install[mgr] : cmd
        await echoError(co.execWithPipe(true, `${mgr} -y install ${pkgName}`))
        installed = true
        break
      }
    }

    if (!installed) {
      throw new Error(`Cannot install the command line utility of ${cmd} on server.`)
    }

    // 再次检查
    spinner.start('Checking...')
    await co.exec(`which ${cmd}`)
    spinner.succeed(
      `The command line utility of ${cmd} has been successfully installed on server.\n`
    )
  }
}

// 文件备份
async function execBackup(setup) {
  const { from, dest, co, spinner } = setup
  const { escape } = require('../../utils/cli')

  spinner.start('Executing backup...')

  const [date] = await echoError(co.exec('echo `date +"%Y%m%d%H%M%S"`'), spinner)
  const zip = `${dest}/backup_www_${date}.tar.gz`
  await echoError(co.exec(`cd ${escape(from)} && tar -cz -f ${escape(zip)} .`), spinner)

  spinner.succeed(`Backup upon server successfully completed: ${color(zip)}\n`)

  return zip
}

// 解压缩文件
async function decompress(co, src, spinner) {
  const { escape } = require('../../utils/cli')
  const source = escape(src)
  const commands = [
    {
      cmd: 'unzip',
      install: { yum: 'unzip zip', 'apt-get': 'zip' },
      script: 'unzip -l ${source} && unzip -q -uboC ${source} -d ${target}',
    },
    {
      cmd: 'tar',
      script: 'tar -ztv -f ${source} && tar -zx -f ${source} -C ${target}',
    },
    {
      cmd: 'tar',
      script: 'tar -jtv -f ${source} && tar -jx -f ${source} -C ${target}',
    },
    {
      cmd: 'tar',
      script: 'tar -Jtv -f ${source} && tar -Jx -f ${source} -C ${target}',
    },
  ]

  spinner.info('Extracting...\n')

  let extracted = ''
  for (const setup of commands) {
    const { script } = setup

    // 尝试安装解压工具
    await installPackage(co, setup, spinner)
    const [target] = await co.exec(`mktemp -d`)
    const escapedTarget = escape(target)

    // 执行解压
    await co
      .execWithPipe(
        true,
        stringUtil.filter(
          script,
          { source, target: escapedTarget },
          { open: '${', close: '}' }
        )
      )
      .then(() => {
        extracted = target
      })
      .catch(async () => await co.exec(`rm -rf ${escapedTarget}`).catch(() => {}))

    console.log()
    if (extracted) {
      break
    }
  }

  // 删除临时文件
  await co
    .exec(`rm -rf ${source}`)
    .catch((err) => debug('delete temp resources failed: (%s) %s', src, err.message))

  if (!extracted) {
    throw new Error(`Cannot extract the resource from compression file.`)
  }

  spinner.succeed('Extracted successfully.\n')

  return extracted
}

// 发送文件
async function execTransferFiles(setup) {
  const { co, src, dest, spinner } = setup
  const { escape } = require('../../utils/cli')
  spinner.start('Transferring...')
  // 创建临时文件
  const [tmpTarget] = await echoError(co.exec(`mktemp`), spinner)
  // 上传文件
  await co
    .upload(src, tmpTarget, (progress) => {
      spinner.text = `Transferring... (${color(`${progress}%`)})`
    })
    .catch(async (err) => {
      await co.exec(`rm -rf ${escape(tmpTarget)}`).catch((err) => debug(err.message))
      throw err
    })

  // 上传成功
  spinner.succeed('Transferred successfully.\n')
  // 解压文件
  spinner.info(`Extract files from '${color(fileUtil.getFileBaseName(src))}'.\n`)

  // 取得解压的文件目录路径
  const target = await decompress(co, tmpTarget, spinner)
  const escapedTarget = escape(target)

  const [count] = await co
    .exec(`cd ${escapedTarget} && ls -lABR | grep -c "^[-]"`)
    .catch(() => [])

  if (!+count) {
    throw new Error(`There are no files need to be copy to the deployment directory.`)
  }

  //
  try {
    // 拷贝
    spinner.info(`Copy files to '${color(dest)}'...\n`)
    const escapedDest = escape(`${dest}/`)
    //
    await co.execWithPipe(true, `cp -Rfv ${`${target}/*`} ${escapedDest}`)
    await co
      .execWithPipe({ stderr: null }, `cp -Rfv ${`${target}/.[!.]*`} ${escapedDest}`)
      .catch(() => {})
    //
    console.log()
    spinner.succeed(`Copied ${color(`${count} files`)} to deployment directory.\n`)
  } catch (e) {
    console.log()
    throw e
  } finally {
    spinner.info('Cleaning the temp resources...\n')
    await co
      .exec(`rm -rf ${escapedTarget}`)
      .catch((err) => debug('delete temp resources failed (%s): %s', target, err.message))
    spinner.info('Cleaned successfully.\n')
  }
}

// 执行部署
async function execDeploy(setup) {
  const { co, spinner, interactive, overwrite } = setup
  const { host, port } = co.remote
  const {
    deploy,
    backup,
    mockDeployPath,
    resource,
    mockResource,
  } = await getWorkingPaths(setup)

  printDetails(
    {
      host,
      port,
      deploy,
      backup,
      resource,
      overwrite,
      mockDeployPath,
      mockResource,
    },
    spinner
  )

  const { getQuestionAnswers, escape } = require('../../utils/cli')

  if (interactive) {
    const { next } = await getQuestionAnswers({
      name: 'next',
      type: 'confirm',
      default: false,
      message: 'Is that right and need to continue (enter Y to confirm)?',
    })
    console.log()
    if (!next) {
      throw new Error('The deployment has been interrupted.')
    }
  }

  let backupFile
  // 进行文件备份
  if (backup) {
    backupFile = await execBackup({ from: deploy, dest: backup, spinner, co })
  }

  // 清理部署目录
  if (!overwrite) {
    spinner.info(`Prepare for cleaning the deployment path: ${color(deploy)}\n`)
    spinner.start('Cleaning...')

    await echoError(
      co.exec(`rm -rf ${escape(deploy)}`, `mkdir -p ${escape(deploy)}`),
      spinner
    )

    spinner.succeed('Cleaned successfully.\n')
  }

  // 传送文件
  await execTransferFiles({
    co,
    dest: deploy,
    src: resource,
    spinner,
  })

  // 部署mock资源
  if (mockDeployPath) {
    if (!overwrite) {
      // 清理 mock 资源部署目录
      spinner.info(
        `Prepare for cleaning the mock resource deployment path: ${color(
          mockDeployPath
        )}\n`
      )
      spinner.start('Cleaning...')

      await echoError(
        co.exec(`rm -rf ${escape(mockDeployPath)}`, `mkdir -p ${escape(mockDeployPath)}`),
        spinner
      )

      spinner.succeed('Cleaned mock resources successfully.\n')
    }

    await execTransferFiles({
      co,
      dest: mockDeployPath,
      src: mockResource,
      spinner,
    })
  }

  return backupFile
}

// 解析配置文件
async function parseConfigFile(config, spinner) {
  let file

  // 默认在用户目录下解析配置文件
  const absConfigFile = fileUtil.resolveUserPath(config)
  const escapedName = `***/${fileUtil.getFileBaseName(absConfigFile)}`
  try {
    if (fileUtil.existsSync(absConfigFile) && !fileUtil.isDirectory(absConfigFile)) {
      spinner.info(`Read the configuration from: ${color(escapedName)}\n`)
      file = await promisify(fs.readFile)(absConfigFile, { encoding: 'utf8' })
    }
  } catch (e) {
    console.error(`${e.message}\n`)
    spinner.fail(`Cannot read the configuration file from '${color(escapedName)}'\n`)
  }

  if (!file) {
    return {}
  }

  // 可使用base64、hex简单屏蔽明文配置
  let json
  const parser = require('json5')
  for (const encoding of ['utf8', 'base64', 'hex']) {
    try {
      json = parser.parse(Buffer.from(file, encoding).toString())
      if (!json || typeof json !== 'object') {
        json = null
        spinner.fail(
          'The content of configuration file must be a valid json object. Non-Object will be ignored.\n'
        )
      }
      break
    } catch (e) {
      debug('decode config (%s) error: %s', encoding, e.message)
    }
  }

  if (json) {
    spinner.succeed('Configuration from file has been successfully parsed.\n')
  } else if (json !== null) {
    spinner.fail(
      `${chalk['red'](
        'An error occurred while parsing configuration file. Did you forgot to use the json(5) format?'
      )}\n`
    )
  }

  if (!json) {
    return {}
  }

  const { username, password, privateKey, deployPath } = json
  return Object.assign(
    {
      // 使用配置文件时，默认禁用交互模式
      suspend: false,
      interactive: false,
      // 配置文件中参数名称兼容
      user: username,
      pwd: password,
      path: deployPath,
      'private-key': privateKey,
    },
    json
  )
}

// 解析配置
async function resolveConfig(spinner) {
  const args = require('minimist')(process.argv.slice(2))
  const {
    user,
    pwd,
    username,
    password,
    // 默认的配置文件路径
    config = '.deploy/.ssh/.config',
  } = args

  const camelCase = require('lodash/camelCase')
  const fileArgs = await parseConfigFile(config, spinner)

  const cmdArgs = Object.entries(args).reduce((args, [name, value]) => {
    if (value !== undefined && typeof value !== 'object') {
      args[camelCase(name)] = value
      args[name] = value
    }
    return args
  }, {})

  if (!user && username) {
    args.user = username
  }
  if (!pwd && password) {
    args.pwd = password
  }

  if (cmdArgs.pwd || cmdArgs.passphrase) {
    spinner.warn(
      `${chalk['bgYellow']['black'](
        'You should better not put passwords in the command parameters.'
      )}\n`
    )
  }

  return Object.assign(
    {
      // 默认配置参数
      path: '',
      backupPath: defaultBackupPath,
      mockDeployPath: defaultMockDeployPath,
      zipIndex: NaN,
      testSsh: false,
      interactive: true,
      overwrite: true,
      backup: true,
    },
    // 文件配置参数
    fileArgs,
    // 命令行参数优先级最高
    cmdArgs
  )
}

// 自定义命令
exports = module.exports = (api, projectOptions) => {
  ConfigService.addDefaultService(
    'compress',
    'node_modules/.assets/.zip/[name]-[version]'
  )

  return async () => {
    process.env.ICE_BUILD_DISABLE_NOTIFIER = true

    // 执行构建
    const zipFiles = []
    commonUtil.getZipFilesPath(projectOptions).forEach((file) => {
      zipFiles.push({ type: 'app', file })
    })

    const spinner = logger.logWithSpinner()

    const configArgs = await resolveConfig(spinner)
    const { testSsh, shell, shellEncoding, mock } = configArgs

    if (!testSsh) {
      // 执行资源构建
      await require('../../utils/service').build(env.args)

      if (mock) {
        // 执行mock服务部署，先进行mock资源压缩
        const { pluginOptions } = projectOptions
        const { services, service } = Object.assign({}, pluginOptions)
        const { mock: mockService } = Object.assign({}, service, services)
        const { path = 'mock' } = Object.assign({}, mockService)
        zipFiles.push({
          type: 'mock',
          file: await commonUtil.compress(
            path,
            fileUtil.resolvePath('node_modules/.assets/zip/mock/modules.zip')
          ),
        })
      }
    } else {
      if (!zipFiles.length) {
        logger.error(
          `\n${chalk['red'](
            'There is no resources to be deployed. You must enable the build operation when doing deploy. '
          )}\n`
        )
        process.exit(1)
      }
    }

    const ssh = require('../../utils/ssh')
    const sshSetup = Object.assign({}, configArgs)

    if (testSsh) {
      const co = await ssh(sshSetup)
      if (!co) {
        process.exit(1)
      }

      spinner.info('Ready to logout.')
      return await co.exit()
    }

    // 创建ssh服务器连接
    const co = await ssh(sshSetup)
    if (!co) {
      return process.exit(1)
    }

    let success = false
    let backupFile
    try {
      //
      backupFile = await execDeploy(
        Object.assign({}, configArgs, {
          zipFiles,
          spinner,
          co,
        })
      )
      //
      success = true
    } catch (e) {
      spinner.fail(`${e.message || 'An error occurred while executing deployment.'}\n`)
    } finally {
      if (!shell) {
        await co.exit().catch(() => {})
      }
    }

    if (success) {
      if (backupFile) {
        logger.logWithBoxen(
          commonUtil.prettyPrintPaths(
            {
              type: 'Backup file',
              path: backupFile,
            },
            0,
            '- '
          )
        )
      }
      //
      spinner.succeed(
        `${color('The deployment operation has been successfully completed.')}\n`
      )

      if (shell) {
        spinner.info('Start the shell session...\n')
        await co.shell({}, { encoding: shellEncoding }).catch((err) => {
          spinner.fail(
            `${chalk['red'](err ? err.message : 'Shell terminated with an error.')}\n`
          )
        })
        await co.exit().catch(() => {})
      }
      process.exit(0)
    } else {
      spinner.fail(chalk['red']('Deployment failure.\n'))
      process.exit(1)
    }
  }
}

// 命令默认的构建模式
exports.defaultMode = 'production'
// 脚本命令名称
exports.script = 'deploy'
// 命令帮助
exports.help = (options) => ({
  description: 'build for production and deploy resources.',
  usage: 'vue-cli-service deploy [options]',
  options: {
    '--host': `specify the remote host to connect`,
    '--port': `specify the port of ssh connection to remote host (default: 22)`,
    '--user': `specify the username for ssh connection`,
    '--url': `specify the url for ssh connection`,
    '--private-key': `specify the path of private key (openSSH format) for auth (default: ~/.ssh/id_rsa)`,
    '--path': `specify the path on remote host for deploying resources`,
    '--zip-index': `specify the index of compression file list which want to deploying (default: 0) `,
    '--config': `specify the path of the config file for automatic configure (JSON format)`,
    '--backup-path': `specify the path on remote host for backup files (default: ${defaultBackupPath})`,
    '--no-backup': `do not backup the files upon server before deploying`,
    '--no-clean': `do not remove the dist directory before building the project`,
    '--no-overwrite': `just remove the old resources but not overwrite it`,
    '--no-suspend': `do not suspend when ready to connect to the ssh server`,
    '--no-interactive': `do not apply interaction in terminal (need input will result in failure)`,
    '--test-ssh': `do not run build and only test the ssh connection`,
    '--shell': `start an interactive shell session after deploy completed`,
    '--shell-encoding': `specify the shell text encoding (default: utf8)`,
    '--modern': `build app targeting modern browsers with auto fallback`,
    '--dest': `specify output directory (default: ${options.outputDir})`,
    '--mock': `deploy mock resources to the remote server`,
    '--mock-deploy-path': `specify the path on remote host for deploying mock resources`,
  },
})
