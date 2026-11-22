const { app, BrowserWindow, ipcMain, shell, protocol, net, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let win = null;
const SMOKE = process.argv.indexOf('--smoke') >= 0;
const ROOT = path.join(__dirname, 'renderer');

// 只允许开一个窗口。开第二个时，把已经开着的那扇拉到前面。
// 两个实例同时用同一个数据目录，会把 Chromium 的存储锁死，
// 第二个窗口读不到账户，看上去就像「账号不见了」。
const SINGLE = !SMOKE && process.argv.indexOf('--gate') < 0;
if (SINGLE && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', function () {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
});

// 透明窗口需要 GPU 合成，否则圆角外会变成一块不透明的白底
// 遇到老旧驱动启动异常时，用 --no-gpu 关掉加速
if (process.argv.indexOf('--no-gpu') >= 0) app.disableHardwareAcceleration();

// 数据目录用英文名，避免中文路径在某些机器上出权限问题
app.setPath('userData', path.join(app.getPath('appData'), 'CunNianJar'));

// 启动日志：万一开不起来，用户能把这个文件发我
const LOG_TARGETS = [
  path.join(app.getPath('userData'), 'startup.log'),
  path.join(path.dirname(process.execPath), 'startup.log'),
  path.join(app.getPath('temp'), 'cunnian-startup.log')
];
function log(m) {
  const line = new Date().toISOString() + '  ' + m + '\r\n';
  LOG_TARGETS.forEach(function (t) {
    try {
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.appendFileSync(t, line);
    } catch (e) { /* ignore */ }
  });
}
log('--- boot pid=' + process.pid + ' version=' + process.versions.electron);

const T0 = Date.now();
function mark(name) { log('[' + (Date.now() - T0) + 'ms] ' + name); }

process.on('uncaughtException', function (err) {
  log('UNCAUGHT ' + (err && err.stack ? err.stack : err));
  try {
    const { dialog } = require('electron');
    dialog.showErrorBox('存念小罐 启动失败', String((err && err.message) || err));
  } catch (e) { /* ignore */ }
  app.exit(1);
});

// 用 app:// 这个协议承载页面，而不是 file://
// 这样浏览器会给它一个正常的 origin，localStorage 的读写才有保障
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

function serveLocal(request) {
  let rel = decodeURIComponent(new URL(request.url).pathname);
  if (!rel || rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(filePath).toString());
}

