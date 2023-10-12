const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  mode: "development",
  devtool: "source-map",
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "assets/**/*.*", context: "src/" },
        { from: "*.html", context: "src/" },
        { from: "*.css", context: "src/" },
      ],
    }),
  ],
  entry: {
    helloWorldDemo: {
      import: "./src/helloWorldDemo.js",
    },
  },
  resolve: {
    extensions: [".js"],
  },
  module: {},
  output: {
    clean: true,
  },
  devServer: {
    static: "./dist",
    liveReload: true,
    hot: true,
    open: "/",
    watchFiles: ["./src/index.html"],
  },
};
