const fs = require('fs')
const path = require('path')
const glob = require('glob')
const copy = require('fs-copy-file-sync')
const mkdir = require('make-dir')
const isAbsolute = require('is-absolute')
const fsExtra = require('fs-extra')
const relative = require('relative')

exports = module.exports = {
  // 移除文件
  removeSync(path) {
    fsExtra.removeSync(exports.getAbsPath(path))
  },

  // 解析路径（根据pwd）
  resolvePath(...args) {
    return path.resolve.apply(null, args)
  },

  // 是否是目录路径
  isDirectory(file, resolve) {
    if (typeof file === 'string') {
      file = file.trim()
    } else {
      file = ''
    }
    if (file) {
      if (resolve) {
        file = exports.getAbsPath(file)
      }
      if (fs.existsSync(file)) {
        return fs.statSync(file).isDirectory()
      }
    }
    return false
  },

  // 是否是绝对路径
  isAbsolute(path) {
    return path && typeof path === 'string' ? isAbsolute(path) : false
  },

  // 两个路径之间的相对路径
  relativePath(from, to, stat) {
    const absFrom = exports.getAbsPath(from)
    const absTo = exports.getAbsPath(to)
    const rel = relative(
      exports.isDirectory(absFrom) ? `${absFrom.replace(/[/\\]+$/, '')}/` : absFrom,
      exports.isDirectory(absTo) ? `${absTo.replace(/[/\\]+$/, '')}/` : absTo,
      stat
    )
    return /^\.\.?[/\\]/.test(rel) ? rel : `./${rel.replace(/\\/g, '/')}`
  },

  // 存在
  existsSync(path) {
    const file = typeof path === 'string' ? path.trim() : ''
    return file ? fs.existsSync(file) : false
  },

  // 创建目录
  mkdir(dir, options) {
    return mkdir.sync(dir, options)
  },

  // 连接路径
  joinPath(...args) {
    return path.join.apply(null, args)
  },

  // 获取绝对路径
  getAbsPath(path) {
    if (typeof path !== 'string' || !(path = path.trim())) {
      return ''
    }
    if (exports.isAbsolute(path)) {
      return path
    }
    return exports.resolvePath(path)
  },

  // 获取目录名称
  getDirName(file, ...args) {
    if (exports.isAbsolute(file)) {
      return path.dirname(file)
    }
    return path.dirname(path.resolve.apply(null, args.concat(file)))
  },

  // 根据路径模式获取文件的名称
  getFileName(pattern, options) {
    options = Object.assign({}, options)
    const { noExt } = options
    return exports.matchFileSync(pattern, options).map((file) => {
      return exports.getFileBaseName(file, noExt)
    })
  },

  // 根据路径获取文件名称
  getFileBaseName(file, noExt) {
    const name = typeof file === 'string' ? file.replace(/(?:[^\\/]*?[\\/])*/g, '') : ''
    return noExt && !name.startsWith('.') ? name.replace(/\.[^.]+$/g, '') : name
  },

  // 获取目录短名称（不包含路径）
  getShortDirName(file, ...args) {
    return exports.getDirName
      .apply(null, [file].concat(args))
      .replace(/(?:[^\\/]*?[\\/])*/g, '')
  },

  // 根据模式匹配路径
  matchFileSync(pattern, options) {
    return glob.sync(pattern.trim(), Object.assign({ nodir: false }, options))
  },

  // 写文件
  writeFileSync(outputPath, data, options) {
    const output = exports.resolvePath(outputPath)
    const dir = path.dirname(output)
    if (!fs.existsSync(dir)) {
      mkdir.sync(dir)
    }
    fs.writeFileSync(output, data, options)
    return output
  },

  // 是否是glob路径
  isGlob(pattern) {
    return (
      typeof pattern === 'string' &&
      (/[*!?{}(|)[\]]/.test(pattern) || /[@?!+*]\(/.test(pattern))
    )
  },

  // 获取用户路径
  resolveUserPath(path, base = '.') {
    const homedir = require('os').homedir()

    if (typeof path !== 'string') {
      path = homedir
    } else {
      if (path.startsWith('~')) {
        path = path.replace(/^~[\\/]*(.*)/, (t, sub) => {
          return exports.joinPath(homedir, sub)
        })
      }
      if (!exports.isAbsolute(path)) {
        path = exports.joinPath(homedir, base, path)
      }
    }
    return path
  },

  //执行拷贝操作
  execCopy(src, dest) {
    if (exports.isDirectory(src)) {
      mkdir.sync(dest)
    } else {
      const dir = path.dirname(dest)
      if (!fs.existsSync(dir)) {
        mkdir.sync(dir)
      }
      copy(src, dest)
    }
    return dest
  },

  // 直接从源地址拷贝到目的地址
  copySingleFileSync(src, dest) {
    copy(src, dest)
  },

  // 同步拷贝文件
  copyFileSync(setup) {
    let {
      //
      from: paths,
      to: destDir,
      handler: copyHandler,
      context,
      dot,
    } = Object.assign({}, setup)

    if (!Array.isArray(paths)) {
      paths = [paths]
    }
    const files = []
    const targets = []

    for (const src of paths) {
      if (exports.isGlob(src)) {
        files.push.apply(
          files,
          exports.matchFileSync(src, {
            nodir: false,
            dot: !!dot,
          })
        )
      } else {
        files.push(path.resolve(src))
      }
    }

    if (files.length) {
      destDir = path.resolve(destDir)
      if (context) {
        if (!exports.isAbsolute(context)) {
          context = path.resolve(context)
        }
      } else {
        context = process.cwd()
      }
      copyHandler = typeof copyHandler === 'function' ? copyHandler : exports.execCopy
      for (const file of files) {
        // 转换为绝对路径
        const srcFile = exports.getAbsPath(file)
        const destFile = path.join(destDir, path.relative(context, srcFile))
        targets.push(copyHandler(srcFile, destFile))
      }
    }

    return targets
  },

  // 取得复制任务对象
  getValidCopyTask(from, to, cwd) {
    let task = null
    if (typeof from === 'string' && typeof to === 'string') {
      from = from.trim()
      to = to.trim()
      if (from && to) {
        task = {}
        if (exports.isAbsolute(from)) {
          task.from = from
        } else if (exports.isGlob(from)) {
          task.from = cwd ? `${typeof cwd === 'object' ? cwd.from : cwd}/${from}` : from
        } else if (cwd) {
          task.from = path.join(typeof cwd === 'object' ? cwd.from : cwd, from)
        } else {
          task.from = path.resolve(from)
        }
        if (exports.isGlob(to)) {
          throw `[copy] Dest file can not be a glob path. (${to})`
        }
        if (cwd) {
          task.to = path.join(typeof cwd === 'object' ? cwd.to : cwd, to)
        } else {
          task.to = path.resolve(to)
        }
      }
    }
    return task
  },

  //
  ensurePathQuote(str) {
    return typeof str === 'string' ? str.replace(/([\\'])/g, '\\$1') : ''
  },
}
