const chokidar = require('chokidar');
const path = require('path');

module.exports = function setupWatcher(WORKSPACE, broadcastFn) {
  const watcher = chokidar.watch(WORKSPACE, {
    ignored: [
      /(^|[/\\])\../,          // dotfiles
      '**/node_modules/**',
      '**/.git/**',
      '**/*.log',
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    depth: 10,
  });

  watcher
    .on('add',    f => broadcastFn({ type: 'fs_event', event: 'add',    path: rel(f, WORKSPACE) }))
    .on('unlink', f => broadcastFn({ type: 'fs_event', event: 'unlink', path: rel(f, WORKSPACE) }))
    .on('addDir', f => broadcastFn({ type: 'fs_event', event: 'addDir', path: rel(f, WORKSPACE) }))
    .on('unlinkDir', f => broadcastFn({ type: 'fs_event', event: 'unlinkDir', path: rel(f, WORKSPACE) }))
    .on('change', f => broadcastFn({ type: 'fs_changed', path: rel(f, WORKSPACE) }))
    .on('error',  e => console.error('[watcher]', e));

  return watcher;
};

function rel(fullPath, base) {
  return path.relative(base, fullPath);
}
