var plugins = {
  markdown: require('tale-plugin-markdown')({})
}

var tale = require('..')({
  base_url: './build',
  plugins: plugins
})
