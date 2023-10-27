// Functions shared by current-renderer.js and past-renderer.js
//
//  NewDays     - determine which days in index.html are new or updated
//  Insert      - Invoke insert.php to update the local database
//

const fs = require('fs') // Filesystem functions
const { BrowserWindow } = require('electron') // InterProcess Communications
const cheerio = require('cheerio') // core jQuery

// NewDays is used after adding a day entry to a year's index.html file
//  or changing an existing entry in an index.html file.
//
// It creates input for the MAMP insert.php script, which inserts/updates days'
//  table HTML in the local MySQL database and creates an insert/update file
//  to import into the remote database.
//
// NewDays requires two arguments: a year (yyyy) and the msgs div element (msgDiv)
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
//  If the two sets of table HTML differ, NewDays looks to see if only newline
//   characters are different.  This condition should not occur if BlueGriffon
//   is configured not to wrap long lines.
//
//  Otherwise, if the two sets of table HTML differ, NewDays renames the existing
//   file in the Days folder as Old_yyyy-mm-dd.txt (replacing an existing
//   Old_yyyy-mm-dd.txt) and stores the new HTML in the Days folder as
//   yyyy-mm-dd.txt and in the MAMP htdocs/updates folder as yyyy-mm-dd.txt
//   for use by the insert.php script.
//
// function NewDays(yyyy, msgDiv, singleDate) {
function NewDays (yyyy) {
  // Input: year (yyyy) of dates being processed
  // Returns true if there are inserts or updates to be processed, false otherwise
  // Segment the year's table HTML (~/Sites/NYT Recipes/yyyy/index.html) by day
  // Determine if each day's segment is new or if it's an update

  // console.log("NewDays entered with " + yyyy + " singleDate: " + singleDate);
  console.log('NewDays entered with ' + yyyy)

  function back2NL (idx) {
    // Called from NewDays
    // Input: index of <tr> element
    // Returns: index following the new line procedding the input <tr> element
    // Back up from the <tr> element looking for CRLF or LF or CR

    let nlIndex = -1
    let nlLook = idx
    while (nlIndex < 0) {
      nlLook = nlLook - 2
      nlIndex = table.substring(nlLook, idx).search(/\r\n|\n|\r/)
    }
    nlIndex = nlLook + nlIndex
    const nlStr = table.substr(nlIndex, nlIndex + 3).match(/\r\n|\n|\r/)
    return nlIndex + nlStr[0].length
  }

  function addClass (mk) {
    // Called from NewDays
    // Input: table HTML
    // Returns:  updated table HTML
    // In the first table row, add a class name to each of the three <td> elements
    // This is needed because of the addition of the Month order fuction.  Should not be needed after 2020

    if (mk.includes('class=')) { // Exit if the table HTML already contains class names
      return mk
    }
    let idx = 0
    const classes = ['date', 'type', 'name']
    for (let i = 0; i <= 2; ++i) {
      const classInsert = ' class="' + classes[i] + '"'
      idx = mk.indexOf('<td', idx) + 3
      mk = mk.slice(0, idx).concat(classInsert, mk.slice(idx))
      idx += 3
    }
    return mk
  }

  function findContent (day) {
    // Input: Table HTML for one day, extracted from index.html
    // Returns: true or false
    // Determine whether a day's table HTML has content, i.e. contains
    //  a link that is not a link to a Today's Paper page.
    //  Return true if so, false if otherwise.

    let gotContent = false // return value, defaults to false

    // Split the day's table HTML at '<a' and '</a'
    // The resulting array elements alternate between irrelevant strings and
    //   <a> attributes (including href), i.e.:
    //   [irrelevant, <a> attributes, irrelevant, <a> attributes, ...]
    // If the day's tab;e HTML does not contain any <a> elements, the resulting
    //   array is [irrelevant]
    const aAttrs = day.split(/<\/*a/g)

    // For each <a> attribute element ...
    for (let i = 1; i < aAttrs.length; i = i + 2) {
      // console.log(i.toString() + ": " + aAttrs[i]);
      if (!aAttrs[i].includes('/todayspaper/')) { // ... look for todayspaper
        gotContent = true // not found, then the day has content
        break // break out of for loop
      }
    }
    // console.log(gotContent)
    return gotContent
  }

  function distill (markup) {
    // Distill table HTML into an array of text strings

    // Input: table HTML, i.e. <tr> and <td> elements
    // Output: [string, string, …] where string is the concatenated text of the <td> elements
    //          belonging to a <tr> element, stripped of whitespace and
    //          with 'http:' replaced with 'https:'

    const prefix = '<table>' // prepend to markup
    const suffix = '</table>' // append to markup

    // Create a Cheerio query function based on the input table HTML
    const $ = cheerio.load(prefix + markup + suffix)

    // Get a Cheerio array of table rows
    const rows = $('tr')

    // Initialize output array
    const text = []

    rows.each(function () {
      // For each row,

      // Get its <td> elements
      const tds = $('td', this)

      // rowText will be a concatenation of each <td> element's text
      let rowText = ''

      tds.each(function () {
        // For each <td> element,

        // Get its text, remove whitespace, replace 'http' and concatenate
        //  the result to rowText
        rowText += $(this).html().replace(/\s+/g, '').replace('http:', 'https:')
      })

      // Append the row's concatenated text to the output array
      text.push(rowText)
    })

    // return [row text, row text, ...]s
    return text
  }

  // Read the year's table HTML
  const tablePath = '/Users/rahiggins/Sites/NYT Recipes/' + yyyy + '/index.html'
  const table = fs.readFileSync(tablePath, 'UTF-8').toString()

  const dateIndices = []
  let tr = 0
  let dateIndex = 0
  let start = 0
  let tbodyEndIndex = 0
  let tbodyEndRowIndex = 0
  const dates = table.match(/\d{2}\/\d{2}\/\d{4}/g) // Array of date (mm/dd/yyyy) strings in table HTML

  const end = table.length

  // Scan the table HTML for 'mm/dd/yyyy' strings until </tbody> is encountered
  // Find the index of the start of the line containing the <tr> element preceeding the 'mm/dd/yyy' string
  // Push that index onto the dateIndices array
  // eslint-disable-next-line no-labels
  TableScan: while (start < end) {
    dateIndex = table.substr(start).search(/\d{2}\/\d{2}\/\d{4}/)
    if (dateIndex > 0) {
      dateIndex = dateIndex + start
      start = dateIndex + 10
      tr = table.lastIndexOf('<tr>', dateIndex)
      const dateRowIndex = back2NL(tr)
      dateIndices.push(dateRowIndex)
    } else {
      tbodyEndIndex = table.substr(start).indexOf('</tbody>') + start
      tbodyEndRowIndex = back2NL(tbodyEndIndex)
      dateIndices.push(tbodyEndRowIndex)
      // eslint-disable-next-line no-labels
      break TableScan
    }
  }

  const lastIndex = dateIndices.length - 1
  // const prolog = table.substring(0,dateIndices[0]);
  // const epilog = table.substring(dateIndices[lastIndex]);
  let dayMarkup = ''
  let keys = []

  const daysPath = '/Users/rahiggins/Sites/NYT Recipes/' + yyyy + '/Days/' // Directory containing day segments
  const insertPath = '/Applications/MAMP/htdocs/inserts/' // Directory containing day segments to be inserted
  const updatePath = '/Applications/MAMP/htdocs/updates/' // Directory containing day segments for update
  // const newLineChars = '\n\r'

  // Function return value defaults to false
  let callInsert = false

  // Segment table HTML by day
  for (let i = 0; i < lastIndex; i++) {
    dayMarkup = table.substring(dateIndices[i], dateIndices[i + 1])

    if (findContent(dayMarkup)) {
      // If this day's segment has content (links to other than Today's Paper):
      //  See if a segment for the day already exists in daysPath
      //  If a segment already exists, see if they're identical
      //  If they're not identical, add the new segment to updatePath
      //  If a segment for the day doesn't already exist in daysPath,
      //    add it to daysPath and to insertPath
      //  If a segment was added to updatePath or insertPath,
      //    set callInsert to true

      // Add class names to first row's <td> elements
      dayMarkup = addClass(dayMarkup)

      // Remove '<meta charset="utf-8">' lines added when HTML is pasted in BlueGriffon
      dayMarkup = dayMarkup.replace(/(\r\n|\n|\r)\s+<meta charset="utf-8">(\r\n|\n|\r)\s+/g, ' ')

      keys = dates[i].split('/') // Split date into [mm, dd, yyyy]
      const fileName = keys[2] + '-' + keys[0] + '-' + keys[1] + '.txt'
      if (fs.existsSync(daysPath + fileName)) {
        // The day's table HTML already exists in the Days folder
        // console.log(fileName + " exists");
        const existing = fs.readFileSync(daysPath + fileName, 'UTF-8').toString()
        if (existing === dayMarkup) {
          // The previously stored table HTML is identical to the generated table HTML
          console.log('Both ' + fileName + ' are the same')
        } else {
          // The previously stored table HTML differs from the generated table HTML.
          //  See if the difference is only in whitespace or 'http' instead of 'https'.
          //  Try both a fancy 'distill' comparison and a simple replacement comparison
          console.log('Both ' + fileName + ' are not the same')
          let diff = true
          if (JSON.stringify(distill(existing)) === JSON.stringify(distill(dayMarkup))) {
            console.log('Distilled ' + fileName + ' are equal')
            diff = false
          }
          if (existing.replace(/\s+/g, '').replace('http:', 'https:') === dayMarkup.replace(/\s+/g, '').replace('http:', 'https:')) {
            console.log('Simple whitespace stripped ' + fileName + ' are equal')
            diff = false
          }
          // Used to have a problem with BlueGriffon changing newline codes. This probably isn't needed any more
          // var diff = false;
          // if (existing.length == dayMarkup.length) {
          //     var scanLength = dayMarkup.length;
          //     var misMatch = false;
          //     for (var j = 0; j < scanLength; j++) {
          //         if (existing[j] !== dayMarkup[j]) {
          //             if (newLineChars.includes(existing[j]) && newLineChars.includes(dayMarkup[j])) {
          //                 console.log("Newline mismatch at " + j.toString() + " for " + fileName);
          //                 misMatch = true;
          //             } else {
          //                 diff = true;
          //                 break;
          //             }
          //         }
          //     }
          //     if (misMatch) {
          //         fs.writeFileSync(daysPath + fileName, dayMarkup, "utf8");
          //         console.log(fileName + " replaced in Days");
          //     }
          // } else {
          //     diff = true;
          // }

          if (diff) {
            console.log(fileName + ' differs, added to updates')

            // Existing day file has changed
            global.win.webContents.send('display-msg', fileName + ' differs, added to updates', { indent: true })

            // Existing file will be renamed to Old_file
            const oldName = 'Old_' + fileName

            // If Old_file already exists, delete it
            if ((fs.existsSync(daysPath + oldName))) {
              fs.unlinkSync(daysPath + oldName)
            }
            // Rename existing file to Old_file
            fs.renameSync(daysPath + fileName, daysPath + oldName)

            // Write updated file to Days
            fs.writeFileSync(daysPath + fileName, dayMarkup, 'utf8')

            // Write updated file to updates
            fs.writeFileSync(updatePath + fileName, dayMarkup, 'utf8')

            // Set flag to call insert.php
            callInsert = true
          }
        }
      } else {
        global.win.webContents.send('display-msg', fileName + ' added to inserts', { indent: true })
        fs.writeFileSync(daysPath + fileName, dayMarkup, 'utf8')
        fs.writeFileSync(insertPath + fileName, dayMarkup, 'utf8')
        callInsert = true
      }
    }
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

module.exports = { NewDays, Insert }
