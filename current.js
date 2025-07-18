// This module executes the 'current' mode of the recipe-scraper application.  Index.js issues
//  require for this module.

// recipe-scraper (current) remembers the last date processed and displays subsequent dates that have not yet been processed as links. It also offers a date picker to reprocess prior dates.

// When a not yet processed date link is clicked, the application launches a Chrome instance to display the day's Today's Paper page. When subsequent date links are clicked,  the Today's Paper page is opened in a new tab in the previously launched Chrome instance.

// The application works with Tampermonkey userscripts (tpScrap and Scrape), installed in the launched Chrome instance.  Userscript tpScrape is invokfrom a Tampermonkey menu command and scrapes the food section (Food or Magazine) of the Today's Paper page for article titles, authors and URLs. Userscript Scrape scrapes opened articles for recipes. The userscripts send their results to the recipe-scraper application via HTTP.

// The recipe-scraper application formats the information sent by the userscripts as table HTML. It displays the table entries for review and editing. It then adds the entries to the year's index.html file. It also adds the day's entries to the local NYTArticles dagtabase and creates SQL statements to add the entries to the remote NYTArticles database.

// manual click version 3.2.0

// Code structure:
//
//  Global variable definitions
//  Global function definition
//    function Log
//    function connectPup
//    function getEpoch
//
//  function requestListener
//    function addArticles
//    function artInfo
//
//  function review
//    function receiveRow
//    ipcMain.once('cancel')
//    ipcMain.on('send-row'
//    ipcMain.once('save')
//    new BrowserWindow()
//
//  function updateIndexHTML
//
//  function processNewDays
//    ipcMain.once('continue')
//      calls NewDays
//
//  function checkExisting
//
//  function dayCompare
//    function rowsText
//    function createButton
//      ipcMain.once('created')
//      global.win.webContents.send('create-button')
//    function getAction
//      ipcMain.once('button-action')
//      global.win.webContents.send('enable-action-buttons')
//
//  function Mainline
//    http.createServer
//    server.listen
//    ipcMain.on('review')
//    ipcMain.on('openTP')
//    ipcMain.on('process-date')
//    ipcMain.on('AOT')
//    new BrowserWindow()
//
//   app.on('will-quit')

// Program flow:
//
//   Mainline
//    Call getEpoch
//    Start HTTP server
//    Listen for HTTP POST requests
//      On POST with ID articleInfo (sent by userscript Scrape):
//        - Call addArticles
//    Create the mainWindow Browser window
//    On 'review':
//      Call review
//        On 'send-row'
//          Call receiveRow
//      Call checkExisting
//      Call dayCompare
//        Call createButton
//        Send 'display-tableCompare' message to current-renderer.js
//        Send 'enable-action-buttons' message to current-renderer.js
//        Call getAction
//      Call updateIndexHTML
//      Send 'add-continue' message to current-renderer.js
//      Call processNewDays
//          Call NewDays
//      Call Insert
//    On 'tpOpen'
//      Spawn 'open -a "Google Chrome"
//    On 'process-date'
//      Call getEpoch
//      Spawn 'open -a "Google Chrome"
//    On 'AOT'
//      Set window 'always on top' property

// Data structures
//
// artObj { // Created by the tpScrape userscript
//  tpTitle: string,
//  author: string,
//  tpHref: string,
//  index: number,
// }
//
// articleArray object { sent via HTTP POST by the tpScrape userscript
//  ID: 'articleArray',
//  url: string,
//  sectionName: string,
//  articles: [artObj, artObj, ..., artObj]
// }
//
// recipeObj { created by the Scrape userscript
//  name: string,
//  link: string,
//  inconsistency: boolean
// }
//
// artInfo { sent via HTTP POST be the Scrape userscript
//  ID: 'artInfo',
//  hasRecipes: boolean,
//  recipeList: [recipeObj, recipeObj, ..., recipeObj],
//  titleInfo: {
//                title: string,
//                arttype: string,
//                ATDpresent: string
//  },
//  url: string
// }
//
// Key:value pairs in the corresponding artObj object are added to the artInfo object in the requestListener function.
//
// tableRowsArray [[date Obj, type Obj, name Obj], ...]  Returned by function review
// Obj {
//  content: string,
//  classList: string
// }
//

const { tableText, formatHTML, NewDays, Insert } = require('./lib.js') // Shared scraper functions
const { app, ipcMain, BrowserWindow } = require('electron') // InterProcess Communications
const path = require('path')
const Moment = require('moment') // Date/time functions
const fs = require('fs') // Filesystem functions
const cheerio = require('cheerio') // core jQuery
const http = require('http') // HTTP protocol
const { spawn } = require('node:child_process') // Execute shell commands

const tmrrw = Moment()
tmrrw.add(1, 'days')
const tomorrow = tmrrw.format('YYYY-MM-DD') // used in function getEpoch
const host = 'localhost' // HTTP server host
const port = 8012 // HTTP server port
let tpObjArray // Array of article objects, sent be the Scrape userscript, referenced in function artInfo
let tpURL // URL of Today's Paper food section
let tpDateObj // Moment date derived from tpURL
let articleInfoObjArray // Array of article info objects composed of objects returned by the tpScrape userscript and the Scrape userscript

