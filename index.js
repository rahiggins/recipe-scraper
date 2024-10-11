// Modules to control application life and create native browser window

// This module:
//  - creates IPC listeners
//   -- to open developer tools (tools)
//   -- to create a browser window and load either current.html or past.html (mode) and
//        to execute current.js or past.js
//   -- to create a browser window and load an NYT article (article-click)
//  - creates a browser window and loads index.html into it

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//    function mainline
//      function createWindow
//      ipcMain.on('tools')
//      ipcMain.on('mode')
//        require('./current.js')
//        require('./past.js')
//      ipcMain.on('article-click'
//      app.whenReady()
//      app.on('window-all-closed')
//      app.on('activate')

// Program flow:
//
//  mainline
//    Listen for a 'tools' message
//      openDevTools()
//    Listen for a 'mode' message ('current' or 'past')
//      Call createWindow
//      Execute current.js or past.js
//    Listen for an 'article-click' message
//    Listen for an app.whenReady event
//      Call createWindow
//    Listen for an app.on('window-all-closed') event
//      app.quit()
//    Listen for an app.on('activate') event
//      Call createWindow

const { app, BrowserWindow } = require('electron')
const { ipcMain } = require('electron')
const path = require('path')

app.disableHardwareAcceleration() // work-around for electron bug #43415

// let x // BrowserWindow position
// let y // BrowserWindow position
let xArt // article BrowserWindow position
let yArt // article BrowserWindow position
let articleWindows = [] // Array of article window IDs

async function mainline () {
  function createWindow (xpos, ypos, wattr, hattr, preload, load) {
    // Create a browser window.
    global.win = new BrowserWindow({
      x: xpos,
      y: ypos,
      width: wattr,
      // width: 1500,  // for devTools
      height: hattr,
      webPreferences: {
        preload: path.join(__dirname, preload)
      }
    })

    // Get window location
    const winBounds = global.win.getBounds()
    global.x = winBounds.x
    global.y = winBounds.y
    xArt = global.x + 400 // Offsets for article windows relative to current.html window
    yArt = global.y + 15

    // and load the specified html file.
    global.win.loadFile(load)

    // Open the DevTools.
    // win.webContents.openDevTools()
  }

  // Create an interprocess communications listener to open devtools to display error logging
  ipcMain.on('tools', () => {
    global.win.webContents.openDevTools()
  })

  // // Return app data path and app name to renderer process
  // ipcMain.handle('getAppData', () => {
  //   return {
  //     path: app.getPath('appData'),
  //     name: app.name
  //   }
  // })

  // Create an interprocess communications listener to process the
  //  'current'/'past' selection on index.html
  ipcMain.on('mode', (event, arg) => {
    console.log('index.js - mode: arg: ' + arg)
    if (arg === 'current') {
      global.win.close()
      createWindow(29, 46, 900, 675, 'current-preload.js', 'current.html')
      require('./current.js')
    } else if (arg === 'past') {
      global.win.close()
      createWindow(29, 46, 600, 450, 'past-preload.js', 'past.html')
      require('./past.js')
    } else {
      console.log('Unexpected mode: ' + arg)
    }
  })

  // Create an interprocess communications listener to open articles
  //  in a new window on request by the renderer process
  ipcMain.on('article-click', (event, action, url) => {
    // console.log("article-click: " + event + ", " + action + ", " + url);
    if (action === 'click') {
      // Create an article BrowserWindow
      const winArticle = new BrowserWindow({
        width: 900,
        height: 600,
        x: xArt, // position relative to win BrowserWindow
        y: yArt,
        webPreferences: {
          nodeIntegration: true
        }
      })
      articleWindows.push(winArticle.id) // Record window ID for close later
      winArticle.loadURL(url) // load article
      xArt += 21 // Offset the next article window to the right and down
      yArt += 21
    } else if (action === 'close') {
      // Close all article windows

      for (let w = 0; w < articleWindows.length; w++) {
        const windowToClose = BrowserWindow.fromId(articleWindows[w])
        if (windowToClose !== null) { // If not already closed, ...
          windowToClose.close()
        }
      }

      articleWindows = [] // Empty article window ID array
    }
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.

  // Create initial window
  app.whenReady().then(() => {
    createWindow(29, 46, 450, 340, 'preload.js', 'index.html')
  })

  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

mainline()
