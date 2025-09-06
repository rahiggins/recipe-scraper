// Functions shared by current-renderer.js and past-renderer.js
//
//  tableContent   - Cheerio query function plugin, return the aggregated content of <td> elements
//  formatHTML  - Cheerion query function plugin, format table row HTML
//  NewDays     - determine which days in index.html are new or updated
//

const fs = require('fs') // Filesystem functions
const path = require('path') // Path functions
const cheerio = require('cheerio') // core jQuery
const mysql = require('mysql2/promise') // MySQL database functions
const { execFileSync } = require('child_process') // Execute shell commands

// NewDays is used after adding a day entry to a year's index.html file
//  or changing an existing entry in an index.html file.
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
//   inserts the table HTML into the the local and remote databases.
//
//  If the two sets of table HTML differ, NewDays renames the existing
//   file in the Days folder as Old_yyyy-mm-dd.txt (replacing an existing
//   Old_yyyy-mm-dd.txt) and stores the new HTML in the Days folder as
//   yyyy-mm-dd.txt and updates the table HTML in the the local and remote databases.
//

// Cheerio plug-in functions

// Return the aggregated content of <td> elements
function tableContent ($) {
  // Input - Cheerio query function
  // this - Cheerio object containing <td> elements
  // Output - concatentated content of the <td> elements with some edits
  //
  // Invocation example: $('td').tableContent($)
  let text = ''
  this.each((i, element) => {
    const iH = $(element).prop('innerHTML')
      .replaceAll('\n', '') // Remove newlines
      .replace(/  +/g, ' ') // Reduce multiple spaces to a single space
      .replaceAll('<meta charset="utf-8">', '') // Remove this, inserted by BlueGriffon
      .replaceAll("'", "''") // Escape single quotes for the shell
      .replaceAll(' <', '<') // Remove a space before a tag
      .replaceAll('> ', '>') // Remove a space after a tag
      .trim()
    text += iH !== '<br>' ? iH : '' // Ignore content that is only a <br> tag
  })
  return text
}