let newTableHTML = '' // Generated table HTML is appended to this
const NYTRecipesPath = '/Users/rahiggins/Sites/NYT Recipes/'
const $rowTemplate = cheerio.load('<tr><td></td><td></td><td></td></tr>', null, false)

const URLStartCurrent = 'https://www.nytimes.com/issue/todayspaper/' // Today's Paper URL current prefix
const URLStartPast = 'https://www.nytimes.com/indexes/' // Today's Paper URL past prefix
const URLEndCurrent = '/todays-new-york-times' // Today's Paper URL current suffix
const URLEndPast = '/todayspaper/index.html' // Today's Paper URL past suffix
const today = Moment()
let saveLastDate = false // Save LastDate.txt only if datesToProcess were automatically generated
let dateEntered = false // Set to true in 'process-date'

const debug = true
let sect // Magazine | Food
let firstArticle = true // true for first article of a date being processed sent by userscript Scrape

// Function definitions

function Log (text) {
  // If debugging, write text to console.log
  if (debug) {
    console.log(text)
  }
}

function getEpoch (date) {
  // Return the Today's Paper format epoch for the input date
  // Input: Moment() object or string YYYY-MM-DD
  // Output: 0 (S.N.O.), 1, 2 or 3

  // Epochs is an array of dates when the Today's Paper format changed
  const Epochs = ['2006-04-02', // Today's Paper begins with class story divs < epoch 0
    '2010-10-27', // change to columnGroups < epoch 1
    '2017-12-24', // change to <ol> < epoch 2
    tomorrow] // current epoch < epoch 3

  // Ensure the date to test is a YYYY-MM-DD string
  const thisDate = typeof date === 'object' ? date.format('YYYY-MM-DD') : date

  let epoch = 0
  for (const ep of Epochs) {
    // For each element of the Epochs array (an epoch begin date) ...
    if (thisDate < ep) {
      // If the date to process is prior to this begin date,
      //  exit loop
      break
    } else {
      // Increment epoch indicator and repeat
      epoch += 1
    }
  }
  return epoch
}

// Request listener function for the HTTP server
async function requestListener (req, res) {
  // Function definitions
  async function addArticles (artInfoObjString) {
    // Called from function artInfo
    // Input is a stringified article info object recieved from the Scrape userscript
    // Add event listener, wrapped in a Promise, for the 'added' signal from the renderer process.
    // Send the article info object to the renderer process
    // Return Promise to the request listener

    console.log('addArticles: entered')
    return new Promise(function (resolve) {
      ipcMain.once('added', () => {
        console.log('addArticles: resolving')
        resolve() // Resolve Promise
      })

      // Add designated section article checkbox to current.html
      global.win.webContents.send('add-articles', artInfoObjString)
    })
  }

  // Function to process an article info object received from the Scrape userscript
  async function artInfo (postObj) {
    Log('Function artInfo entered for ' + postObj.url)
    res.setHeader('Content-Type', 'application/json')
    res.writeHead(200)
    res.end('{"message": "OK"}')

    // Find the corresponding element of the Today's Paper object array
    // let notMatched = true // Attempt to handle additional articles not on the Today's Paper page
    for (const artObj of tpObjArray) {
      if (artObj.tpHref === postObj.url) {
        // When found, merge the Today's Paper onject keys in the the article info object received from Scrape
        Object.assign(postObj, artObj)
        // If a title could not be found (57 Sandwiches That Define New York City - 6/19/2024), use the article title from the Today's Paper page
        postObj.titleInfo.title = postObj.titleInfo.title || artObj.tpTitle
        // notMatched = false // Attempt to handle additional articles not on the Today's Paper page
        break
      }
    }
    // if (notMatched) { // Attempt to handle additional articles not on the Today's Paper page
    //   postObj.index = nextIndex
    //   nextIndex += 1
    // }
    // Add article info to the articles array ...
    articleInfoObjArray.push(postObj)
    if (firstArticle) {
      firstArticle = false
      global.win.webContents.send('remove-msgs')
      const msg = `${sect} section articles for ${tpDateObj.format('dddd')}, ${tpDateObj.format('MM/DD/YYYY')}`
      global.win.webContents.send('display-msg', msg)
    }
    await addArticles(JSON.stringify(postObj))
  }
  // End of function definitions

  let body = ''
  // let nextIndex // Attempt to handle additional articles not on the Today's Paper page
  // Collect chucnks of the POST data
  req.on('data', function (chunk) {
    body += chunk
  })

  // When all the POST data has beed received ...
  req.on('end', async function () {
    Log('Received POST')
    Log(body)
    const postObj = JSON.parse(body)

    // Process the POST data by ID
    switch (postObj.ID) {
      case 'articleArray':
        // Handle an array of article objects
        tpObjArray = postObj.articles
        // nextIndex = tpObjArray.length // Attempt to handle additional articles not on the Today's Paper page
        tpURL = postObj.url
        tpDateObj = Moment(tpURL.replace(/^.*?(\d{4})\/(\d{2})\/(\d{2}).*$/, '$2/$3/$1'), 'MM/DD/YYYY')
        sect = postObj.sectionName
        articleInfoObjArray = []
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(200)
        res.end('{"message": "OK"}')
        global.win.webContents.send('remove-msgs')
        break

      case 'artInfo':
        // Handle an article info object
        artInfo(postObj)
        break

      default:
        Log('In the object POSTed, the value of the ID key: ' + postObj.ID + ', was not recognized')
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(501)
        res.end(`{"message": "In the object POSTed, the value of the ID key: ${postObj.ID}, was not recognized"}`)
    }
  })
}

