// Functions shared by current-renderer.js and past-renderer.js
//
//  tableText   - Cheerion query function plugin, return the aggregated text content of <td> elements
//  formatHTML  - Cheerion query function plugin, format table row HTML
//  NewDays     - determine which days in index.html are new or updated
//  Insert      - Invoke insert.php to update the local database
//

const fs = require('fs') // Filesystem functions
const path = require('path') // Path functions
const { BrowserWindow } = require('electron') // InterProcess Communications
const cheerio = require('cheerio') // core jQuery

// NewDays is used after adding a day entry to a year's index.html file
//  or changing an existing entry in an index.html file.
//
// It creates input for the MAMP insert.php script, which inserts/updates days'
//  table HTML in the local MySQL database and creates an insert/update file
//  to import into the remote database.
//
// NewDays has one input parameter: the year being processed (yyyy)
//
// NewDays splits an NYT Recipes index.html file by day.
//
// NewDays ensures each <td> element in the day's first table row includes a
//  class attribute.
//
// NewDays compares each day's table HTML to the table HTML for that day
//  class previously stored in the year's Days folder.
//
//  If the two sets of table HTML are equal, NewDays procedes to the next day.
//
//  If the table HTML for the day does not exist in the Days folder,
//   NewDays stores the table HTML in the Days folder as yyyy-mm-dd.txt and
//   in the MAMP htdocs/inserts folder under the same name for use by the
//   insert.php script.
//
//  If the two sets of table HTML differ, NewDays renames the existing
//   file in the Days folder as Old_yyyy-mm-dd.txt (replacing an existing
//   Old_yyyy-mm-dd.txt) and stores the new HTML in the Days folder as
//   yyyy-mm-dd.txt and in the MAMP htdocs/updates folder as yyyy-mm-dd.txt
//   for use by the insert.php script.
//

// Cheerio plug-in functions

// Return the aggregated text content of <td> elements
function tableText ($) {
  // Input - Cheerio query function
  // this - Cheerio object containing <td> elements
  // Output - concatentated text of the <td> elements with whitespace and newlines removed
  let text = ''
  this.each((i, element) => {
    text += $(element).text().replaceAll('\n', '').trim()
  })
  return text
}

// Format table row HTML
function formatHTML ($) {
  // Input - Cheerio query function
  // this - Cheerio object containing the table elements
  // Output - formatted HTML
  if (this.length > 0) {
    // Return the Cheerio object's HTML with the following changes:
    // 1. Insert a newline after the tbody tag
    // 2. Delete a newline and following spaces, unless the spaces are followed by a tag
    // 3. Add a newline between adjacent end tags and start tags unless the start tag is <a> or <br>
    // 4. Replace multiple succesive newlines with a single newline
    // 5. Add a newline before </td> tags when the tags are preceded by non-whitespace characters
    // 6. Indent the HTML for readability
    // 7. Filter out tbody tags
    return $(this).html().replace('<tbody>', '<tbody>\n')
      .replaceAll(/\n\s*(?!\s*<)/g, '')
      .replaceAll(/(<\/(?!\ba\b|\bbr\b).*?>)(?=(<))/g, '$1\n')
      .replaceAll(/(<tr>)/g, '$1\n')
      .replace(/\n+(?=\n)/g, '')
      .replaceAll(/(\S+?)<\/td>/g, '$1\n</td>')
      .split('\n')
      .map((line) => {
        line = line.trim()
        const tag = line.match(/^<\/?(.*?)>/)[1]
        switch (tag) {
          case 'tr':
            line = '              ' + line
            break
          case 'td':
            line = '                ' + line
            break
          case 'br':
            line = '                  ' + line
            break
          default:
            line = '                ' + line
        }
        return line
      })
      .filter((line) => !line.match(/<\/?tbody>/))
      .join('\n')
  } else {
    return $.html()
  }
}

