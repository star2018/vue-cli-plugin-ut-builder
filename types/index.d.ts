import { ProjectOptions } from '@vue/cli-service'
import ChainableWebpackConfig = require('webpack-chain')
import * as HtmlWebpackPlugin from 'html-webpack-plugin'
import * as WebpackNotifierPlugin from 'webpack-notifier'

import {
  WebpackPluginFunction,
  WebpackPluginInstance,
} from 'webpack/declarations/WebpackOptions'

// 预处理配置对象
export interface PreprocessConfig {
  mpa?: boolean
  moduleEntry?: string
  moduleRoot?: string
  htmlTemplate?: string
  moduleFilter?: string
  routeExtensions?: string
  routerViews?: string
  kebabCasePath?: boolean
  codeSplitting?: boolean
  codeSplittingExclude?: string
  appPlugins?: string
  appUseVuex?: boolean
  appUseRouter?: boolean
  appNestedRoutes?: 'auto' | 'manual' | 'none'
  appRouterMode?: 'hash' | 'history'
  routerParamsSymbol?: string
  routerViewSymbol?: string
  routerMapProps?: 'all' | 'params' | 'query' | 'none'
  rootAppPath?: string
  moduleRouterName?: string
  moduleStoreName?: string
}

// Adds a banner to the top of each generated chunk.
export type BannerOptions = {
  banner: string | Function // the banner as string or function, it will be wrapped in a comment
  raw: boolean // if true, banner will not be wrapped in a comment
  entryOnly: boolean // if true, the banner will only be added to the entry chunks
  test: string | RegExp | string[]
  include: string | RegExp | string[]
  exclude: string | RegExp | string[]
}

// 拷贝
export type CopyOptions = { [from: string]: string } | { from: string; to: string }[]

// 压缩
export type CompressTaskOptions = { name?: string; dot?: boolean; copy?: CopyOptions }
export type CompressOptions =
  | boolean
  | string
  | CompressTaskOptions
  | CompressTaskOptions[]

// 环境变量定义
export type DefineOptions = {
  [env: string]: string | boolean | number
}

// DLL
export type DllOptions = boolean | { [bundleName: string]: string | string[] }

// eject
export type EjectOptions = boolean | string | string[]

// html
export type HTMLOptions = { [pageName: string]: HtmlWebpackPlugin.Options }

// mock
export type WebsocketMockOptions = {
  context?: ''
  debugContext?: ''
  channel?: string | string[]
  client?: string
  port?: number
}
export type MockOptions =
  | boolean
  | {
      http?: boolean
      path?: string
      delay?: number
      defaultDelay?: number
      init?: boolean
      locate?: boolean
      defaultDisabled?: boolean
      pathHandler?: (path: string) => string | void
      exclude?: string | ((path: string) => boolean) | RegExp
      data: { input?: string; output?: string }
      ws: boolean | WebsocketMockOptions
    }

// sprites
export type SpritesOptions =
  | boolean
  | {
      iconLibClass?: string
      classPrefix?: string
      kebabCaseName?: string
      src?: { cwd?: string; glob?: string; options?: object }
      target?: { image?: string; css?: string }
      templateHandler?: (data: object) => string
      spritesmithOptions?: object
      retina?: object
    }

// svg icons
export type SvgIconConfig = {
  src?: string
  prefix?: string
  kebabCaseName?: string
}
export type SvgIconOptions = boolean | string | SvgIconConfig | SvgIconConfig[]

// theme
export type ThemeOption = {
  patterns: string | string[]
  preProcessor?: 'sass' | 'scss' | 'stylus' | 'less'
  injector?: 'prepend' | 'append' | ((source, resources) => string)
  globOptions?: object
  resolveUrl?: boolean
}
export type ThemeOptions = string | string[] | ThemeOption | ThemeOption[]

// unused
export type UnusedOptions =
  | boolean
  | {
      directories: string[]
      failOnUnused?: boolean
      exclude: string[]
      root: string
      useGitIgnore: boolean
    }

// watch
export type WatchOptions = {
  done?: () => void | Promise<any>
  watchRun?: () => void | Promise<any>
  invalid?: () => void
}

// 可用服务配置
export interface ServiceConfig {
  banner: string | boolean | Function | BannerOptions
  copy: CopyOptions
  compress: CompressOptions
  define: DefineOptions
  dll: DllOptions
  eject: EjectOptions
  html: HTMLOptions
  mock: MockOptions
  notifier: WebpackNotifierPlugin.Options
  removeConsole: boolean | { exclude: string[] }
  removeDebugger: boolean
  sprites: SpritesOptions
  svgIcon: SvgIconOptions
  theme: ThemeOptions
  timeCost: boolean
  unused: UnusedOptions
  watch: WatchOptions
  [service: string]: any
}

// 自定义服务运行时上下文对象
export interface ServiceContext {
  api: object
  plugin: { use: () => {} }
  config: ChainableWebpackConfig
  isDev: boolean
  isDevelopment: boolean
  isTest: boolean
  isProd: boolean
  isProduction: boolean
  env: object
  args: object
  rawArgv: string[]
  command: string
  commandList: string[]
  modernApp: boolean
  modernBuild: boolean
  merge: () => any
  registerShutdown: () => any
  watch: () => any
}

export interface UTBuilder extends ProjectOptions {
  pluginOptions: {
    htmlTemplate?: string
    moduleEntry?: string
    pageNameMap?: object
    preprocess?: PreprocessConfig
    services?: ServiceConfig
    registerService?: {
      [key: string]: {
        (context: ServiceContext, options: any, projectOptions: ProjectOptions): any
      }
    }
    registerPlugin?: {
      [plugin: string]: WebpackPluginFunction | WebpackPluginInstance
    }
    [plugin: string]: any
  }
}

export default UTBuilder
