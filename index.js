var _ = require('lodash'),
    director = require('director'),
    marked = require('marked'),
    ractive = require('ractive'),
    store = require('store'),
    read_api = require('tale-read-api');

module.exports = function(options) {
  var opts = options || {};
  if (!opts.el) opts.el = '#tale';
  if (!opts.base_url) opts.base_url = './';
  if (!opts.template) opts.template = '#template';
  if (!opts.plugins)  opts.plugins = {};

  var read = read_api(opts.base_url),
      check_availablity_interval,
      initial_state = {
          appcache_loading: true,
          chapter: null,
          next: [],
          all_hints: [],
          unlocking: false,
          content: {
            text: null,
            markdown: null
          },
          context: {
            current_chapter: null,
            current_key: null,
            invalid_count: 0,
            chapter_hint_count: 0,
            internal_hint_count: 0,
          }
      },
      ractive = new Ractive({
        el: opts.el,
        template: opts.template,
        data: initial_state
      }),
      routes = {
        '/*': show_chapter.bind(null, ractive, read),
        '/' : first_chapter.bind(null, ractive, read)
      }

  read.package_details(function(err, pkg){
    ractive.set('package', pkg);
  })

  setup_events(ractive, read);
  setup_plugins(ractive, read, opts.plugins)
  if (opts.routes) routes = _.extend(routes, opts.routes);

  router = director.Router(routes);
  router.init('/');

  return ractive;
}



function first_chapter(ractive, read) {
  read.first_node(function(err, start_chapter){
    if (err) return console.log('error on first chapter', err);
    var context = ractive.get('context');
    context.current_chapter = context.start_chapter;
    context.current_key = null;

    render_chapter(ractive, start_chapter, null);
  })
}



function show_chapter(ractive, read, chapter_id) {
  var context = ractive.get('context');
  // the current route is pointing to the currently unlocked
  if (context.current_chapter && context.current_key && context.current_chapter.id === chapter_id){
    return render_chapter(ractive, current_chapter, current_key)
  }
  var key = store.get(chapter_id);
  if (!key) return showEncryptedMsg();


  read.read_node(chapter_id, key, function(err, chapter){
    if (err) return router.setRoute('/')



    render_chapter(ractive, chapter, key);

    if (ractive.get('please_log_unlocked')){
      ractive.fire('log', 'unlocked', {id: chapter.id, proof: chapter.proof   })
      ractive.set('please_log_unlocked', false);
    }

  })
}



function render_chapter(ractive, chapter, key) {
  ractive.set('chapter', chapter);

  var after = false;
  ractive.observe('content.*', function(){
    if (after) return;
    after = true;
    render_clues(ractive, chapter);
    ractive.set('unlocking', false);
    ractive.set('appcache_loading', false);
    window.scrollTo(0, 0);

  })

  ractive.fire('chapter', chapter, key);
  if (chapter.text === 'text') ractive.set('content.text', chapter.text);
  else ractive.set('content.text', null);

}


function render_clues(ractive, chapter) {
  ractive.set('next', []);
  var names = _.keys(chapter.next_folder);
  _.each(names, function(name, i){
    var ch = chapter.next_folder[name];
    ch.unlocked = store.get(ch.id);
    ractive.set('next[' + i + ']', ch);
  })
}



function setup_events(ractive, read) {
  ractive.on('crack', function(e){
    var id = e.context.id.toString(),
        pass = e.context.pass + '',
        keypath = e.keypath,
        next_hints = _.clone(e.context.hints),
        crack = crack_chapter.bind(null, ractive, read, id, pass, keypath, next_hints);

    ractive.set('unlocking', true);
    setTimeout(crack, 0);
  });

  ractive.on('end_link', function(e){
    // we might want to add some query params here
    window.location = e.context.chapter.end_link;
  })
}

function setup_plugins(ractive, read, plugins) {
  _.each(plugins, function(plugin, name){
    try { plugin(ractive, read) }
    catch(e){
      console.log('there was a problem init a plugin', name, e)
    }
  })
}


function crack_chapter(ractive, read, id, pass, keypath, next_hints) {
  read.crack_node(id, pass, function(err, next){
    if (err) return showErrorMsg(ractive, keypath, next_hints);
    invalid_count = 0; chapter_hint_count = 0; internal_hint_count = 0;
    ractive.set('all_hints', []);
    ractive.fire('cracked');
    ractive.set('please_log_unlocked', true);
    current_chapter = next.node;
    current_key = next.key;
    store_key(id, next.node.id, next.key);
    router.setRoute('/' + next.node.id)
  });
}


function showErrorMsg(ractive, keypath, next_hints) {

  var context = ractive.get('context');
  ractive.set('unlocking', false);
  if (context.invalid_count++ >= 3){
    // show a hint
    var hint;
    if (next_hints && context.chapter_hint_count < next_hints.length ) hint = next_hints[context.chapter_hint_count++];
    if (!hint) {
      hint = builtin_hints[internal_hint_count++];
    }
    if (!hint) return;
    var all_hints = ractive.get('all_hints');
    all_hints.push(hint);
    context.invalid_count = 0;
  }
  ractive.set(keypath + '.error',"Invalid Answer");
  var clearInvalidDebounce = _.debounce(function(){
    ractive.set(keypath + '.error','');
  }, 1000);
  return clearInvalidDebounce(keypath);
}



function store_key(clue_id, chapter_id, key){
  store.set(clue_id, chapter_id);
  store.set(chapter_id, key);
}
