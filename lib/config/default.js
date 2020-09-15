// 默认的配置
module.exports = () => ({
  // project deployment base
  publicPath: '/',

  // where to output built files
  outputDir: 'dist',

  // where to put static assets (js/css/img/font/...)
  assetsDir: '',

  // filename for index.html (relative to outputDir)
  indexPath: 'index.html',

  // whether filename will contain hash part
  filenameHashing: true,

  // boolean, use full build?
  runtimeCompiler: true,

  // deps to transpile
  transpileDependencies: [
    /* string or regex */
  ],

  // sourceMap for production build?
  productionSourceMap: false,

  // use thread-loader for babel & TS in production build
  // enabled by default if the machine has more than 1 cores
  // parallel: true,

  // multi-page config
  pages: undefined,

  // <script type="module" crossorigin="use-credentials">
  // #1656, #1867, #2025
  crossorigin: undefined,

  // subresource integrity
  integrity: false,

  css: {
    // extract: true,
    // modules: false,
    // localIdentName: '[name]_[local]_[hash:base64:5]', 已删除该配置项
    sourceMap: process.env.NODE_ENV !== 'production',
    // loaderOptions: {}
  },

  // whether to use eslint-loader
  lintOnSave: process.env.NODE_ENV === 'development',

  devServer: {
    open: true,
    // host: '0.0.0.0',
    port: 8080,
    https: false,
    noInfo: true,
    // clientLogLevel: 'warning',
    // hotOnly: false,
    // proxy: null, // string | Object
    // before: app => {}
  },

  // 插件选项
  pluginOptions: {
    // 预处理代码
    preprocess: false,
    // 对输出对页面名称进行映射
    pageNameMap: {},
    // 扩展的构建服务配置
    service: {
      // 系统通知
      notifier: process.env.NODE_ENV === 'development',
      // 构建注释插件
      banner: process.env.NODE_ENV === 'production',
      timeCost: true,
      mock: false,
      // 默认关闭dll（vue包构建出的dll内容似乎使用起来有点问题，待排查）
      dll: false,
      // dll: {
      //   'vendor.dll.[hash:8].js': ['vue', 'vuex', 'vue-router']
      // }
      // 查找未使用的文件
      unused: false,
      removeConsole: false,
      removeDebugger: { exclude: ['error' /*'warn'*/] },
      compress: process.env.NODE_ENV === 'production' ? 'zip/[name]-[version]' : false,
      // 通过打包dll加速
      // eject: 'webpack://',
      // html: {},
      // copy: {},
    },
  },
})