function saveImage(src) {
  const m = /^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]*)$/.exec(src || '');
  const ext = m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
  const target = dialog.showSaveDialogSync(win, {
    title: '保存图片',
    defaultPath: path.join(app.getPath('pictures'), '存念-' + Date.now() + '.' + ext),
    filters: [{ name: '图片', extensions: [ext] }, { name: '所有文件', extensions: ['*'] }]
  });
  if (!target) return;
  try {
    if (m) {
      fs.writeFileSync(target, Buffer.from(m[2], 'base64'));
    } else {
      win.webContents.downloadURL(src);
      return;
    }
    log('image saved ' + target);
  } catch (e) {
    log('image save failed ' + e.message);
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 812,
    minWidth: 1040,
    minHeight: 700,
    // macOS 保留系统红绿灯，Windows 用无边框 + 自绘圆点
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 16 } : undefined,
    transparent: true,
    backgroundColor: '#00000000',
    show: true,
    hasShadow: false,
    title: '存念小罐',
    icon: path.join(__dirname, 'build', isMac ? 'icon.png' : 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mark('window-created');
  if (win.removeMenu) win.removeMenu();
  win.setMenuBarVisibility(false);

  const hash = SMOKE ? '#demo,nosplash,nogreet' : '';
  const entry = path.join(ROOT, 'index.html');
  let loaded = false;
  win.loadURL('app://local/index.html' + hash).then(function () { loaded = true; }).catch(function () {});

  // 万一自定义协议被环境拦了，退回本地文件，别开一个白窗
  win.webContents.on('did-fail-load', function (ev, code, desc, url) {
    if (!loaded && String(url).indexOf('app://') === 0) {
      loaded = true;
      win.loadFile(entry, hash ? { hash: hash.slice(1) } : undefined);
    }
  });

  win.webContents.on('did-finish-load', function () {
    mark('did-finish-load');
    // 标题栏可拖动，三颗圆点变成真正的窗口按钮
    win.webContents.executeJavaScript([
      '(function(){',
      '  if (document.getElementById("dsh-win-css")) return;',
      '  var st = document.createElement("style");',
      '  st.id = "dsh-win-css";',
      '  st.textContent = [',
      '    ".stage{padding:0}",',
      '    "html,body,.stage{background:transparent!important;outline:none!important}",',
      '    ".win{width:100%!important;max-width:none!important;height:100%!important;border-radius:26px!important;box-shadow:inset 0 0 0 1px var(--line)!important}",',
      '    ".splash,.gate,.ov{border-radius:26px!important}",',
      '    "html.maxed .win{width:100%!important;height:100%!important;border-radius:0!important;box-shadow:none!important}",',
      '    "html.maxed .splash,html.maxed .gate,html.maxed .ov{border-radius:0!important}",',
      '    ".tl i{cursor:pointer}",',
      '    ".tl i:hover{filter:brightness(1.12)}",',
      // macOS 用系统红绿灯，藏掉自绘的那三颗并给它们让出位置
      isMac ? '    ".tl{display:none}",' : '',
      isMac ? '    ".tbar{padding-left:84px}",' : '',
      isMac ? '    ".gate-top{display:none}",' : '',
      '    ""',
      '  ].join("\\n");',
      '  document.head.appendChild(st);',
      '})();'
    ].join('\n')).catch(function (e) { log('win-css failed ' + e.message); });

    win.webContents.executeJavaScript([
      '(function(){',
      '  var d = window.desktop; if(!d) return;',
      '  var groups = document.querySelectorAll(".tl");',
      '  for (var g = 0; g < groups.length; g++){',
      '    var dots = groups[g].querySelectorAll("i");',
      '    if (dots.length !== 3) continue;',
      '    (function(a){',
      '      a[0].title = "关闭"; a[0].onclick = function(){ d.close(); };',
      '      a[1].title = "最小化"; a[1].onclick = function(){ d.minimize(); };',
      '      a[2].title = "最大化"; a[2].onclick = function(){ d.maximize(); };',
      '    })(dots);',
      '  }',
      '  document.addEventListener("keydown", function(e){',
      '    if (e.key === "F11") d.maximize();',
      '  });',
      '})();'
    ].join('\n')).catch(function () {});
  });

  // 右键图片：另存为
  win.webContents.on('context-menu', function (ev, params) {
    if (params.mediaType !== 'image' || !params.srcURL) return;
    Menu.buildFromTemplate([{
      label: '另存图片…',
      click: function () { saveImage(params.srcURL); }
    }]).popup({ window: win });
  });

  // 外链交给系统浏览器
  win.webContents.setWindowOpenHandler(function (info) {
    if (/^https?:/i.test(info.url)) shell.openExternal(info.url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', function () { mark('ready-to-show'); win.show(); mark('shown'); });
  // 开屏动画从页面加载即开始，窗口必须立刻可见，否则动画已经跑完才看到
  win.on('closed', function () { win = null; });

  // 最大化时切成直角，贴满整个窗口
  function setMaxedClass(on) {
    win.webContents.executeJavaScript(
      'document.documentElement.classList.' + (on ? 'add' : 'remove') + '("maxed")'
    ).catch(function () {});
  }
  win.on('maximize', function () { setMaxedClass(true); });
  win.on('unmaximize', function () { setMaxedClass(false); });

  // 标题栏双击最大化 / 还原
  function toggleMax() {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    log('toggle maximize -> ' + win.isMaximized());
  }

  if (SMOKE) {
    win.webContents.once('did-finish-load', function () {
      setTimeout(function () {
        win.webContents.executeJavaScript('(function(){var g=document.querySelectorAll(".tl");var n=0;for(var i=0;i<g.length;i++){var d=g[i].querySelector("i");if(d&&d.onclick)n++;}return g.length+"/"+n;})()')
          .then(function (r) { log('dots groups/hooked=' + r); })
          .catch(function () {});
        win.webContents.capturePage().then(function (img) {
          fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
          console.log('SMOKE_OK');
          app.exit(0);
        }).catch(function (e) {
          console.log('SMOKE_FAIL ' + e.message);
          app.exit(1);
        });
      }, 6000);
    });
  }
}

let drag = null;
ipcMain.on('win:drag-start', function (e, x, y) {
  if (!win || win.isMaximized()) return;
  const p = win.getPosition();
  drag = { sx: x, sy: y, wx: p[0], wy: p[1] };
});
ipcMain.on('win:drag-move', function (e, x, y) {
  if (!drag || !win) return;
  win.setPosition(Math.round(drag.wx + (x - drag.sx)), Math.round(drag.wy + (y - drag.sy)));
});
ipcMain.on('win:drag-end', function () { drag = null; });

ipcMain.on('win:close', function (e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.close();
});
ipcMain.on('win:min', function (e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.minimize();
});
ipcMain.on('win:max', function (e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});

app.setAppUserModelId('com.cunnian.jar');

app.whenReady().then(function () {
  mark('app-ready');
  protocol.handle('app', serveLocal);
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