// function NewDays(yyyy, msgDiv, singleDate) {
function NewDays (yyyy) {
  // Input: year (yyyy) of dates being processed
  // Returns true if there are inserts or updates to be processed, false otherwise
  // Segment the year's table HTML (~/Sites/NYT Recipes/yyyy/index.html) by day
  // Determine if each day's segment is new or if it's an update

  // console.log("NewDays entered with " + yyyy + " singleDate: " + singleDate);
  console.log('NewDays entered with ' + yyyy)

  // Cheerio extension function - add class names to a row's <td> elements
  // Used to add class names to the first row of a day's table HTML
  function addClassName ($) {
    const classNames = ['date', 'type', 'name']
    $('td', this).each((i, element) => {
      if (!$(element).hasClass(classNames[i])) {
        $(element).addClass(classNames[i])
      }
    })
  }

  // Process a day
  function processDay () {
    // See if the day exists in the Days folder. If not, store it in the Days folder and the inserts folder. If it does, and it differs, rename the existing file, store the new file in the Days folder and the updates folder.

    // File names and paths
    const fileName = YMD + '.txt' // YMD is YYYY-MM-DD
    const oldName = 'Old_' + fileName
    const oldFile = path.join(daysPath, oldName)
    const dayFile = path.join(daysPath, fileName)

    if (fs.existsSync(dayFile)) {
      // If that day's HTML file exists in the Days folder, see if the year's table HTML differs from it

      // Load the Days folder table HTML into a Cheerio query function and add a plugin to the function
      const dayHTML = fs.readFileSync(dayFile, 'utf8')
      const $day = cheerio.load(`<table>${dayHTML}</table>`)
      $day.prototype.tableText = tableText

      if ($tmptbl('td').tableText($tmptbl) === $day('td').tableText($day)) {
        console.log(`Both ${fileName} are the same`)
      } else {
        console.log(`${fileName} differs, added to updates`)

        console.log('New HTML:')
        console.log($tmptbl('td').tableText($tmptbl))
        console.log('---------')
        console.log('Existing HTML:')
        console.log($day('td').tableText($day))

        global.win.webContents.send('display-msg', `${fileName} differs, added to updates`, { indent: true })

        // Existing file will be renamed to Old_file
        if (fs.existsSync(oldFile)) {
          // If Old_file already exists, delete it
          fs.unlinkSync(oldFile)
        }
        // Rename existing file to Old_file
        fs.renameSync(dayFile, oldFile)

        // Format the day's table HTML
        const dayHTML = $tmptbl('table').formatHTML($tmptbl)

        // Write updated file to Days
        fs.writeFileSync(dayFile, dayHTML, 'utf8')

        // Write updated file to updates
        fs.writeFileSync(path.join(updatePath, fileName), dayHTML, 'utf8')

        // Set flag to call insert.php
        callInsert = true
      }
    } else {
      // The day's HTML file is not in the Days folder, so create it
      global.win.webContents.send('display-msg', `${fileName} added to inserts`, { indent: true })
      const dayHTML = $tmptbl('table').formatHTML($tmptbl)
      fs.writeFileSync(dayFile, dayHTML, 'utf8')
      fs.writeFileSync(path.join(insertPath, fileName), dayHTML, 'utf8')
      callInsert = true
    }
  }

  const yearPath = path.join('/Users/rahiggins/Sites/NYT Recipes', yyyy) // The year's folder
  const tablePath = path.join(yearPath, '/index.html') // The year's table HTML
  const daysPath = path.join(yearPath, 'Days') // Directory containing day segments
  const insertPath = '/Applications/MAMP/htdocs/inserts/' // Directory containing day segments to be inserted
  const updatePath = '/Applications/MAMP/htdocs/updates/' // Directory containing day segments for update

  // Load the year's table HTML into a Cheerio query function and add plugins to the function
  const table = fs.readFileSync(tablePath, 'UTF-8').toString()
  const $year = cheerio.load(table)
  $year.prototype.formatHTML = formatHTML
  $year.prototype.tableText = tableText

  // Compare each day in the year's table HTML to the corresponding day's table HTML in the Days folder
  let notFirst = false // First date is handled differently from the rest
  let $tmptbl // Cheerio queery function for a day in the year'as table HTML
  let YMD // YYYY-MM-DD date string
  let callInsert = false // Flag to call insert.php

  const trs = $year('tr') // All table rows in the year'as table HTML
  for (const tr of trs) {
    // For each table row ...
    const date = $year('td', tr).eq(0).text().trim() // Text content of the row's date cell
    if (notFirst && date !== '') {
      // For the start of a new day that's not the first day of the year, first ...
      processDay() // Process the previous day
      // Initialize a new day
      YMD = date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2')
      $tmptbl = cheerio.load('<table></table>')
      $tmptbl.prototype.tableText = tableText
      $tmptbl.prototype.formatHTML = formatHTML
      $tmptbl.prototype.addClassName = addClassName
    } else if (!notFirst && date !== '') {
      // For the first date of the year, initialize a new day
      YMD = date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2') // The new day's date as YYYY-MM-DD
      $tmptbl = cheerio.load('<table></table>') // Create a new Ceerio query function for the new day
      $tmptbl.prototype.tableText = tableText // Add plugins to the new Cheerio query function
      $tmptbl.prototype.formatHTML = formatHTML
      $tmptbl.prototype.addClassName = addClassName
      $tmptbl(tr).addClassName($tmptbl) // Add class names to first row's <td> elements
      notFirst = true
    } else if ($year('td', tr).tableText($year) === '') {
      // If the row is empty, there are no more days with content to process in the year, so exit this loop
      YMD = '' // Indicate that the loop was terminated before the end of the year
      break
    }
    // Add the row to the day's table
    $tmptbl('table').append(tr)
  }
  if (YMD !== '') {
    // If the loop reached the end of the year ...
    processDay() // Process the last day
  }

  // Exit from NewDays
  if (!callInsert) {
    // No inserts or updates
    global.win.webContents.send('display-msg', 'None', { indent: true })
  }
  return callInsert
}

// Insert invokes the MAMP insert.php script to update the local MySQL database.
//
// Insert creates a listener for the closing of the window used to run
//  insert.php.
//
// Insert sends a message to the index.js process to cause it to run insert.php.
//
function Insert () {
  // Create a new window to run the insert.php script, which performs MySQL inserts and updates
  // Create winInsert BrowserWindow
  const winInsert = new BrowserWindow({
    width: 500,
    height: 300,
    x: global.x + 200, // position relative to win BrowserWindow
    y: global.y + 300
  })
  // Run recipeScraperInsert.php to update local MySQL database
  winInsert.loadURL('http://localhost:8888/recipeScraperInsert.php')

  // Listen for winInsert window close
  winInsert.on('closed', () => {
    console.log('Insert window closed')
    // Let index-renderer.js process know
    // Window for insert.php was closed
    global.win.webContents.send('remove-msgs')
    const msg = 'Finished'
    global.win.webContents.send('display-msg', msg)
  })
}

module.exports = { tableText, formatHTML, NewDays, Insert }
