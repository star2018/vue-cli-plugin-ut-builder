const endOfLine = require('os').EOL
const { existsSync, getAbsPath, ensurePathQuote } = require('../utils/file')

module.exports = ({ importName = 'globalMain', config: { build_module_entry } }) => {
  const globalMainFile = getAbsPath(build_module_entry || 'src/main.js')
  const codeFragment = [`// main.js${endOfLine}`]
  if (existsSync(globalMainFile)) {
    codeFragment.push(
      `import ${importName} from '${ensurePathQuote(globalMainFile)}'${endOfLine}`
    )
  } else {
    codeFragment.push(`const ${importName}=undefined${endOfLine}`)
  }
  return codeFragment.join(endOfLine)
}