// Format table row HTML
function formatHTML ($) {
  // Input - Cheerio query function
  // this - Cheerio object containing the table elements
  // Output - formatted HTML
  //
  // Invocation example: $('table').formatHTML($)
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
async function NewDays (yyyy) {
  // Input: year (yyyy) of dates being processed
  // Returns true if there are inserts or updates to be processed, false otherwise
  // Segment the year's table HTML (~/Sites/NYT Recipes/yyyy/index.html) by day
  // Determine if each day's segment is new or if it's an update

  // console.log("NewDays entered with " + yyyy + " singleDate: " + singleDate);
  console.log('NewDays entered with ' + yyyy)
  let localDB // Local MySQL database connection
  let remoteDB // Remote MySQL database connection
  let databasesUpdated = false // Set to true on INSERT or UPDATE

  // Connect to the local MySQL database
  try {
    localDB = await mysql.createConnection({
      host: process.env.local_host,
      port: process.env.local_port,
      user: process.env.local_user,
      password: process.env.local_password,
      database: 'Rdays'
    })
  } catch (err) {
    console.log(err)
    global.win.webContents.send('display-msg', 'Fatal error - connection to local database failed:')
    global.win.webContents.send('display-msg', ` Message: ${err.message}, Code: ${err.code}`)
    throw new Error('Database connection failure terminates application')
  }
  // Connect to the remote MySQL database
  try {
    remoteDB = await mysql.createConnection({
      host: process.env.remote_host,
      port: process.env.remote_port,
      user: process.env.remote_user,
      password: process.env.remote_password,
      database: 'rahiggins_Rdays'
    })
  } catch (err) {
    console.log(err)
    global.win.webContents.send('display-msg', 'Fatal error - connection to remote database failed:')
    global.win.webContents.send('display-msg', ` ${err.message}`)
    throw new Error('Database connection failure terminates application')
  }

  // MySQL statement templates
  const insert = 'INSERT INTO days (year, month_num, month, day, markup) VALUES (?, ?, ?, ?, ?)'
  const update = 'UPDATE days SET markup=?  WHERE year=? AND month_num=? AND day=?'

  // Cheerio extension function - Extract the date from the first table cell of a day's table rows
  function extractDate (mode = 'i') {
    // this - $('tr td').eq(0)
    // Return an array containing the date in the format [YYYY, MM, MMM, DD] for mode 'i'
    // or [YYYY, MM, DD] for mode 'u'
    // or an empty array for no date or an unrecognized mode
    const months = { // Month number to month name mapping object
      '01': 'Jan',
      '02': 'Feb',
      '03': 'Mar',
      '04': 'Apr',
      '05': 'May',
      '06': 'Jun',
      '07': 'Jul',
      '08': 'Aug',
      '09': 'Sep',
      10: 'Oct',
      11: 'Nov',
      12: 'Dec'
    }

    // Match the date elements in a MM/DD/YYYY date
    const dateMatch = this.text().trim().match(/(?<monthNum>\d{2})\/(?<day>\d{2})\/(?<year>\d{4})/)

    // If a date was matched, return the date components according to the requested mode
    if (dateMatch) {
      switch (mode) {
        case 'i':
          return [dateMatch.groups.year,
            dateMatch.groups.monthNum,
            months[dateMatch.groups.monthNum],
            dateMatch.groups.day
          ]
        case 'u':
          return [dateMatch.groups.year,
            dateMatch.groups.monthNum,
            dateMatch.groups.day
          ]
        default:
          console.log('extractDate: Unrecognized mode: ' + mode)
          return []
      }
    } else {
      console.log('extractDate: No date found in ' + this.text())
      return []
    }
  }

  // Process a day
  async function processDay () {
    // See if the day exists in the Days folder. If not, store it in the Days folder and the inserts folder and insert the day in the remote database. If it does, and it differs, rename the existing file, store the new file in the Days folder and the updates folder and update the day in the remote database.

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
      $day.prototype.tableContent = tableContent

      // Get the concatenated inner HTML of both tables and insert newlines after each tag to facilitate comparison
      const newInnerHTML = $tmptbl('td').tableContent($tmptbl).replaceAll('>', '>\n')
      const existingInnerHTML = $day('td').tableContent($day).replaceAll('>', '>\n')

      // Use the diff command to compare the two tables. The ouput of the command is logged to the console. If the tables differ, an exception is thrown.
      try {
        execFileSync(
          'diff', [`<( printf '%s' '${newInnerHTML}' )`,
            `<( printf '%s' '${existingInnerHTML}' )`],
          {
            stdio: 'inherit',
            shell: '/bin/zsh'
          }
        )
      } catch (e) {
        // The tables differ. The existing HTML in the Days folder will be renamed by prepending 'Old_' and the new HTML will replace it.
        console.log(`${fileName} is being renamed to Old_${fileName} and replaced`)

        // Existing file will be renamed to Old_file
        if (fs.existsSync(oldFile)) {
          // If Old_file already exists, delete it
          fs.unlinkSync(oldFile)
        }
        // Rename existing file to Old_file
        fs.renameSync(dayFile, oldFile)

        // Format the day's new table HTML
        const dayHTML = $tmptbl('table').formatHTML($tmptbl)

        // Write updated file to Days
        fs.writeFileSync(dayFile, dayHTML, 'utf8')

        const values = $tmptbl('tr td').eq(0).extractDate('u') // Extract an array of date components
        values.unshift(dayHTML) // Prepend the day's table HTML
        databasesUpdated = true
        // Update the day's table HTML in the local database
        try {
          await localDB.execute(update, values)
          global.win.webContents.send('display-msg', `${YMD} updated in the local database`)
        } catch (err) {
          console.log(err)
        }
        // Update the day's table HTML in the remote database
        try {
          await remoteDB.execute(update, values)
          global.win.webContents.send('display-msg', `${YMD} updated in the remote database`)
        } catch (err) {
          console.log(err)
        }
      }
    } else {
      // The day's HTML file is not in the Days folder, so create it
      const dayHTML = $tmptbl('table').formatHTML($tmptbl)
      fs.writeFileSync(dayFile, dayHTML, 'utf8')

      const values = $tmptbl('tr td').eq(0).extractDate() // Extract an array of date components
      values.push(dayHTML) // Append the day's table HTML
      databasesUpdated = true
      // Insert the day's table HTML into the local database
      try {
        await localDB.execute(insert, values)
        global.win.webContents.send('display-msg', `${YMD} inserted into the local database`)
      } catch (err) {
        console.log(err)
      }
      // Insert the day's table HTML into the remote database
      try {
        await remoteDB.execute(insert, values)
        global.win.webContents.send('display-msg', `${YMD} inserted into the remote database`)
      } catch (err) {
        console.log(err)
      }
    }
  }

  const yearPath = path.join('/Users/rahiggins/Sites/NYT Recipes', yyyy) // The year's folder
  const tablePath = path.join(yearPath, '/index.html') // The year's table HTML
  const daysPath = path.join(yearPath, 'Days') // Directory containing day segments

  // Load the year's table HTML into a Cheerio query function and add plugins to the function
  const table = fs.readFileSync(tablePath, 'UTF-8').toString()
  const $year = cheerio.load(table)
  $year.prototype.formatHTML = formatHTML
  $year.prototype.tableContent = tableContent

  // Compare each day in the year's table HTML to the corresponding day's table HTML in the Days folder
  let notFirst = false // First date is handled differently from the rest
  let $tmptbl // Cheerio queery function for a day in the year'as table HTML
  let YMD // YYYY-MM-DD date string

  const trs = $year('tr') // All table rows in the year'as table HTML
  for (const tr of trs) {
    // For each table row ...
    const date = $year('td', tr).eq(0).text().trim() // Text content of the row's date cell
    if (date !== '') {
      // For the start of a new day ...
      if (notFirst) {
        // If it's not the first day of the year ...
        await processDay() // Process the previous day
      }
      // Initialize a new day
      YMD = date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2') // The new day's date as  YYYY-MM-DD
      $tmptbl = cheerio.load('<table></table>') // Create a new Ceerio query function for the   new day
      $tmptbl.prototype.tableContent = tableContent // Add plugins to the new Cheerio query function
      $tmptbl.prototype.formatHTML = formatHTML
      $tmptbl.prototype.extractDate = extractDate
      notFirst = true
    } else if ($year('td', tr).tableContent($year) === '') {
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
  if (!databasesUpdated) {
    // No inserts or updates
    global.win.webContents.send('display-msg', 'No database updates')
  }
  localDB.end() // Close the connection to the local database
  remoteDB.end() // Close the connection to the remote database
  // return callInsert
}

module.exports = { tableContent, formatHTML, NewDays }
