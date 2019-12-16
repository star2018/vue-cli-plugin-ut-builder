//
module.exports = exports = {
  // 开头斜杆处理
  ensureSlash(val) {
    if (typeof val === 'string') {
      if (!/^https?:/.test(val)) {
        val = val.replace(/^([^/.])/, '/$1')
      }
      return val.replace(/([^/])$/, '$1/')
    }
  },
  // 移除结尾斜杆
  removeSlash(val) {
    if (typeof val === 'string') {
      return val.replace(/\/$/g, '')
    }
  },
  // 过滤字符串
  filter(str, data, pattern, ignoreCase) {
    if (str && data && typeof str === 'string' && typeof data === 'object') {
      const { open, close } = Object.assign(
        {
          open: '[',
          close: ']',
        },
        pattern
      )
      if (ignoreCase) {
        Object.keys(data).forEach((key) => {
          data[key.toLowerCase()] = data[key]
        })
      }
      return str.replace(
        new RegExp(
          `(.?)\\${open}\\s*(.*?)\\s*(\\\\|)${close}`,
          `g${ignoreCase ? 'i' : ''}`
        ),
        (input, g1, g2, g3) => {
          if (g1 === '\\' || g3 === '\\') {
            // 反斜杠转义，不做处理
            return g1 === '\\' ? input.substr(1) : input
          }
          if (!g2) {
            // 没有变量名
            return g1
          }
          let val = data[ignoreCase ? g2.toLowerCase() : g2]
          if (val === undefined) {
            val = ''
          }
          return `${g1}${val}`
        }
      )
    }
    return `${str}`
  },

  // 取得参数过滤用的变量
  getFilterSnippets(formatDate) {
    const env = process.env
    const timestamp = +env.UT_BUILD_COMMAND_TIMESTAMP
    const now = timestamp ? new Date(timestamp) : new Date()
    const year = now.getFullYear()
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    const date = `${now.getDate()}`.padStart(2, '0')
    const hour = `${now.getHours()}`.padStart(2, '0')
    const minutes = `${now.getMinutes()}`.padStart(2, '0')
    const seconds = `${now.getSeconds()}`.padStart(2, '0')

    return Object.assign(
      {
        timestamp: +now,
        version: env['npm_package_version'],
        name: env['npm_package_name'],
      },
      formatDate
        ? {
            time: `${hour}:${minutes}:${seconds}`,
            date: `${year}-${month}-${date}`,
            datetime: `${year}-${month}-${date} ${hour}:${minutes}:${seconds}`,
          }
        : {
            time: `${hour}${minutes}${seconds}`,
            date: `${year}${month}${date}`,
            datetime: `${year}${month}${date}${hour}${minutes}${seconds}`,
          }
    )
  },
}