function review (checkedArticleIndices) {
  // Display the checked articles and their recipes in a new window for review and editing
  // Called from on.'submitted'
  // Input - the array of checked article indices in the articleInfoObjArray
  // Output - a promise, resolved with an array of table row contents when the Commit button is clicked

  const tableRowsArray = []

  function receiveRow (evt, date, type, name) {
    // Push the row's content onto the output array
    Log('receiveRow entered')
    tableRowsArray.push([date, type, name])
  }

  return new Promise(function (resolve, reject) {
    // The promise is resolved by a click on the Commit button or the Cancel buttton

    ipcMain.once('cancel', () => {
      // When the Cancel button is clicked, the recipe scraper application will be terminated
      reviewWindow.close()
      global.win.webContents.send('remove-msgs')
      global.win.webContents.send('remove-dates')
      global.win.webContents.send('display-msg', 'You cancelled the recipe scrape')
      reject(new Error('Terminated by user')) // Reject Promise
    })

    // For each table row ...
    ipcMain.on('send-row', receiveRow)

    ipcMain.once('save', () => {
      // When the Save button is clicked, clean up and resolve the returned promise
      Log('once.save entered')
      ipcMain.off('send-row', receiveRow)
      reviewWindow.close()
      resolve(tableRowsArray) // Resolve Promise
    })

    global.win.webContents.send('enable-continue')
    console.log('review entered')

    // Display the Review window ...
    const reviewWindow = new BrowserWindow({
      x: global.win.x + 29,
      y: global.win.y + 46,
      width: 1200,
      height: 1000,
      parent: global.win,
      modal: true,
      webPreferences: {
        preload: path.join(__dirname, 'reviewPreload.js')
      }
    })

    // and load the its html file.
    reviewWindow.loadFile('review.html')
    // reviewWindow.show()

    if (checkedArticleIndices.length > 0) {
      // If any articles were checked, send the content for each checked article and its recipes to the renderer process to be displayed as table rows
      const tpDate = tpDateObj.format('MM/DD/YYYY')
      // const tpYear = tpDate.substring(6)
      const inconsistent = '<span class="inconsistent">inconsistent name: </span>'
      let date = `<a href="${tpURL}">${tpDate}</a>`
      let dateClassList = 'date'
      let type = ''
      let typeClassList = 'type'
      let name = ''
      let nameClassList = 'name'
      reviewWindow.webContents.send('add-row', { content: date, classList: dateClassList }, { content: type, classList: typeClassList }, { content: name, classList: nameClassList })
      dateClassList = ''
      typeClassList = ''
      nameClassList = ''
      checkedArticleIndices.forEach((idx) => {
        const artObj = articleInfoObjArray.filter((el) => el.index === idx)[0]
        date = ''
        type = artObj.titleInfo.arttype
        name = `<a href="${artObj.url}">${artObj.titleInfo.title}</a> ${artObj.titleInfo.ATDPresent}`
        reviewWindow.webContents.send('add-row', { content: date, classList: dateClassList }, { content: type, classList: typeClassList }, { content: name, classList: nameClassList })
        for (const recipe of artObj.recipeList) {
          const recipeName = recipe.inconsistency ? inconsistent + recipe.name : recipe.name
          date = ''
          type = 'recipe'
          name = `<a href="${recipe.link}">${recipeName}</a>`
          reviewWindow.webContents.send('add-row', { content: date, classList: dateClassList }, { content: type, classList: typeClassList }, { content: name, classList: nameClassList })
        }
      })
    }
  })
}

