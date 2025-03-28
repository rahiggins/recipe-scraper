// This module executes the 'current' mode of the recipe-scraper application.  Index.js issues
//  require for this module.

// recipe-scraper (current) remembers the last date processed and displays subsequent dates that have not yet been processed as links. It also offers a date picker to reprocess prior dates.

// When a not yet processed date link is clicked, the application launches a Chrome instance to display the day's Today's Paper page. When subsequent date links are clicked,  the Today's Paper page is opened in a new tab in the previously launched Chrome instance.

// The application works with Tampermonkey userscripts (tpScrap and Scrape), installed in the launched Chrome instance.  Userscript tpScrape is invokfrom a Tampermonkey menu command and scrapes the food section (Food or Magazine) of the Today's Paper page for article titles, authors and URLs. Userscript Scrape scrapes opened articles for recipes. The userscripts send their results to the recipe-scraper application via HTTP.

// The recipe-scraper application formats the information sent by the userscripts as table HTML. It displays the table entries for editing and then adds the entries to the year's index.html file. It also adds the day's entries to the local NYTArticles dagtabase and creates SQL statements to add the entries to the remote NYTArticles database.

// manual click version 3.0.0

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
//    ipcMain.on('submitted'
//    ipcMain.on('openTP'
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
//    On 'submitted':
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

const { NewDays, Insert } = require('./lib.js') // Shared scraper functions
const { app, ipcMain, BrowserWindow } = require('electron') // InterProcess Communications
const path = require('path')
const Moment = require('moment') // Date/time functions
const fs = require('fs') // Filesystem functions
const puppeteer = require('puppeteer') // Chrome API
const needle = require('needle') // Lightweight HTTP client
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

const URLStartCurrent = 'https://www.nytimes.com/issue/todayspaper/' // Today's Paper URL current prefix
const URLStartPast = 'https://www.nytimes.com/indexes/' // Today's Paper URL past prefix
const URLEndCurrent = '/todays-new-york-times' // Today's Paper URL current suffix
const URLEndPast = '/todayspaper/index.html' // Today's Paper URL past suffix
const today = Moment()
let saveLastDate = false // Save LastDate.txt only if datesToProcess were automatically generated
let dateEntered = false // Set to true in 'process-date'

const debug = true
let sect // Magazine | Food
let browser // Puppeteer browser
let page // Puppeteer page
let firstArticle = true // true for first article of a date being processed sent by userscript Scrape

let captchaDisplayed = false
let pages // Puppeteer pages when captcha is displayed

// Function definitions

function Log (text) {
  // If debugging, write text to console.log
  if (debug) {
    console.log(text)
  }
}

async function connectPup () {
  // Connect Puppeteer to an existing instance of Chrome that is logged in
  //  to nytimes.com and create a new page
  // Called from createWindow in Mainline

  console.log('connectPup: entered')

  // If already connected to Chrome, just exit
  if (typeof browser !== 'undefined') {
    if (browser.isConnected()) {
      console.log('Already connected')
      return 0
    }
  }

  // Try to obtain the remote-debugging Chrome endpoint.  If successful, connect
  //  puppeteer to the remote-debugging instance of Chrome, create a new page
  //  and return 0. If unsuccessful, return -1, terminating the application.
  const url = 'http://127.0.0.1:9222/json/version'
  try {
    const resp = await needle('get', url)
    Log(resp.body.webSocketDebuggerUrl)
    browser = await puppeteer.connect({
      browserWSEndpoint: resp.body.webSocketDebuggerUrl
    })

    console.log('connectPup: exiting')
    return 0
  } catch (e) {
    console.error('Unable to obtain webSocketDebuggerUrl: ' + e.code)
    return -1
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
    for (const artObj of tpObjArray) {
      if (artObj.tpHref === postObj.url) {
        // When found, merge the Today's Paper onject keys in the the article info object received from Scrape
        Object.assign(postObj, artObj)
        // If a title could not be found (57 Sandwiches That Define New York City - 6/19/2024), use the article title from the Today's Paper page
        postObj.titleInfo.title = postObj.titleInfo.title || artObj.tpTitle
        break
      }
    }
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
        if (captchaDisplayed) {
          // If a captcha was previously displayed, remove the 'catcha displayed' message
          global.win.webContents.send('remove-lastMsg')
          captchaDisplayed = false
        }
        artInfo(postObj)
        break

      case 'captcha':
        // Handle a captcha page
        global.win.webContents.send('display-msg', 'Captcha displayed')
        captchaDisplayed = true
        pages = await browser.pages()
        await pages[pages.length - 1].bringToFront() // Focus on the last tab
        break

      default:
        Log('In the object POSTed, the value of the ID key: ' + postObj.ID + ', was not recognized')
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(501)
        res.end(`{"message": "In the object POSTed, the value of the ID key: ${postObj.ID}, was not recognized"}`)
    }
  })
}

