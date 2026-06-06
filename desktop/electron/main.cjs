const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron')
const path = require('path')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let win, tray

function createWindow() {
  win = new BrowserWindow({
    width: 500,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5174')
  } else {
    win.loadFile(path.join(__dirname, '../build/index.html'))
  }

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) win.hide()
  })
}

function createTray() {
  // 16x16 red square as fallback icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAALEwAACxMBAJqcGAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABHSURBVDiNY/z//z8DJYCJgUIwasCoAaMGUMcAFkYGBgYGJkYGqBhRmJGBgYGJkYEBZgAxmJGBgYGJkYEBZgAxmJGBgQEAmyUFE3vRecEAAAAASUVORK5CYII='
  )

  tray = new Tray(icon)
  tray.setToolTip('CUM — Tasks & Meals')

  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide()
    } else {
      const { x, y, width } = tray.getBounds()
      const [ww, wh] = win.getSize()
      const { screen } = require('electron')
      const display = screen.getPrimaryDisplay()
      const dh = display.workAreaSize.height

      // Position above tray icon
      win.setPosition(
        Math.round(x + width / 2 - ww / 2),
        Math.round(dh - wh - 8)
      )
      win.show()
      win.focus()
    }
  })

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { win.show(); win.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
}

app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', (e) => e.preventDefault())
