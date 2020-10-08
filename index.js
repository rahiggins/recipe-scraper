// Modules to control application life and create native browser window

// This module:
//  - creates IPC listeners
//   -- to open developer tools (tools)
//   -- to create a browser window and load either current.html or past.html (mode)
//   -- to create a browser window and load an NYT article (article-click)
//   -- to invoke insert.php to update the local database (invoke-insert)
//  - creates a browser window and loads index.html into it

const { app, BrowserWindow } = require('electron')
const { ipcMain } = require('electron')

var win;
var x;
var y;
var xArt;
var yArt;
var articleWindows = [];  // Array of article window IDs

function createWindow(xpos, ypos, wattr, hattr, load) {
  // Create the main browser window.
    win = new BrowserWindow({
        x: xpos,
        y: ypos,
        width: wattr,
        //width: 1500,  // for devTools
        height: hattr,
        webPreferences: {
          nodeIntegration: true
        }
    })

  // and load the index.html of the app.
  win.loadFile(load);

  // Open the DevTools.
  //win.webContents.openDevTools()

}

// Create an interprocess communications listener to open devtools to display error logging
ipcMain.on('tools', () => {
  win.webContents.openDevTools();
})

// Create an interprocess communications listener to process the
//  'current'/'past' selection on index.html
ipcMain.on('mode', (event, arg) => {
    console.log("index.js - mode: arg: " + arg);
    if (arg == 'current') {
        win.close();
        createWindow(29, 46, 900, 675, 'current.html')
    } else if (arg == 'past') {
        win.close();
        createWindow(29, 46, 600, 450, 'past.html')
    } else {
        console.log("Unexpected mode: " + arg)
    }
  })

// Create an interprocess communications listener to open articles
//  in a new window on request by the renderer process
ipcMain.on('article-click', (event, action, url) => {
  // console.log("article-click: " + event + ", " + action + ", " + url);
  if (action == "click") {
    // Create an article BrowserWindow
    let winArticle = new BrowserWindow({
      width: 900,
      height: 600,
      x: xArt, // position relative to win BrowserWindow
      y: yArt,
      webPreferences: {
        nodeIntegration: true
      }
    })
    articleWindows.push(winArticle.id); // Record window ID for close later
    winArticle.loadURL(url);  // load article
    xArt += 21;               // Offset the next article window to the right and down
    yArt += 21;

  } else if (action == "close") {
    // Close all article windows

    for (let w = 0; w < articleWindows.length; w++) {
      let windowToClose = BrowserWindow.fromId(articleWindows[w]);
      if (windowToClose !== null) { // If not already closed, ...
        windowToClose.close();
      }
    }

    articleWindows = [];  // Empty article window ID array
  }
})

// Create an interprocess communications listener to run recipeScraperInsert.php ...
// ... in a new window on request by the renderer process
ipcMain.on('invoke-insert', (event) => {
  // Create winInsert BrowserWindow
  const winInsert = new BrowserWindow({
    width: 500,
    height: 300,
    x: x+200, // position relative to win BrowserWindow
    y: y+300,
    webPreferences: {
      nodeIntegration: true
    }
  })
  // Run recipeScraperInsert.php to update local MySQL database
  winInsert.loadURL('http://localhost:8888/recipeScraperInsert.php');

  // Listen for winInsert window close
  winInsert.on("closed", () => {
    console.log("Insert window closed");
    // Let renderer.js process know
    event.reply('insert-closed', 'closed')
  });
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

// Create initial window
app.whenReady().then(() => {
    createWindow(29, 46, 450, 340, 'index.html');
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.