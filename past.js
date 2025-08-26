// This module executes the 'past' mode of the recipe-scraper application. Index.js issues
//  require for this module.

// Context-isolation version 1.0

// Code structure:
//
//  ipcMain.on('process-year')

// Program flow:
//
//  Listen for a 'process-year' message from past-renderer.js
//    Send a 'change-start' message to past-renderer.js to disable the Start button
//    Call NewDays
//    Call Insert

const fs = require('fs') // Filesystem functions
const { NewDays } = require('./lib.js') // Functions shared with current-renderer.js
const { ipcMain } = require('electron') // Interprocess communications

ipcMain.on('process-year', async (event, enteredYear) => {
  console.log('past.js - year: ' + enteredYear)

  const tablePath = '/Users/rahiggins/Sites/NYT Recipes/' + enteredYear + '/index.html'
  if (!fs.existsSync(tablePath)) {
    global.win.webContents.send('display-msg', tablePath + ' not found')
    global.win.webContents.send('change-start', 'enable')
    return
  }
  global.win.webContents.send('change-start', 'disabled') // Disable the button
  global.win.webContents.send('display-msg', 'New and updated days:')

  // Call NewDays to identify new and changed days and update the local and remote databases
  await NewDays(enteredYear)
})