function updateIndexHTML (date, year, arg) {
  // Called from Mainline on.'review'
  // Input:  - the date being processed as MM/DD/YYYY
  //         - the year being processed as YYYY
  //         - A Cheerio qery function based on a table of a day's articles and recipes,
  //           or null if there are no recipes for the day
  // Returns: true
  // Replace the day's table rows in ~/Sites/NYT Recipes/yyyy/index.html with the input table rows,
  // or if there are no recipes for the day, remove the day's table rows from index.html

  let doReplacement = true
  let $
  if (arg) {
    // arg is a Cheerio query function
    $ = arg
  } else {
    // arg is null - there are no recipes for the day
    doReplacement = false
  }
  const tablePath = path.join(NYTRecipesPath, year, 'index.html')
  const table = fs.readFileSync(tablePath, 'UTF-8').toString() // Read year page

  // Load the year's table into Cheerio
  const $year = cheerio.load(table)
  $year.prototype.tableText = tableText

  // Find the row corresponding to the input date - the target row
  const trs = $year('tr')
  const targetRow = trs.filter((i, tr) => {
    return $year('td', tr).eq(0).text().trim() === date
  })
  if (targetRow.length > 0) {
    // If the target row was found, replace (or remove) it
    targetRow.attr('data-replace', 'true') // Mark the target row for replacement or removal
    let nextRow = targetRow.next()
    while (nextRow && $year('td', nextRow).eq(0).text().trim() === '') {
      // Remove rows following the target row until the next date row
      nextRow.remove()
      nextRow = targetRow.next()
    }

    if (doReplacement) {
      // Replace the target row in the year's table with the input table rows
      $year('tr[data-replace]').replaceWith($('table').formatHTML($))
    } else {
      // Or remove the target row because there are no recipes for the day
      $year('tr[data-replace]').remove()
    }

    // Write the updated table back to disk
    const yearHTML = $year.html() // .replaceWith() and/or .remove() seem to leave HTML fragments; fix them
      .replace(/(\n) {15,}(<tr>)/, '$1              $2') // Enforce 14 spaces from newline to <tr>
      .replace(/\n +(\n +)/, '$1') // Replace 2 newlines with 1 newline, the second one
    fs.writeFileSync(tablePath, yearHTML, 'utf8')
  } else {
    console.log('No row found for ' + date)
  }
  return true
}

async function processNewDays (yyyy) {
  // Called from Mainline
  // Input: year being processed - yyyy
  // Listen for click on "Continue" button
  //  Call NewDays(yyyy) to extract new and updated days' table rows from /NYT Recipes/yyyy/index.html

  console.log('processNewDays: entered')
  return new Promise(function (resolve) {
    ipcMain.once('continue', () => {
      NewDays(yyyy)
      resolve() // Resolve Promise
    })
    global.win.webContents.send('enable-continue')
  })
}

function checkExisting (date) {
  // See if table HTML for the input date already exists in
  //  NYTRecipesPath + YYYY + '/Days/YYYY-MM-DD.txt'
  // Input: the date under consideration in MM/DD/YYYY format
  // Output: {
  //           exists: boolean,
  //           existingHTML: string
  //         }
  console.log('checkExisting entered, date: ' + date)

  const yyyy = date.substring(6)
  const dashesYMD = date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2')
  const dayPath = path.join(NYTRecipesPath, yyyy, 'Days', dashesYMD + '.txt')
  Log('dayPath: ' + dayPath)
  const dayExists = fs.existsSync(dayPath)
  Log('dayExists: ' + dayExists)
  // let differs
  let existingTableHTML = null
  if (dayExists) {
    existingTableHTML = fs.readFileSync(dayPath, 'UTF-8').toString()
  }

  return {
    exists: dayExists,
    existingHTML: existingTableHTML
  }
}

