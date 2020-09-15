const EventEmitter = require('events').EventEmitter
const fs = require('fs')
//
const lowerFirst = require('lodash/lowerFirst')
const chalk = require('chalk')
const uuidv4 = require('uuid/v4')
const babylon = require('babylon')
const traverse = require('@babel/traverse')
const generator = require('@babel/generator')
const babelTypes = require('@babel/types')
//
const MockConverter = require('./MockConverter')
//
const logger = require('../../../../utils/logger')
const fileUtil = require('../../../../utils/file')
const commonUtil = require('../../../../utils/common')

//
const helper = require('../helper')

/**
 * mock模块生成器
 * @type {module.ModuleMaker}
 */
module.exports = class ModuleMaker extends EventEmitter {
  //
  constructor(options) {
    super()
    this.options = Object.assign({}, options)
    // 源码树分析器
    this.traverse = helper.getModuleDefaultExport(traverse)
    // 源代码生成器
    this.generate = helper.getModuleDefaultExport(generator)
    // 等待写文件的模块映射
    this.waitingModule = {}
  }

  getMockLocation(mock) {
    const { locate, loc, file } = mock
    return (mock.loc = locate ? loc || this.locateMock(file, mock) : '')
  }

  // 获取mock代码片段的位置
  locateMock(file, mock, code) {
    let location = ''
    const { method, path: apiPath } = mock
    try {
      if (code || fs.existsSync(file)) {
        code = code || fs.readFileSync(file).toString('utf8')
        if (code) {
          this.findDefaultExportObjectDeclaration(code, (declaration) => {
            if (!declaration) {
              return
            }
            const properties = declaration.properties
            for (const prop of properties) {
              if (babelTypes.isStringLiteral(prop.key)) {
                const matcher = /(\w+)\s+(.*)/.exec(prop.key.value)
                if (
                  matcher &&
                  matcher[2] === apiPath &&
                  matcher[1].toLowerCase() === method.toLowerCase()
                ) {
                  const loc = prop.key.loc
                  const start = loc ? loc.start : null
                  if (start) {
                    const { line, column } = start
                    location = `${file}:${line}:${column}`
                  }
                  break
                }
              }
            }
          })
        }
      }
    } catch (e) {
      logger.error(e.message)
    }
    return location
  }

  // 分析代码
  findDefaultExportObjectDeclaration(code, callback) {
    // 解析代码成AST
    const ast = babylon.parse(code, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
    })
    // 遍历AST，修改代码节点
    let foundExportDefault = false
    let foundDeclaration = null
    let foundPath = null
    // 分析抽象代码语法树
    this.traverse(ast, {
      enter: (path) => {
        if (!foundDeclaration && babelTypes.isExportDefaultDeclaration(path.node)) {
          if (!foundExportDefault) {
            foundExportDefault = true
            const declaration = path.node.declaration
            if (babelTypes.isObjectExpression(declaration)) {
              foundDeclaration = declaration
              foundPath = path
            }
          }
        }
      },
    })
    //
    callback(foundDeclaration, foundPath, ast)
  }

  // 创建mock模块
  makeMockModule({ method, path: apiPath, data }) {
    try {
      const { init, path: mockPath } = this.options
      if (!init || fileUtil.isGlob(mockPath)) {
        return
      }
      const rootDir = helper.makeAbsModulesPath(mockPath)
      if (rootDir) {
        const modulePath = fileUtil.joinPath(
          rootDir,
          apiPath
            .replace(/:.*/g, '')
            .replace(/\/+[^\/]*$|^\/+/g, '')
            .replace(/\s+/g, '-')
        )
        let moduleDir = modulePath === rootDir ? rootDir : fileUtil.getDirName(modulePath)
        if (!fs.existsSync(moduleDir)) {
          try {
            fileUtil.mkdir(moduleDir)
          } catch (e) {
            logger.error(e.message)
            moduleDir = ''
          }
        }
        if (moduleDir) {
          const moduleFile = `${
            modulePath === rootDir ? `${rootDir}/root` : modulePath
          }.js`
          const dirName = fileUtil.getDirName(moduleFile)
          const fileName = fileUtil.getFileBaseName(moduleFile)
          // 创建模块文件
          this.makeModuleFile(`${dirName}/${lowerFirst(fileName)}`, {
            data,
            method,
            path: apiPath,
          })
        }
      }
    } catch (e) {
      logger.error(e.message)
    }
  }

  // 创建模块文件
  makeModuleFile(moduleFile, setup) {
    const { waitingModule } = this
    const { method, path: apiPath } = setup
    const property = `${method} ${apiPath}`
    const waiting = waitingModule[moduleFile]
    if (waiting) {
      // 等待模块创建完成
      if (waiting !== property) {
        return this.once('writeModuleFileEnd', () => {
          this.makeModuleFile(moduleFile, setup)
        })
      }
      return
    }
    //
    const completeHandler = (err) => {
      if (err) {
        logger.error(err.message)
      }
      // 解除锁
      delete waitingModule[moduleFile]
      this.emit('writeModuleFileEnd')
    }
    try {
      // 加入等待创建中
      waitingModule[moduleFile] = property
      // 写文件
      this.writeModuleFile(moduleFile, setup, completeHandler)
    } catch (e) {
      completeHandler(e)
    }
  }

  //
  writeModuleFile(moduleFile, { method, path: apiPath, data }, callback) {
    const encoding = 'utf8'
    const property = `${method} ${apiPath}`
    let code = ''
    if (fs.existsSync(moduleFile)) {
      code = fs.readFileSync(moduleFile).toString(encoding)
    }
    if (data instanceof Buffer) {
      data = data.toString().trim()
    }
    if (data) {
      // 转换为mockjs
      data = MockConverter.toMockJS(data)
    }
    if (code) {
      // 已有代码文件中插入API
      code = this.injectAPICode(code, property, data)
    } else {
      // 新的模板代码
      code = this.getTemplateCode(property, data)
    }
    commonUtil.formatCode(code, {}, (code) => {
      // 写入代码文件
      fs.writeFile(moduleFile, code, { encoding }, (err) => {
        if (!err) {
          logger.echo(
            `Mock ${chalk.cyan('generated')}: ${method.toUpperCase()} ${chalk.cyan(
              apiPath
            )} [${this.locateMock(moduleFile, { method, path: apiPath }, code)}]`
          )
        }
        //
        callback(err)
      })
    })
  }

  // 注入API代码
  injectAPICode(code, propertyName, data) {
    // 查找默认导出对象
    this.findDefaultExportObjectDeclaration(code, (declaration, path, ast) => {
      if (!declaration) {
        return
      }
      // 修改导出属性
      const properties = declaration.properties
      for (const prop of properties) {
        if (babelTypes.isStringLiteral(prop.key)) {
          if (`${prop.value}`.trim() === propertyName) {
            return code
          }
        }
      }
      const placeholder = data ? `_${uuidv4()}`.replace(/-/g, '_') : ''
      // 创建代码结构
      properties.push(
        babelTypes.objectProperty(
          babelTypes.stringLiteral(propertyName),
          babelTypes.arrowFunctionExpression(
            [
              babelTypes.identifier('req'),
              babelTypes.identifier('res'),
              babelTypes.identifier('next'),
            ],
            // 创建方法
            placeholder
              ? // 使用模板替换复杂语句
                babelTypes.blockStatement([
                  babelTypes.returnStatement(babelTypes.identifier(placeholder)),
                ])
              : // 创建简单方法调用语句
                babelTypes.callExpression(babelTypes.identifier('next'), [])
          )
        )
      )
      // 生成源代码内容
      code = this.generate(
        ast,
        {
          sourceMaps: false,
          comments: true,
        },
        code
      ).code
      // 替换代码块
      if (placeholder) {
        code = code.replace(placeholder, data)
      }
    })
    //
    return code
  }

  // 获取样板代码
  getTemplateCode(replace, data) {
    const { defaultDelay, defaultDisabled } = this.options
    return `/* eslint-disable */

// http://mockjs.com/examples.html
import Mock from 'mockjs'

//
//
export const delay = ${isNaN(defaultDelay) ? 0 : Math.max(Math.floor(+defaultDelay), 0)}
export const disabled = ${!!defaultDisabled}
//
//
export default {
  //
  '${replace}': (req, res, next) => ${
      data
        ? `{
  return ${data}
}`
        : 'next()'
    },
}`
  }

  //
}
