// Modules to control application life and create native browser window
const { app, BrowserWindow } = require('electron')
const { ipcMain } = require('electron')
var x;
var y;

function createWindow () {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 900,
    height: 675,
    webPreferences: {
      nodeIntegration: true
    }
  })

  // Get window location
  winBounds = win.getBounds();
  x = winBounds.x;
  y = winBounds.y;

  // and load the index.html of the app.
  win.loadFile('index.html');

  // Open the DevTools.
  //win.webContents.openDevTools()
}

// Create an interprocess communications listener to run recipeScraperInsert.php ...
// ... in a new window on request by the renderer process
ipcMain.on('invoke-insert', (event, arg) => {
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
  winInsert.on("closed", _ => {
    console.log("Insert window closed");
    // Let renderer.js process know
    event.reply('insert-closed', 'closed')
  });
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

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