async function dayCompare (new$, old$) {
  // Called from on.review when the date picker was used to specify a date to process.
  // Compare two collections of table rows, one (new), possibly a transformation
  //  (by adding and deleting rows), of the other (old).
  // Identify the rows added and the rows deleted and display the results of the comparison.
  // If there are differences between the two collections, offer the following actions to be taken:
  // - Discard the new collection
  // - Replace the old collection with the new one
  // - Merge the rows of the two collections and replace the old collection with the merged one
  // Input: new$ - a Cheerion query function based on the current scrape of the a day's articles
  //        old$ - a Cheerion query function based on the day's HTML stored in the Days folder
  // Output: an object with keys:
  //         action - the action requested
  //         mergedRows - If Merge was requested, a Cheerio query function based on the merged rows of the new and old collections, otherwise null

  Log('function dayCompare entered')

  const addColor = '#e7fcd7' // light green - background color for added rows
  const delColor = '#fce3e3' // light red - background color for missing rows
  const test = false
  const debug = true

  function createButton (id, text) {
    // Create a tableCompare action button
    // Input:   button element id
    //          button value and name
    // Output:  a promise resolved when the renderer process has created the button
    Log('Creating action button ' + text)
    return new Promise(function (resolve) {
      ipcMain.once('created', () => {
        Log('create-button resolving')
        resolve()
      })
      global.win.webContents.send('create-button', id, text)
    })
  }

  function getAction () {
    // Enable the tableCompare action buttons and handle an action button click
    // Output:  a promise, resolved when an action button is clicked,
    //          with the name of the action button clicked
    return new Promise(function (resolve) {
      ipcMain.once('button-action', (event, action) => {
        Log('button-action resolving with ' + action)
        resolve(action)
      })
      global.win.webContents.send('enable-action-buttons')
    })
  }

  // For the old collection, create an iterable Cheerio object of the table rows
  const oldRows = old$('tr')

  // Create an array (oldRowsText) of each old table row's text
  const oldRowsText = []
  oldRows.each((i, tr) => oldRowsText.push(old$('td', tr).tableText(old$)))

  // For the new collection, create an iterable Cheerio object of the table rows
  const newRows = new$('tr')

  // Create an array (newRowsText) of each new table row's text
  const newRowsText = []
  newRows.each((i, tr) => newRowsText.push(new$('td', tr).tableText(new$)))

  // Make a copy of the new collection.  Rows from the old collection that are missing from the new one will be merged into this copy.
  const merge$ = cheerio.load('<table></table')
  merge$.prototype.formatHTML = formatHTML
  merge$(new$('table').formatHTML(new$)).appendTo('table')

  // Uncomment the following 3 rows to test
  // newRowsText = ["r", "a", "b", "c", "z", "d", "e", "f", "g", "h", "w", "i", "j", "k", "l", "m", "u" ];
  // oldRowsText = ["s", "t", "a", "c", "b", "d", "e", "f", "y", "x", "g", "h", "i", "j", "k", "v", "l", "m", "p", "q" ];
  // test = true

  // Create an array (newInNew) whose elements are the index of each
  //  new collection row not found in the old collection.
  const newInNew = []

  // Compare each new row text (the elements of newRowsText) to the text of the old
  //  rows (elements of oldRowsText).
  // If the new row's text is not found, add that row's index to the newInNew array
  // Test output - newInNew array: [0,4,10,16]

  for (let n = 0; n < newRowsText.length; n++) {
    // For each row in the new collection...
    let notFound = true // Not found yet
    for (let o = 0; o < oldRowsText.length; o++) {
      // ... look for its text in the old collection
      if (newRowsText[n] === oldRowsText[o]) {
        // If found, move on to the next new row
        notFound = false // It has been found ...
        break // ... so break out of the old rows loop
      }
    }
    if (notFound) {
      // If not found, add the added row's index to the newInNew array
      newInNew.push(n)
    }
  }

  // Create an array (oldInNew) consisting of the index of each old row in the new row collection.
  const oldInNew = []

  // Compare each old row text (the elements of oldRowsText) to the new rows text
  //  (elements of newRowsText)
  // If the old row's text is found, add its index in the new rows array to oldInNew.
  // If the old row's text is not found, add -1 to oldInNew.
  // Test output - oldInNew: [-1,-1,1,3,2,5,6,7,-1,-1,8,9,11,12,13,-1,14,15,-1,-1]

  for (let o = 0; o < oldRowsText.length; o++) {
    // For each row in the old collection...
    let notFound = true // Not found yet
    for (let n = 0; n < newRowsText.length; n++) {
      // ... look for its text in the new collection
      if (oldRowsText[o] === newRowsText[n]) {
        // If found, add its index in the new collection to the oldInNew array.
        oldInNew.push(n)
        notFound = false // The row has been found ...
        break // ... so break out of the new rows loop
      }
    }
    if (notFound) {
      // If not found, indicate that by adding -1 to the oldInNew array
      oldInNew.push(-1)
    }
  }

  Log('oldInNew: ' + oldInNew, debug)
  Log('newInNew array: ' + newInNew, debug)

  // Create an array (oldInOld) consisting of the indices of rows in the oldInNew
  //  array that don't exist in the new collection (i.e. oldInNew elements equal
  //  to -1).
  const oldInOld = []

  // Search backwards through the oldInNew array looking for -1 elements.
  //
  // The search is backwards so that the old collection rows deleted from the
  //  new collection can be inserted into the new collection from back to front,
  //  obviating adjustment of the insertion point of subsequent rows.
  //
  // Add the index of each -1 element to the oldInOld array
  // Test output - oldInOld array: [19,18,15,9,8,1,0]

  // Start the backwards search from this element, initially the last element
  //  of the oldInNew array
  let from = oldInNew.length - 1

  // Index of a -1 element
  let oldInOldIndex

  do {
    // Starting from the last element of oldInNew, find a prior -1 element, indicating an old row
    //  missing from the new collection

    oldInOldIndex = oldInNew.lastIndexOf(-1, from) // returns -1 if not found
    Log('oldINOld loop after lastInexOf: oldInOldIndex: ' + oldInOldIndex.toString() + ' from: ' + from.toString(), debug)
    if (oldInOldIndex >= 0) {
      // If a -1 element was found, add its index to the oldInOld array
      oldInOld.push(oldInOldIndex)
      Log('Pushed: ' + oldInOldIndex.toString(), debug)
    }

    // If a -1 element was found, start the next search from the
    //  preceeding element; if no such element was found, 'from' is set to -2
    //  resulting in exit from the loop
    from = oldInOldIndex - 1
    Log('oldINOld loop after from update: oldInOldIndex: ' + oldInOldIndex.toString() + ' from: ' + from.toString(), debug)

    // Repeat the search while 'from' is within the oldInNew array
  } while (from >= 0)

  Log('After oldInOld loop: oldInOldIndex: ' + oldInOldIndex.toString(), debug)
  Log('oldInOld array: ' + oldInOld, debug)

  // For each newInNew element (an added table row in newRowsArray),
  //  modify the table row in the merge collection to set its background color to 'added'.
  newInNew.forEach((el) => {
    merge$('tr').eq(el).css('background-color', addColor)
  })

  // For each oldInOld element (a table row in the old collection not present in the
  //  new collection), copy the corresponding old collection row to the appropriate position
  //  in the merge collection and set its background color to 'deleted'
  // The appropriate position in merge collection) is determined by iterating backwards
  //  through the oldInNew array from the position of the oldInOld element under consideration
  //  until a positive oldInNew element is found. The value of this positive oldInNew element
  //  is the position in merge collection of the first table row, preceeding the
  //  oldInOld element under consideration, that exists in both old collection and the new
  //  collection. The oldInOld element under consideration should be inserted into the merge
  //  collection after this row common to both new and old arrays.
  Log('oldInOld loop', debug)
  oldInOld.forEach((el) => {
    // For each oldInOld element (an index in the oldInNew array) ...
    Log('el: ' + el.toString(), debug)

    // ... examine the oldInNew array elements preceeding that index ...
    let prevEl = el - 1

    // ... within the oldInNew array (prevEl > -1)
    //  until a non-negative element is found
    while (prevEl > -1 && oldInNew[prevEl] < 0) {
      prevEl--
    }

    if (prevEl < 0) {
      // If a non-negative element is not found ...
      Log('Prepend el: ' + el.toString(), debug)

      // Prepend the old collection row to the merge collection
      merge$('table').prepend(old$('tr').eq(el).clone().css('background-color', delColor))
    } else {
      // Otherwise, if a non-negative element (that is, a row that exists
      //  in both the old and new collections was found ...

      // ... the place in the merge collection to insert the 'deleted' row is
      //  after that common row.
      const insertion = oldInNew[prevEl] + 1
      Log('Add ' + el.toString() + ' at: ' + insertion.toString(), debug)

      // Insert the oldRowsArray elment into the new collection
      merge$('tr').eq(insertion - 1).after(old$('tr').eq(el).clone().css('background-color', delColor))
    }
  })

  Log('oldRowsText: ' + oldRowsText, debug)
  Log('newRowsText: ' + newRowsText, debug)

  Log('Added rows: ' + newInNew.length.toString(), debug)
  Log('Deleted rows: ' + oldInOld.length.toString(), debug)

  // added is true if the new collection contains added rows
  const added = newInNew.length > 0

  // deleted is true if the old collection contains rows missing from the new one
  const deleted = oldInOld.length > 0

  if (test) {
    return
  }

  if (added && deleted) {
    // If there are both added and missing rows in the new collection,
    //  display a button to replace the existing table HTML with the
    //  union of the added and existing rows, i.e. add the added rows and
    //  retain the missing rows
    await createButton('mergeBtn', 'Merge')
  }
  if (added || deleted) {
    // If there are added rows or missing rows in the new collection,
    //  display a button to discard the new table HTML
    await createButton('replaceBtn', 'Replace')
    await createButton('discardBtn', 'Discard')
    const msg = 'Existing table rows differ from the selected rows'
    global.win.webContents.send('display-msg', msg)
  }

  // Name of button clicked (action selected)
  //  or "None" if the new and old table HTML are equivalent
  let buttonClicked

  if (added || deleted) {
    // If there are either added rows or missing rows in the new table HTML,
    //  display a table identifying the added and missing rows by background
    //  color

    // Display the table
    global.win.webContents.send('display-tableCompare', merge$('table').html())

    // Enable action buttons
    global.win.webContents.send('enable-action-buttons')
    // Wait for a button to be clicked
    buttonClicked = await getAction()
  } else {
    // If the new table HTML has neither added nor missing rows, return "None"
    buttonClicked = 'None'
  }

  Log('Button clicked: ' + buttonClicked, debug)

  // Return an object that specifies the action selected (Replace, Merge, Discard or
  //  None).  In the case of Merge, the returned object also contains the merged
  //  table HTML.
  let returnObj
  if (buttonClicked === 'Merge') {
    // Remove background colors from the merge collection
    merge$('tr').each((i, tr) => {
      merge$(tr).removeAttr('style').prop('outerHTML')
    })
    // Return the selected action and the merged collection
    returnObj = {
      action: buttonClicked,
      mergedRows: merge$
    }
  } else {
    // If not Merge, return the action selected and null for the merged collection
    returnObj = {
      action: buttonClicked,
      mergedRows: null
    }
  }
  return returnObj
}

