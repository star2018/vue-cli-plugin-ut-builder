// 注册babel转译

module.exports = (opts) => {
  //
  if (process.env.NODE_ENV !== 'test') {
    let { only, ignore, babelPreset } = Object.assign({}, opts)
    if (!babelPreset) {
      babelPreset = [
        require.resolve('@babel/preset-env'),
        {
          modules: 'commonjs',
          targets: {
            node: 'current',
          },
        },
      ]
    }
    require('@babel/register')({
      presets: [babelPreset],
      only,
      ignore,
      babelrc: false,
      cache: false,
    })
  }
}