function updateIndexHTML (date, year) {
  // Called from Mainline
  // Input: [Moment(first date), Moment(last date)]
  // Returns: true if update performed, false otherwise
  // Replace empty table rows in ~/Sites/NYT Recipes/yyyy/index.html corresponding with new days' table HTML

  // let errmsg; // Error message
  // const year = dates[0].format('YYYY')
  const tablePath = path.join(NYTRecipesPath, year, 'index.html')
  const table = fs.readFileSync(tablePath, 'UTF-8').toString() // Read year page
  // const newTableHTML = fs.readFileSync(output, "UTF-8").toString();   // Read new table HTML created by this app (diagnostic)
  const tableLastIndex = table.length - 1

  // Find beginning date
  console.log('Finding start of replace')
  const startDateIndex = table.indexOf(date)
  if (startDateIndex === -1) {
    // console.error('updateIndexHTML: first date ' + dates[0].format('MM/DD/YYYY') + ' not found in index.html')
    console.error('updateIndexHTML: first date ' + date + ' not found in index.html')
    return false
  }
  // console.log("startDateIndex: " + startDateIndex.toString());

  // Find the </tr> or <tbody> preceeding the first date
  let trEndLength = 5
  let trEndBeforeStartDateIndex = table.lastIndexOf('</tr>', startDateIndex)
  if (trEndBeforeStartDateIndex === -1) {
    trEndLength = 7
    trEndBeforeStartDateIndex = table.lastIndexOf('<tbody>', startDateIndex)
  }
  if (trEndBeforeStartDateIndex === -1) {
    console.error('updateIndexHTML: unable to find </tr> or <tbody> preceding ' + date)
    return false
  }
  console.log('trEndBeforeStartDateIndex: ' + trEndBeforeStartDateIndex.toString())

  // Find the newline character between the </tr>|<tbody> element and the beginning date
  const nlAfterTrEndBeforeStartDateIndexIndex = table.substr(trEndBeforeStartDateIndex, trEndLength + 2).search(/\r\n|\n|\r/)
  if (nlAfterTrEndBeforeStartDateIndexIndex === -1) {
    console.error('updateIndexHTML: unable to find newline following trEndBeforeStartDateIndex')
    return false
  }
  // console.log("nlAfterTrEndBeforeStartDateIndexIndex: " + nlAfterTrEndBeforeStartDateIndexIndex.toString())

  // The index following the newline character(s) is where the replacement starts
  const nlAfterTrEndBeforeStartDateIndex = table.substr(trEndBeforeStartDateIndex + nlAfterTrEndBeforeStartDateIndexIndex, 2).match(/\r\n|\n|\r/)
  // console.log("nlAfterTrEndBeforeStartDateIndex: " + nlAfterTrEndBeforeStartDateIndex.toString())
  const replaceStartIndex = trEndBeforeStartDateIndex + nlAfterTrEndBeforeStartDateIndexIndex + nlAfterTrEndBeforeStartDateIndex[0].length
  // console.log("updateIndexHTML: replaceStartIndex: " + replaceStartIndex.toString());

  // Find the ending date
  const endDateIndex = table.indexOf(date)
  if (endDateIndex === -1) {
    console.error('updateIndexHTML: last date ' + date + ' not found in index.html')
    return false
  }
  console.log('endDateIndex: ' + endDateIndex.toString())

  // Find the date following the ending date or </tbody>
  let nextDateAfterEndDateIndex = table.substr(endDateIndex + 10).search(/\d\d\/\d\d\/\d\d\d\d/)
  console.log('nextDateAfterEndDateIndex search result: ' + nextDateAfterEndDateIndex.toString())
  if (nextDateAfterEndDateIndex === -1) {
    nextDateAfterEndDateIndex = table.indexOf('</tbody', endDateIndex)
    console.log('nextDateAfterEndDateIndex indexOf result: ' + nextDateAfterEndDateIndex.toString())
    if (nextDateAfterEndDateIndex === -1) {
      console.error('updateIndexHTML: unable to find MM/DD/YYYY or </tbody following ' + date)
      return false
    }
  } else {
    nextDateAfterEndDateIndex = nextDateAfterEndDateIndex + endDateIndex + 10
  }
  console.log('updateIndexHTML: MM/DD/YYYY or </tbody following ' + date + ': ' + nextDateAfterEndDateIndex.toString())

  // Find the </tr> element preceeding the next date or </tbody>
  const trEndBeforeNextDateAfterEndDateIndex = table.lastIndexOf('</tr>', nextDateAfterEndDateIndex)
  if (trEndBeforeNextDateAfterEndDateIndex === -1) {
    console.error('updateIndexHTML: unable to find </tr> preceding MM/DD/YYYY or </tbody')
    return false
  }
  console.log('updateIndexHTML: trEndBeforeNextDateAfterEndDateIndex: ' + trEndBeforeNextDateAfterEndDateIndex.toString())

  // Find the newline character(s) follow the </tr> element
  const nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex = table.substr(trEndBeforeNextDateAfterEndDateIndex, 7).search(/\r\n|\n|\r/)
  if (nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex === -1) {
    console.error('updateIndexHTML: unable to find newline following trEndBeforeNextDateAfterEndDateIndex')
    return false
  }
  console.log('updateIndexHTML: (nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex: ' + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex.toString())

  // The index following the newline character(s) is the replacement ends
  const nlAfterTrEndBeforeNextDateAfterEndDateIndex = table.substr(trEndBeforeNextDateAfterEndDateIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex, 2).match(/\r\n|\n|\r/)
  console.log('updateIndexHTML: nlAfterTrEndBeforeNextDateAfterEndDateIndex: ' + nlAfterTrEndBeforeNextDateAfterEndDateIndex.toString())
  const replaceEndIndex = trEndBeforeNextDateAfterEndDateIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndex[0].length
  console.log('updateIndexHTML: replaceEndIndex: ' + replaceEndIndex.toString())
  console.log('updateIndexHTML: insert between 0-' + replaceStartIndex.toString() + ' and ' + replaceEndIndex.toString() + '-' + tableLastIndex.toString())

  // Replace ~/Sites/NYT Recipes/yyyy/index.html with the leading unchanged part + the new table HTML + the trailing unchanged part
  fs.writeFileSync(tablePath, table.substring(0, replaceStartIndex) + newTableHTML + table.substring(replaceEndIndex, tableLastIndex), 'utf8')
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

async function dayCompare (newTable, oldTable) {
  // Compare two collections of HTML table rows, one (new) a transformation
  //  (by adding and deleting rows) of the other (old)
  // Identify the rows added and the rows deleted.

  Log('function dayCompare entered')

  const prefix = '<table>' // prepend to newTable/oldTable
  const suffix = '</table>' // append to newTable/oldTable
  const addColor = '#e7fcd7' // light green - background color for added rows
  const delColor = '#fce3e3' // light red - background color for missing rows
  const test = false
  const debug = true

  function rowsText (rows, cheerioQuery) {
    // Create an array of table row text
    // Input: 1) Iterable Cheerio object of table rows
    //        2) Cheerio query function for argument 1
    // Output: array of table row text
    //
    // Extract the text from each table row's table data elements (TD), remove whitespace
    //  and add the concatenation of the TD text to the output array

    const text = []
    rows.each(function () {
      // For each row,

      // Get its TD elements
      const tds = cheerioQuery('td', this)

      // rowText will be a concatenation of each TD's text
      let rowText = ''

      tds.each(function () {
        // For each TD element,

        // Get its text, remove whitespace and <br> elements,
        //  replace 'http' with 'https', and concatenate the result
        //  to rowText
        rowText += cheerioQuery(this).html().replace(/\s+|<br>/g, '').replace('http:', 'https:')
      })

      // Append the row's concatenated text to the output array
      text.push(rowText)
    })

    // return [row text, row text, ...]
    return text
  }

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

  // Create a Cheerio query function for the old collection
  const old$ = cheerio.load(prefix + oldTable + suffix)

  // For the old collection, create an iterable Cheerio object of the table rows (oldRows)
  // and a javascript array of Cheerio objects for each table row
  const oldRows = old$('tr')
  const oldRowsArray = oldRows.toArray()

  // Create an array (oldRowsText) of each old table row's text
  const oldRowsText = rowsText(oldRows, old$)

  // Create a Cheerio query function for the new collection
  const new$ = cheerio.load(prefix + newTable + suffix)

  // For the new collection, create an iterable Cheerio object of the table rows (newRows)
  // and a javascript array of Cheerio objects for each table row
  const newRows = new$('tr')
  const newRowsArray = newRows.toArray()

  // Create an array (newRowsText) of each new table row's text
  const newRowsText = rowsText(newRows, new$)

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

  // diffRowsHTML is only for debugging
  const diffRowsHTML = [...newRowsText]

  // For each newInNew element (an added table row in newRowsArray),
  //  modify the table row in newRowsArray to set its background color to 'added'.
  newInNew.forEach((el) => {
    diffRowsHTML[el] = '+' + diffRowsHTML[el]
    new$(newRowsArray[el]).css('background-color', addColor)
  })

  // If there are table rows in oldRowsArray not present in newRowsArray
  //  (i.e. oldInOld not empty), duplcate newRowsArray as mergedHTML.
  // mergedHTML will be modified in the following loop and then returned
  //  to the caller if the Merge action is chosen.
  let mergedHTML
  if (oldInOld.length > 0) {
    mergedHTML = [...newRowsArray]
  }
  // For each oldInOld element (a table row in oldRowsArray not present in
  //  newRowsArray), copy the oldRowsArray element to the appropriate position
  //  in mergedHTML, then modify the table row in oldRowsArray to set its
  //  background color to 'deleted' and copy the modified oldRowsArray element
  //  to the appropriate position in newRowsArray.
  // The appropriate position in newRowsArray (and its duplicate mergedHTML) is
  //  determined by iterating backwards through the oldInNew array from the
  //  position of the oldInOld element under consideration until a positive
  //  oldInNew element is found. The value of this positive oldInNew element
  //  is the position in newRowsArray of the first table row preceeding the
  //  oldInOld element under consideration that exists in both oldRowsAray and
  //  newRowsArray. The oldInOld element under consideration should be inserted
  //  into newRowsArray (and its duplicate mergedHTML) after this row common
  //  to both new and old arrays.
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
      diffRowsHTML.unshift('-' + oldRowsText[el])

      // Prepend the oldRowsArray element to the mergedHTML
      mergedHTML.unshift(oldRowsArray[el])

      // Set the row's background color to 'deleted' in oldRowsArray
      old$(oldRowsArray[el]).css('background-color', delColor)

      // Prepend the modified oldRowsArray element to the newRowsArray
      newRowsArray.unshift(oldRowsArray[el])
    } else {
      // Otherwise, if a non-negative element (that is, a row that exists
      //  in both oldRowsArray and newRowsArray) was found ...

      // ... the place in newRowsArray to insert the 'deleted' row is
      //  after that common row.
      const insertion = oldInNew[prevEl] + 1
      Log('Add ' + el.toString() + ' at: ' + insertion.toString(), debug)
      diffRowsHTML.splice(insertion, 0, '-' + oldRowsText[el])

      // Insert the oldRowsArray elment into mergedHTML
      mergedHTML.splice(insertion, 0, oldRowsArray[el])

      // Set the row's background color to 'deleted' in oldRowsArray
      old$(oldRowsArray[el]).css('background-color', delColor)

      // Insert the modified oldRowsArray elment into the newRowsArray
      newRowsArray.splice(insertion, 0, oldRowsArray[el])
    }
  })

  Log('oldRowsText: ' + oldRowsText, debug)
  Log('newRowsText: ' + newRowsText, debug)
  Log('updated diffRowsHTML: ' + diffRowsHTML, debug)

  Log('Added rows: ' + newInNew.length.toString(), debug)
  Log('Deleted rows: ' + oldInOld.length.toString(), debug)

  // added is true if newRowsArray contains added rows
  const added = newInNew.length > 0

  // deleted is true if oldRowsArray contains rows missing from newRowsArray
  const deleted = oldInOld.length > 0

  if (test) {
    return
  }

  if (added && deleted) {
    // If there are both added and missing rows in the new table HTML,
    //  display a button to replace the existing table HTML with the
    //  union of the added and existing rows, i.e. add the added rows and
    //  retain the missing rows
    await createButton('mergeBtn', 'Merge')
  }
  if (added || deleted) {
    // If there are added rows or missing rows in the new table HTML,
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

    // Create a Cheerio query function for an empty table
    const table$ = cheerio.load('<table><tbody></tbody></table>')

    // Add table rows from newRowsArray to the empty table
    for (let a = 0; a < newRowsArray.length; a++) {
      table$(newRowsArray[a]).appendTo('tbody')
    }
    Log('diff table:', debug)
    Log(table$('table').html(), debug)

    // Display the table
    global.win.webContents.send('display-tableCompare', table$('table').html())

    // Enable acction buttons
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
    // Create a Cheerio query function for an empty table
    const merged$ = cheerio.load('<table><tbody></tbody></table>')

    // Add table rows from mergedHTML to the empty table
    for (let a = 0; a < mergedHTML.length; a++) {
      merged$(mergedHTML[a]).appendTo('tbody')
    }

    // Return the selected action and the merged table HTML
    //  (The merged table HTML returned by Cheerio is modified to match the HTML
    //   generated by this app.  A carriage return is appended to </tr> elements
    //   and 14 spaces are prepended to <tr> elements.)
    returnObj = {
      action: buttonClicked,
      mergedHTML: merged$('tbody').html().replace(/<\/tr>/g, '</tr>\r').replace(/<tr>/g, '              <tr>')
    }
  } else {
    // If not Merge, return the action selected and null for the merged table HTML
    returnObj = {
      action: buttonClicked,
      mergedHTML: null
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
  if (datesToProcess.length > 0) {
    // If there are dates to process, update lastDate.txt
    saveLastDate = true
  }

  // Create an HTTP server to receive POST requests from the tpScrape and Scrape userscripts
  const server = http.createServer(requestListener)
  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`)
  })

  ipcMain.on('submitted', async (evt, checkedArticleIndicesString) => {
    // When the 'Submit' button is clicked, ...
    const checkedArticleIndices = JSON.parse(checkedArticleIndicesString)
    Log('checkedArticleIndices: ' + checkedArticleIndices)
    if (checkedArticleIndices.length > 0) {
      // If any articles were checked, create table HTML for the date being processed
      const tpDate = tpDateObj.format('MM/DD/YYYY')
      const tpYear = tpDate.substring(6)
      const inconsistent = '<span class="inconsistent">inconsistent name: </span>'
      newTableHTML = '              <tr>\n                <td class="date"><a href="' + tpURL + '">'
      newTableHTML += tpDate + '</a></td>\n'
      newTableHTML += '                <td class="type"><br>\n'
      newTableHTML += '                </td>\n                <td class="name"><br>\n'
      newTableHTML += '                </td>\n              </tr>\n'
      checkedArticleIndices.forEach((idx) => {
        const artObj = articleInfoObjArray.filter((el) => el.index === idx)[0]
        newTableHTML += '              <tr>\n                <td><br>\n                </td>\n                <td>' + artObj.titleInfo.arttype + '\n'
        newTableHTML += '                </td>\n                <td><a href="'
        newTableHTML += artObj.url + '">' + artObj.titleInfo.title + '</a>' + artObj.titleInfo.ATDPresent + '</td>\n              </tr>\n'

        for (const recipe of artObj.recipeList) {
          const recipeName = recipe.inconsistency ? inconsistent + recipe.name : recipe.name
          newTableHTML += '              <tr>\n                <td><br>\n                </td>\n                <td>recipe\n'
          newTableHTML += '                </td>\n                <td><a href="'
          newTableHTML += recipe.link + '">' + recipeName + '</a></td>\n              </tr>\n'
        }
      })
      console.log('Created HTML for ' + tpDate)

      // If a date was entered and table HTML for that date already exists, compare the two HTMLs
      let checkExistingResult
      let compareResult
      let msg
      if (dateEntered) {
        checkExistingResult = checkExisting(tpDate)
        if (checkExistingResult.exists) {
          compareResult = await dayCompare(newTableHTML, checkExistingResult.existingHTML)
          Log('Action returned: ' + compareResult.action)
          Log('HTML returned: ' + compareResult.mergedHTML)
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
            newTableHTML = compareResult.mergedHTML
            break

          default:
            break
        }
      }

      if (updateHTML) {
        if (updateIndexHTML(tpDate, tpYear)) {
          console.log('Mainline: index.html updated')
          newTableHTML = '' // Reset newTableHTML

          // Add "Review ..." message and a 'Continue' submit button to index.html
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

        // Store LastDate processed and tell the renderer process to update the max pickable date
        if (saveLastDate) {
          fs.writeFileSync(lastDateFile, tpDate, 'utf8')
          global.win.webContents.send('update-maxdate', tpDate.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2'))
        }
      }
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

app.on('will-quit', async () => {
  // Close the application's tab in the remote Chrome instance
  if (!browser?.isConnected()) {
    // Puppeteer will disconnect from the remote browser after a period of inactivity.
    // If this has happened, reconnect.
    await connectPup()
  }
  try {
    await page.close()
  } catch (e) {
    Log('Page close error - ' + e)
  }
})

Mainline() // Launch puppeteer, start HTTP server add event listener for Start button
