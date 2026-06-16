const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Tray, nativeImage, clipboard } = require('electron');
const path   = require('path');
const http   = require('http');
const os     = require('os');
const fs     = require('fs');
const { fork } = require('child_process');

let mainWindow   = null;
let serverProcess = null;
let tray         = null;
let serverPort   = 3030;

function getNetworkIPs() {
  const ips = [];
  Object.values(os.networkInterfaces()).forEach(iface =>
    iface?.forEach(a => { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); })
  );
  return ips;
}

function waitForServer(port, retries = 50) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const check = () => {
      http.get(`http://localhost:${port}/api/info`, res => {
        if (res.statusCode < 500) resolve(port);
        else retry();
      }).on('error', retry);
    };
    const retry = () => { if (++n < retries) setTimeout(check, 300); else reject(new Error('timeout')); };
    check();
  });
}

async function startServer() {
  const portFile = path.join(app.getPath('temp'), 'codev_port.txt');
  // Remove stale port file
  try { fs.unlinkSync(portFile); } catch {}

  const workspace  = app.getPath('documents');
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  serverProcess = fork(serverPath, ['--mode', 'client'], {
    env: {
      ...process.env,
      PORT:      '3030',
      WORKSPACE: workspace,
      MODE:      'client',
      ELECTRON:  '1',
      PORT_FILE: portFile,
    },
    silent: true
  });

  serverProcess.stdout?.on('data', d => {
    const txt = d.toString().trim();
    console.log('[srv]', txt);
    // Parse actual port from output
    const m = txt.match(/using (\d+)|port (\d+)/i);
    if (m) serverPort = parseInt(m[1] || m[2]);
  });
  serverProcess.stderr?.on('data', d => console.error('[srv]', d.toString().trim()));
  serverProcess.on('message', msg => {
    if (msg?.type === 'server-ready') serverPort = msg.port;
  });
  serverProcess.on('exit', code => { if (code && code !== 0) console.error('[srv] exited:', code); });

  // Wait for server, read actual port from file
  try {
    await waitForServer(3030);
    serverPort = 3030;
  } catch {
    // Try reading port file
    try {
      await new Promise(r => setTimeout(r, 1000));
      serverPort = parseInt(fs.readFileSync(portFile, 'utf-8').trim()) || 3030;
      await waitForServer(serverPort);
    } catch (e2) {
      dialog.showErrorBox('CodeV', 'Server could not start. Try closing other CodeV instances.');
      app.quit();
      return;
    }
  }
  console.log(`[electron] Server ready on port ${serverPort}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 800, minHeight: 600,
    title: 'CodeV — Collaborative Editor',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d0f14', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${serverPort}`)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  buildMenu();
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(`CodeV — http://localhost:${serverPort}`);
  const ips = getNetworkIPs();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'CodeV', enabled: false },
    { type: 'separator' },
    { label: `Local:   http://localhost:${serverPort}`, enabled: false },
    ...ips.map(ip => ({ label: `Network: http://${ip}:${serverPort}`, click: () => clipboard.writeText(`http://${ip}:${serverPort}`) })),
    { type: 'separator' },
    { label: 'Open Editor', click: () => { if (mainWindow) mainWindow.focus(); else createWindow(); } },
    { label: 'Copy Local URL', click: () => clipboard.writeText(`http://localhost:${serverPort}`) },
    { type: 'separator' },
    { label: 'Quit CodeV', click: () => app.quit() }
  ]));
  tray.on('double-click', () => { if (mainWindow) mainWindow.focus(); else createWindow(); });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const ips   = getNetworkIPs();
  const exec  = js => mainWindow?.webContents.executeJavaScript(js);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' }
    ]}] : []),

    { label: 'File', submenu: [
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
        if (!result.canceled && result.filePaths[0]) {
          const fp = result.filePaths[0].replace(/\\/g, '/');
          exec(`(function(){ const el=document.getElementById('folder-path'); if(el){el.value='${fp}';openFolderConfirm();}else{myWorkspace='${fp}';wsSend({type:'set_workspace',path:'${fp}'});refreshTree();} })()`);
        }
      }},
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => exec('saveFile()') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]},

    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find in Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => exec('toggleSearch()') },
      { label: 'Format Document', accelerator: 'Shift+Alt+F', click: () => exec('formatDocument()') },
    ]},

    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' }, { type: 'separator' },
      { label: 'Toggle Sidebar',  click: () => exec(`document.getElementById('sidebar').classList.toggle('collapsed')`) },
      { label: 'Split Editor',    accelerator: 'CmdOrCtrl+\\\\', click: () => exec('toggleSplitEditor(!splitEnabled)') },
      { label: 'Toggle Terminal', click: () => exec(`switchRTab(document.querySelector('.rtab.active')?.textContent==='Terminal'?'chat':'terminal')`) },
      { type: 'separator' },
      { label: 'Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow?.webContents.toggleDevTools() }
    ]},

    { label: 'Git', submenu: [
      { label: 'Refresh Status', click: () => exec(`switchSTab('git');refreshGit()`) },
      { label: 'Pull',           click: () => exec('gitPull()') },
      { label: 'Push',           click: () => exec('gitPush()') },
      { label: 'Fetch',          click: () => exec('gitFetch()') },
      { type: 'separator' },
      { label: 'Clone Repository…', click: () => exec(`showModal('clone-modal')`) },
      { label: 'New Branch…',       click: () => exec('showBranchInput()') },
    ]},

    { label: 'Session', submenu: [
      { label: `Local:   http://localhost:${serverPort}`, enabled: false },
      ...ips.map(ip => ({ label: `Network: http://${ip}:${serverPort}`, enabled: false })),
      { type: 'separator' },
      { label: 'Copy Local URL',   click: () => clipboard.writeText(`http://localhost:${serverPort}`) },
      ...ips.map(ip => ({ label: `Copy Network URL (${ip})`, click: () => clipboard.writeText(`http://${ip}:${serverPort}`) })),
      { type: 'separator' },
      { label: 'Share Session…',   click: () => exec(`showModal('share-modal');document.getElementById('share-url').textContent=location.href`) },
    ]},

    { label: 'Help', submenu: [
      { label: 'Open in Browser', click: () => shell.openExternal(`http://localhost:${serverPort}`) },
      { label: 'Admin Panel',     click: () => shell.openExternal(`http://localhost:${serverPort}/admin`) },
      { type: 'separator' },
      { label: 'View README', click: () => {
        const p = path.join(__dirname, '..', 'README.md');
        if (fs.existsSync(p)) shell.openPath(p);
        else dialog.showMessageBox(mainWindow, { type: 'info', message: 'README not found' });
      }},
      { label: 'Keyboard Shortcuts', click: () => dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Keyboard Shortcuts',
        message: 'CodeV Keyboard Shortcuts',
        detail: [
          'Ctrl+S          Save + create snapshot',
          'Ctrl+W          Close current tab',
          'Ctrl+\\          Toggle split editor',
          'Ctrl+Shift+F    Search across all files',
          'Shift+Alt+F     Format with Prettier',
          'Ctrl+G          Add comment at cursor',
          'Alt+Click       Add cursor (multi-cursor)',
          'Ctrl+Z          Undo',
          'Ctrl+L          Clear terminal',
          '↑ / ↓           Terminal command history',
        ].join('\n')
      })},
      { type: 'separator' },
      { label: 'About CodeV', click: () => dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'CodeV v2.0.0',
        message: 'CodeV — Collaborative Code Editor',
        detail: `By mrtcnrsln\n\nLocal:   http://localhost:${serverPort}\nNetwork: ${ips.map(ip=>`http://${ip}:${serverPort}`).join(', ') || 'N/A'}`
      })}
    ]}
  ]));
}

ipcMain.handle('get-server-port',    () => serverPort);
ipcMain.handle('get-platform',       () => process.platform);
ipcMain.handle('get-network-ips',    () => getNetworkIPs());
ipcMain.handle('open-folder-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

app.whenReady().then(async () => {
  await startServer();
  createWindow();
  createTray();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  if (serverProcess) { try { serverProcess.kill(); } catch {} serverProcess = null; }
  if (tray)          { try { tray.destroy(); }       catch {} tray = null; }
});
