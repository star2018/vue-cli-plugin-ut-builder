const fs = require('fs')
const path = require('path')
const zipper = require('yazl')
const mkdir = require('make-dir')
const strUtil = require('../../utils/string')
const fileUtil = require('../../utils/file')
const logger = require('../../utils/logger')
const emitter = require('../../utils/emitter')

const CompilerEvent = require('./CompilerEvent')

/**
 * true or name or
 * {
 *   name: ''
 *   copy: '',
 *   dot: true
 * }
 */
// zip压缩
class ZipCompress {
  //
  constructor(options) {
    if (!Array.isArray(options)) {
      options = [options]
    }
    const defaultName = 'zip/[name]-[version].zip'
    this.zipTasks = options
      .map((item) => {
        if (typeof item === 'string' && (item = item.trim())) {
          item = { name: item }
        } else if (item) {
          if (typeof item !== 'object') {
            item = { name: defaultName }
          } else if (typeof item.name !== 'string' || !(item.name = item.name.trim())) {
            item.name = defaultName
          }
        } else {
          return null
        }
        return Object.assign({ dot: true, copy: null }, item)
      })
      .filter((item) => !!item)
  }

  getZipFiles() {
    return this.zipTasks.map((task) => {
      const { name } = task
      let normalName = strUtil.filter(name, this.getNameFilter()).trim()
      if (!normalName.endsWith('.zip')) {
        normalName += '.zip'
      }
      return fileUtil.getAbsPath(normalName)
    })
  }

  apply(compiler) {
    this.compiler = compiler
    //
    new CompilerEvent(
      'ZipCompressWebpackPlugin',
      {
        done: this.execAfterCompile,
      },
      this
    ).apply(compiler)
  }

  async execAfterCompile() {
    const { compiler } = this
    emitter.emit(
      'compress-complete',
      //
      await this.execWithContext(compiler.options.output.path)
    )
  }

  async execWithContext(context) {
    const absContext = fileUtil.getAbsPath(context)
    if (!absContext) {
      return []
    }
    return await Promise.all(this.zipTasks.map((task) => this.runTask(task, absContext)))
  }

  // 查找需要压缩的资源
  copyTargetPath(copyOptions, dot, context) {
    const targets = []
    const tasks = []
    const cwd = {
      from: context,
      to: context,
    }
    if (Array.isArray(copyOptions)) {
      for (const task of copyOptions) {
        if (task && typeof task === 'object') {
          const { from, to } = task
          const copyTask = fileUtil.getValidCopyTask(from, to, cwd)
          if (copyTask) {
            tasks.push(copyTask)
          }
        }
      }
    } else if (typeof copyOptions === 'object') {
      Object.keys(copyOptions).forEach((from) => {
        // 字符串路径映射形式定义
        const task = fileUtil.getValidCopyTask(from, copyOptions[from], cwd)
        if (task) {
          tasks.push(task)
        }
      })
    }
    if (tasks.length) {
      // 拷贝资源到特定路径
      // 不执行实际拷贝，只进行路径变更
      const handler = (src, dest) => ({ src, dest })
      for (const task of tasks) {
        const { from, to } = task
        targets.push.apply(
          targets,
          fileUtil.copyFileSync({ from, to, context, dot, handler })
        )
      }
    }
    return { files: targets, context }
  }

  // 取得需要压缩的资源路径列表
  getTargetFiles(task, context, callback) {
    const { copy, dot } = task
    let targets
    if (!fileUtil.isDirectory(context)) {
      targets = {
        context: fileUtil.getDirName(context),
        files: [{ src: context, dest: context }],
      }
    } else if (copy) {
      // 指定了需要拷贝的资源
      targets = this.copyTargetPath(copy, dot, context)
    } else {
      // 未指定资源，默认输出目录下所有文件
      targets = {
        context,
        files: fileUtil.matchFileSync(`${context}/**/*`, { dot: !!dot }).map((path) => {
          path = fileUtil.resolvePath(path)
          return { src: path, dest: path }
        }),
      }
    }
    callback(targets)
  }

  // 执行压缩
  compress(targets, output, callback) {
    let { files, context } = targets
    if (files.length) {
      const sep = path.sep
      const zipFile = new zipper.ZipFile()
      context = fileUtil.getAbsPath(context)
      for (const file of files) {
        const { src, dest } = file
        if (fs.existsSync(src)) {
          const stat = fs.statSync(src)
          const metaPath = dest.replace(`${context}${sep}`, '')
          if (stat.isDirectory()) {
            if (!files.some((f) => f !== file && f.dest.indexOf(dest) !== -1)) {
              // 空目录
              zipFile.addEmptyDirectory(metaPath)
            }
          } else {
            // 文件
            zipFile.addFile(src, metaPath)
          }
        }
      }
      // 添加结束
      zipFile.end()
      // 输出打包文件
      zipFile.outputStream
        .pipe(fs.createWriteStream(output))
        // 压缩文件输出完成
        .on('close', callback)
    }
  }

  getNameFilter() {
    return strUtil.getFilterSnippets()
  }

  // 执行压缩任务
  runTask(task, context) {
    const { name } = task
    let normalName = strUtil.filter(name, this.getNameFilter()).trim()
    if (!normalName.endsWith('.zip')) {
      normalName += '.zip'
    }
    const output = fileUtil.getAbsPath(normalName)
    const dir = path.dirname(output)
    if (!fs.existsSync(dir)) {
      mkdir.sync(dir)
    } else if (fs.existsSync(output)) {
      const stat = fs.statSync(output)
      if (stat.isDirectory()) {
        logger.error(
          '\n[compress] The output file for compress can not be a directory.\n'
        )
        process.exit(1)
        return
      }
      // 删除已存在的文件
      fs.unlinkSync(output)
    }
    return new Promise((resolve) => {
      this.getTargetFiles(task, context, (targets) => {
        // 压缩文件
        this.compress(targets, output, () => {
          resolve(output)
        })
      })
    })
  }
}

ZipCompress.default = ZipCompress
module.exports = ZipCompress
