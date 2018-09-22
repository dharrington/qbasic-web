const path = require('path');

var config = {
  entry: './src/qbui.ts',
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ],
    alias: {
      "codemirror": path.resolve(__dirname, 'node_modules/codemirror/')
    }
  },
  output: {
    filename: 'qb-bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: "qb",
    libraryTarget: 'var'
  }
};

module.exports = (env,argv)=>{
  if (argv.mode === 'development') {
    config.devtool = 'inline-source-map';
    config.mode = 'development';
  }
  return config;
};

