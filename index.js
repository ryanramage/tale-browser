module.exports = init;

var _ = require('lodash'),
    async = require('async'),
    director = require('director'),
    oboe = require('oboe'),
    marked = require('marked'),
    ractive = require('ractive'),
    store = require('store'),
    read_api = require('tale-read-api'),
    chapter_t = require('./chapter.template.html');

function init(options) {
  var opts = options || {};
  if (!opts.el) opts.el = '#tale';
  if (!opts.base_url) opts.base_url = './';
  if (!opts.template) opts.template = chapter_t;
  if (!opts.plugins)  opts.plugins = {};

  var routes = {
    '/*': show_chapter,
    '/': first_chapter

  }
  if (opts.routes) routes = _.extend(routes, opts.routes);


  var read = read_api(opts.base_url),
      current_chapter,
      current_key,
      invalid_count = 0,
      chapter_hint_count = 0,
      internal_hint_count = 0,
      check_availablity_interval,
      ractive = new Ractive({
        el: opts.el,
        template: opts.template,
        data: {
          appcache_loading: true,
          chapter: null,
          next: [],
          all_hints: [],
          unlocking: false
        }
      });

  router = director.Router(routes);
  router.init('/');

  function clearInvalidMessage(keypath){
    ractive.set(keypath + '.error','');
  }

  var clearInvalidDebounce = _.debounce(clearInvalidMessage, 1000);

  ractive.on('crack', function(e){
    var id = e.context.id.toString(),
        pass = e.context.pass + '',
        keypath = e.keypath,
        next_hints = _.clone(e.context.hints),
        crack = read.crack_node.bind(null, id, pass, function(err, next){
          if (err) return showErrorMsg(keypath, next_hints);
          invalid_count = 0; chapter_hint_count = 0; internal_hint_count = 0;
          ractive.set('all_hints', []);
          current_chapter = next.node;
          current_key = next.key;
          store_key(id, next.node.id, next.key);
          router.setRoute('/' + next.node.id)
        });
    ractive.set('unlocking', true);
    setTimeout(crack, 0);
  });

  ractive.on('end_link', function(e){
    // we might want to add some query params here
    window.location = e.context.chapter.end_link;
  })

  function store_key(clue_id, chapter_id, key){
    store.set(clue_id, chapter_id);
    store.set(chapter_id, key);
  }

  function show_chapter(chapter_id) {
    // the current route is pointing to the currently unlocked
    if (current_chapter && current_key && current_chapter.id === chapter_id){
      return render_chapter(current_chapter, current_key)
    }
    var key = store.get(chapter_id);
    if (!key) return showEncryptedMsg();


    read.read_node(chapter_id, key, function(err, chapter){
      render_chapter(chapter, key);
    })
  }


  function first_chapter() {
    read.first_node(function(err, start_chapter){
      if (err) return;
        current_chapter = start_chapter;
        current_key = null;
        render_chapter(start_chapter);
    })
  }

  function showErrorMsg(keypath, next_hints) {
    ractive.set('unlocking', false);
    if (invalid_count++ >= 3){
      // show a hint
      var hint;
      if (next_hints && chapter_hint_count < next_hints.length ) hint = next_hints[chapter_hint_count++];
      if (!hint) {
        hint = builtin_hints[internal_hint_count++];
      }
      if (!hint) return;
      var all_hints = ractive.get('all_hints');
      all_hints.push(hint);
      invalid_count = 0;
    }
    ractive.set(keypath + '.error',"Invalid Answer");
    return clearInvalidDebounce(keypath);
  }

  function render_chapter(chapter, key) {
    ractive.set('chapter', chapter);

    function done(err){
      render_clues(chapter);
      ractive.set('unlocking', false);
      ractive.set('appcache_loading', false);
      window.scrollTo(0, 0);
    }
    if (chapter.type === 'text') return render_text(chapter, key);

    async.eachSeries(chapter.plugins, function(requested_plugin, cb){
      var plugin = opts.plugins[requested_plugin]
      if (!plugin) return cb();
      plugin(ractive, read, chapter, key, cb)
    }, done);

  }


  function render_text(chapter, key){
     ractive.set('content', chapter.text);
  }

  function render_clues(chapter) {
    ractive.set('next', []);
    var names = _.keys(chapter.next_folder);
    _.each(names, function(name, i){
      var ch = chapter.next_folder[name];
      ch.unlocked = store.get(ch.id);
      ractive.set('next[' + i + ']', ch);
    })
  }

  return ractive;
}