// Mainline function
async function Mainline () {
  console.log('Entered Mainline')

  // Construct path to last-date-processed file
  const lastDateFile = path.join(app.getPath('appData'), app.getName(), 'LastDate.txt')
  console.log('lastDateFile: ' + lastDateFile)

  // See if there are new dates to process
  const datesToProcess = [] // Array of Moment dates
  const displayDates = [] // Array of <li><a> elements
  const lastDate = Moment(fs.readFileSync(lastDateFile, 'utf8'), 'MM-DD-YYYY') // last date processed
  const maxPickableDate = lastDate.format('YYYY-MM-DD')
  let bumps
  if (lastDate.day() === 0) { // If last was Sunday,
    bumps = [3, 4] //  next is Wednesday (+3), then Sunday (+4)
  } else { // If last was Wednesday,
    bumps = [4, 3] //  next is Sunday (+4), then Wednesday (+3)
  }
  const swtch = [1, 0] // bumps toggle
  let s = 0 // Start with the index of the first bump
  let nextDate = lastDate.add(bumps[s], 'days') // nextDate after LastDate processed
  while (nextDate <= today) {
    datesToProcess.push(Moment(nextDate)) // Moment() clones nextDate
    const epoch = getEpoch(nextDate)

    // MDY = nextDate.format('MM/DD/YYYY')
    const YMD = nextDate.format('YYYY/MM/DD')
    // Day = nextDate.format('dddd')
    let url // URL of the Today's Paper page

    // Set Today's Paper URL according to epoch
    switch (epoch === 3) {
      case true: // Current epoch
        url = `${URLStartCurrent}${YMD}${URLEndCurrent}`
        break

      case false: // Prior epochs
        url = `${URLStartPast}${YMD}${URLEndPast}`
        break
    }

    // Add HTML for a listitem containing a link to the Today's Paper page to the displayDates array
    const dateA = `<li><a href="${url}">${nextDate.format('ddd, MMM DD')}</a></li>`
    displayDates.push(dateA)

    s = swtch[s] // use the index for the other bump for the next date
    nextDate = nextDate.add(bumps[s], 'days') // Increment nextDate
  }

  // Create an HTTP server to receive POST requests from the tpScrape and Scrape userscripts
  const server = http.createServer(requestListener)
  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`)
  })

  ipcMain.on('review', async (evt, checkedArticleIndicesString) => {
    // When the 'Review' button is clicked, ...
    const checkedArticleIndices = JSON.parse(checkedArticleIndicesString)
    Log('checkedArticleIndices: ' + checkedArticleIndices)

    const tpDate = tpDateObj.format('MM/DD/YYYY')
    const tpYear = tpDate.substring(6)
    const exportValues = true // Export values returned from the review window
    let tableRowInfo // Export file stream

    if (checkedArticleIndices.length > 0) {
      // If any articles were checked, create table HTML for the date being processed
      // Display the content of checked articles and their recipes in a new window for review
      const tableRowsArray = await review(checkedArticleIndices)

      if (exportValues) {
        // Write article/recipe content to disk
        const tableRowInfoFile = path.join(app.getPath('appData'), app.getName(), `tableRowInfo${tpDateObj.format('-YYYY-MM-DD')}.txt`)
        tableRowInfo = fs.createWriteStream(tableRowInfoFile)
      }

      // Create a Cheerio query functon based on a table and append the table rows returned from the review window to it
      let $newDay = cheerio.load('<table></table>')
      $newDay.prototype.tableText = tableText
      $newDay.prototype.formatHTML = formatHTML
      let $existingDay
      for (const row of tableRowsArray) {
        if (exportValues) {
          tableRowInfo.write(JSON.stringify(row) + '\n')
        }
        const [date, type, name] = row
        const rowClone = $rowTemplate('tr').clone()
        const tds = $rowTemplate('td', rowClone)
        $rowTemplate(tds[0]).addClass(date.classList)
        $rowTemplate(tds[0]).html(date.content)
        $rowTemplate(tds[1]).addClass(type.classList)
        $rowTemplate(tds[1]).text(type.content)
        $rowTemplate(tds[2]).addClass(name.classList)
        $rowTemplate(tds[2]).html(name.content)
        $newDay('table').append(rowClone)
      }
      if (exportValues) {
        tableRowInfo.close()
        console.log('Created HTML for ' + tpDate)
      }

      // If a date was entered and table HTML for that date already exists, compare the two HTMLs
      let checkExistingResult
      let compareResult
      let msg
      if (dateEntered) {
        checkExistingResult = checkExisting(tpDate)
        if (checkExistingResult.exists) {
          // Create a Cheerio query function based on the existing table rows
          $existingDay = cheerio.load('<table>' + checkExistingResult.existingHTML + '</table>')
          $existingDay.prototype.tableText = tableText
          $existingDay.prototype.formatHTML = formatHTML

          // Compare the new table rows to the existing rows
          compareResult = await dayCompare($newDay, $existingDay)
          Log('Action returned: ' + compareResult.action)
        }
      }

      let updateHTML = true
      if (dateEntered && checkExistingResult.exists) {
        console.log('Date was entered and has existing table HTML')
        console.log('Action: ' + compareResult.action)

        switch (compareResult.action) {
          case 'None':
            msg = 'An identical set of table rows already exists'
            global.win.webContents.send('display-msg', msg)
            updateHTML = false
            newTableHTML = '' // Reset newTableHTML
            break

          case 'Discard':
            global.win.webContents.send('remove-lastMsg')
            msg = 'Changes discarded, existing table rows retained'
            global.win.webContents.send('display-msg', msg)
            updateHTML = false
            newTableHTML = '' // Reset newTableHTML
            break

          case 'Replace':
            global.win.webContents.send('remove-lastMsg')
            break

          case 'Merge':
            global.win.webContents.send('remove-lastMsg')
            $newDay = compareResult.mergedRows
            break

          default:
            break
        }
      }

      if (updateHTML) {
        newTableHTML = $newDay('table').formatHTML($newDay)
        console.log('newTableHTML:')
        console.log(newTableHTML)
        if (updateIndexHTML(tpDate, tpYear, $newDay)) {
          console.log('Mainline: index.html updated')
          newTableHTML = '' // Reset newTableHTML

          // Add "Review ..." message and a 'Continue' submit button to index.html
          global.win.webContents.send('remove-msgs')
          global.win.webContents.send('add-continue')

          // Call processNewDays to wait for 'Continue' submitted, and then look for new and changed days
          console.log('Mainline: awaiting processNewDays')
          await processNewDays(tpYear)
          console.log('Mainline: returned from processNewDays')

          // Call Insert to insert/update new and changed days in local database
          Insert()
        } else {
          console.error('Mainline: problem updating index.html')
          console.error('newTableHTML:')
          console.error(newTableHTML)
          msg = 'Problem updating index.html — see console log'
          global.win.webContents.send('display-msg', msg)
          global.win.webContents.openDevTools() // Open Developer Tools; displays error logging
        }
      }
    } else {
      // No articles were checked, remove rows in index.html for the date being processed
      updateIndexHTML(tpDate, tpYear, null)
      global.win.webContents.send('remove-msgs')
      const msg = `No articles were selected; existing table rows for ${tpDate} (if any) were removed`
      global.win.webContents.send('display-msg', msg)
    }

    // Store LastDate processed and tell the renderer process to update the max pickable date
    if (saveLastDate) {
      fs.writeFileSync(lastDateFile, tpDate, 'utf8')
      global.win.webContents.send('update-maxdate', tpDate.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2'))
      saveLastDate = false
    }
  })

  ipcMain.on('openTP', (evt, url) => {
    // When a Today's Paper page link is clicked, open the page in Google Chrome
    console.log('openTP: ' + url)
    const subp = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--no-first-run', '--no-default-browser-check', '--user-data-dir=/Users/rahiggins/Library/Application Support/Google/Chrome/Remote', '--remote-debugging-port=9222', url], {
      detached: true,
      stdio: 'ignore'
    })
    subp.unref()
    firstArticle = true // The next artInfo object received will be the first article
    dateEntered = false // The date was not selected from the date picker
    saveLastDate = true // Save the date as the last date processed
  })

  ipcMain.on('process-date', async (event, enteredDate) => {
    // When a date is selected from the date picker, ...
    console.log('current.js - date: ' + enteredDate)
    const dateToProcess = Moment(enteredDate, 'YYYY-MM-DD')
    dateEntered = true
    firstArticle = true

    const epoch = getEpoch(dateToProcess)

    // MDY = dateToProcess.format('MM/DD/YYYY')
    const YMD = dateToProcess.format('YYYY/MM/DD')
    // Day = dateToProcess.format('dddd')
    let url

    // Set Today's Paper URL according to epoch
    switch (epoch === 3) {
      case true: // Current epoch
        url = `${URLStartCurrent}${YMD}${URLEndCurrent}`
        break

      case false: // Prior epochs
        url = `${URLStartPast}${YMD}${URLEndPast}`
        break
    }
    console.log('process-date: ' + url)

    // Open the selected date's Today's Paper page in  Google Chrome
    const subp = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--no-first-run', '--no-default-browser-check', '--user-data-dir=/Users/rahiggins/Library/Application Support/Google/Chrome/Remote', '--remote-debugging-port=9222', url], {
      detached: true,
      stdio: 'ignore'
    })
    subp.unref()
  })

  ipcMain.on('AOT', (event, arg) => {
    // Set or unset the window's Always On Top property
    Log('AOT entered with ' + arg)
    global.win.setAlwaysOnTop(arg)
  })

  // Create the browser window, passing the dates to process array and the last processed date to preload.js
  global.win = new BrowserWindow({
    x: 29,
    y: 46,
    width: 900,
    // width: 1500,  // for devTools
    height: 675,
    webPreferences: {
      additionalArguments: [`--datesToProcess=${JSON.stringify(displayDates)}`, `--maxPickableDate=${maxPickableDate}`],
      preload: path.join(__dirname, 'current-preload.js')
    }
  })

  // Get window location
  const winBounds = global.win.getBounds()
  global.x = winBounds.x
  global.y = winBounds.y
  // xArt = global.x + 400 // Offsets for article windows relative to current.html window
  // yArt = global.y + 15

  // and load the specified html file.
  global.win.loadFile('current.html')

  // Open the DevTools.
  // win.webContents.openDevTools()
  // }
}

// End of function definitions

Mainline() // Launch puppeteer, start HTTP server add event listener for Start button
