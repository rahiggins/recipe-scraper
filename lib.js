// Functions shared by current-renderer.js and past-renderer.js
// 
//  addMsg      - adds a message to the msgs div
//  remvAllMsg  - removes all messages from the msgs div
//  NewDays     - determine which days in index.html are new or updated
//  Insert      - Invoke insert.php to update the local database
//  

const fs = require('fs'); // Filesystem functions
const { ipcRenderer } = require('electron'); // InterProcess Communications
const cheerio = require('cheerio'); // core jQuery

// addMsg creates a <p> element containing message text and adds it to the msgs div
//
function addMsg(msgDiv, msg, opt) {
    // Add a message to the #msgs div
    // If opt { indent: true }, add padding-left to message
    // Called throughout

    if (typeof opt === 'undefined') {
        opt = {
            indent: false
        };
    }
    let para = document.createElement("p");
    para.className = "msg";
    if (opt.indent) {
        para.classList.add("pl-2");
    }
    let txnd = document.createTextNode(msg);
    para.appendChild(txnd);
    msgDiv.appendChild(para);
    return;
}

// remvAllMsg removes all messages from the msgs div
//
function remvAllMsg(msgDiv) {
    // Remove all messages in the #msgs div
    // Called throughout

    while (msgDiv.firstChild) {
        msgDiv.removeChild(msgDiv.lastChild);
    }
}

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
//function NewDays(yyyy, msgDiv, singleDate) {
function NewDays(yyyy, msgDiv) {
    // Input: year (yyyy) of dates being processed
    // Returns true if there are inserts or updates to be processed, false otherwise
    // Segment the year's table HTML (~/Sites/NYT Recipes/yyyy/index.html) by day
    // Determine if each day's segment is new or if it's an update

    //console.log("NewDays entered with " + yyyy + " singleDate: " + singleDate);
    console.log("NewDays entered with " + yyyy);

    function back2NL(idx) {
        // Called from NewDays
        // Input: index of <tr> element
        // Returns: index following the new line procedding the input <tr> element
        // Back up from the <tr> element looking for CRLF or LF or CR

        let nl_index = -1;
        let nl_look = idx;
        while (nl_index < 0) {
            nl_look = nl_look - 2;
            nl_index = table.substring(nl_look,idx).search(/\r\n|\n|\r/);
        }
        nl_index = nl_look + nl_index;
        let nl_str = table.substr(nl_index,nl_index+3).match(/\r\n|\n|\r/);
        return nl_index + nl_str[0].length;
    }
    
    function add_class(mk) {
        // Called from NewDays
        // Input: table HTML
        // Returns:  updated table HTML
        // In the first table row, add a class name to each of the three <td> elements
        // This is needed because of the addition of the Month order fuction.  Should not be needed after 2020

        if (mk.includes("class=")) {  // Exit if the table HTML already contains class names
            return mk;
        }
        var idx = 0;
        let classes = ["date", "type", "name"]
        for (let i = 0; i <= 2; ++i) {
            let class_insert = ' class="' + classes[i] + '"';
            idx = mk.indexOf("<td",idx) + 3;
            mk = mk.slice(0,idx).concat(class_insert,mk.slice(idx));
            idx += 3;
        }
        return mk;
    }

    function find_content(day) {
        // Input: Table HTML for one day, extracted from index.html
        // Returns: true or false
        // Determine whether a day's table HTML has content, i.e. contains
        //  a link that is not a link to a Today's Paper page.  
        //  Return true if so, false if otherwise.
    
        let gotContent = false; // return value, defaults to false
    
        // Split the day's table HTML at '<a' and '</a'
        // The resulting array elements alternate between irrelevant strings and 
        //   <a> attributes (including href), i.e.:
        //   [irrelevant, <a> attributes, irrelevant, <a> attributes, ...]
        // If the day's tab;e HTML does not contain any <a> elements, the resulting
        //   array is [irrelevant]
        let a_attrs = day.split(/<\/*a/g);
    
        // For each <a> attribute element ...
        for (let i = 1; i < a_attrs.length; i = i + 2) {
            // console.log(i.toString() + ": " + a_attrs[i]);
            if (!a_attrs[i].includes('/todayspaper/')) {  // ... look for todayspaper
                gotContent = true; // not found, then the day has content
                break; // break out of for loop
            }
        }
        // console.log(gotContent)
        return gotContent;
    }

    function distill (markup) {
        // Distill table HTML into an array of text strings

        // Input: table HTML, i.e. <tr> and <td> elements
        // Output: [string, string, …] where string is the concatenated text of the <td> elements
        //          belonging to a <tr> element, stripped of whitespace and 
        //          with 'http:' replaced with 'https:'

        const prefix = '<table>'        // prepend to markup
        const suffix = '</table>'       // append to markup

        // Create a Cheerio query function based on the input table HTML
        let $ = cheerio.load(prefix + markup + suffix);

        // Get a Cheerio array of table rows
        const rows = $('tr');

        // Initialize output array
        let text = [];

        rows.each(function() {
            // For each row,

            // Get its <td> elements
            let tds = $('td', this);

            // rowText will be a concatenation of each <td> element's text
            let rowText = '';

            tds.each(function() {
                // For each <td> element, 

                // Get its text, remove whitespace, replace 'http' and concatenate 
                //  the result to rowText
                rowText += $(this).html().replace(/\s+/g, '').replace('http:', 'https:');
            })

            // Append the row's concatenated text to the output array
            text.push(rowText);
        })

        // return [row text, row text, ...]s
        return text;
    }
    
    // Read the year's table HTML
    const tablePath = '/Users/rahiggins/Sites/NYT Recipes/' + yyyy + '/index.html';
    const table = fs.readFileSync(tablePath, "UTF-8").toString();
    
    var date_indices = [];
    var tr = 0;
    var date_index = 0;
    var start = 0;
    var tbody_end_index = 0;
    var tbody_end_row_index = 0;
    var dates = table.match(/\d{2}\/\d{2}\/\d{4}/g);    // Array of date (mm/dd/yyyy) strings in table HTML
    
    const end = table.length;
    
    // Scan the table HTML for 'mm/dd/yyyy' strings until </tbody> is encountered
    // Find the index of the start of the line containing the <tr> element preceeding the 'mm/dd/yyy' string
    // Push that index onto the date_indices array
    TableScan: while (start < end){
        date_index = table.substr(start).search(/\d{2}\/\d{2}\/\d{4}/);
        if (date_index > 0) {
            date_index = date_index + start;
            start = date_index + 10;
            tr = table.lastIndexOf("<tr>",date_index);
            let date_row_index = back2NL(tr);
            date_indices.push(date_row_index);
        } else {
            tbody_end_index = table.substr(start).indexOf("</tbody>") + start;
            tbody_end_row_index = back2NL(tbody_end_index);
            date_indices.push(tbody_end_row_index);
            break TableScan;
        }
    }
    
    const last_index = date_indices.length-1;
    // const prolog = table.substring(0,date_indices[0]);
    // const epilog = table.substring(date_indices[last_index]);
    var day_markup = '';
    var keys = [];
    
    var Days_path = '/Users/rahiggins/Sites/NYT Recipes/' + yyyy + '/Days/';    // Directory containing day segments
    var insert_path = '/Applications/MAMP/htdocs/inserts/'; // Directory containing day segments to be inserted 
    var update_path = '/Applications/MAMP/htdocs/updates/'; // Directory containing day segments for update
    const newLineChars = '\n\r';

    // Function return value defaults to false
    let callInsert = false;

    // Segment table HTML by day
    for (let i = 0; i < last_index; i++) {
        day_markup = table.substring(date_indices[i],date_indices[i+1]);
        
        if (find_content(day_markup)) {
            // If this day's segment has content (links to other than Today's Paper):
            //  See if a segment for the day already exists in Days_path
            //  If a segment already exists, see if they're identical
            //  If they're not identical, add the new segment to update_path
            //  If a segment for the day doesn't already exist in Days_path,
            //    add it to Days_path and to insert_path
            //  If a segment was added to update_path or insert_path, 
            //    set callInsert to true

            // Add class names to first row's <td> elements
            day_markup = add_class(day_markup);

            // Remove '<meta charset="utf-8">' lines added when HTML is pasted in BlueGriffon
            day_markup = day_markup.replace(/(\r\n|\n|\r)\s+<meta charset="utf-8">(\r\n|\n|\r)\s+/g, ' ');

            keys = dates[i].split("/"); // Split date into [mm, dd, yyyy]
            var file_name = keys[2] + "-" + keys[0] + "-" + keys[1] + ".txt";
            if (fs.existsSync(Days_path + file_name)) {
                // The day's table HTML already exists in the Days folder
                // console.log(file_name + " exists");
                const existing = fs.readFileSync(Days_path + file_name, "UTF-8").toString();
                if (existing == day_markup) {
                    // The previously stored table HTML is identical to the generated table HTML
                    console.log("Both " + file_name + " are the same");
                } else {
                    // The previously stored table HTML differs from the generated table HTML.
                    //  See if the difference is only in whitespace or 'http' instead of 'https'.
                    //  Try both a fancy 'distill' comparison and a simple replacement comparison
                    console.log("Both " + file_name + " are not the same");
                    var diff = true;
                    if (JSON.stringify(distill(existing)) === JSON.stringify(distill(day_markup))) {
                        console.log("Distilled " + file_name + " are equal")
                        var diff = false;
                    }
                    if (existing.replace(/\s+/g, '').replace('http:', 'https:') == day_markup.replace(/\s+/g, '').replace('http:', 'https:')) {
                        console.log("Simple whitespace stripped " + file_name + " are equal")
                        var diff = false;
                    }
                    // Used to have a problem with BlueGriffon changing newline codes. This probably isn't needed any more
                    // var diff = false;
                    // if (existing.length == day_markup.length) {
                    //     var scanLength = day_markup.length;
                    //     var misMatch = false;
                    //     for (var j = 0; j < scanLength; j++) {                            
                    //         if (existing[j] !== day_markup[j]) {
                    //             if (newLineChars.includes(existing[j]) && newLineChars.includes(day_markup[j])) {
                    //                 console.log("Newline mismatch at " + j.toString() + " for " + file_name);
                    //                 misMatch = true;                                
                    //             } else {
                    //                 diff = true;
                    //                 break;
                    //             }
                    //         } 
                    //     }
                    //     if (misMatch) {
                    //         fs.writeFileSync(Days_path + file_name, day_markup, "utf8");
                    //         console.log(file_name + " replaced in Days");
                    //     }
                    // } else {
                    //     diff = true;
                    // }
                    
                    if (diff) {
                        console.log(file_name + " differs, added to updates")

                        // Existing day file has changed
                        addMsg(msgDiv, file_name + " differs, added to updates", {indent: true});

                        // Existing file will be renamed to Old_file
                        let oldName = "Old_" + file_name;

                        // If Old_file already exists, delete it
                        if ((fs.existsSync(Days_path + oldName))) {
                            fs.unlinkSync(Days_path + oldName);
                        }
                        // Rename existing file to Old_file
                        fs.renameSync(Days_path + file_name, Days_path + oldName);

                        // Write updated file to Days
                        fs.writeFileSync(Days_path + file_name, day_markup, "utf8");

                        // Write updated file to updates
                        fs.writeFileSync(update_path + file_name, day_markup, "utf8");

                        // Set flag to call insert.php
                        callInsert = true;
                    }
                }
    
            } else {
                addMsg(msgDiv, file_name + " added to inserts", {indent: true});
                fs.writeFileSync(Days_path + file_name, day_markup, "utf8");
                fs.writeFileSync(insert_path + file_name, day_markup, "utf8");
                callInsert = true;
            }
        }
    }

    // Exit from NewDays
    if (!callInsert) {

        // No inserts or updates
        addMsg(msgDiv, "None", {indent: true});
    }
    return callInsert;
}

// Insert invokes the MAMP insert.php script to update the local MySQL database.
//
// Insert creates a listener for the closing of the window used to run
//  insert.php.
//
// Insert sends a message to the index.js process to cause it to run insert.php.
//
function Insert(msgDiv) {
        // Create listener for insert-closed message from index.js
        ipcRenderer.on('insert-closed', () => {
            // Window for insert.php was closed
            console.log("insert window closed");
            remvAllMsg(msgDiv);
            let msg = "Finished";
            addMsg(msgDiv, msg);
        })
        // Tell index.js to create a new window to run the insert.php script, which performs MySQL inserts and updates
        ipcRenderer.send('invoke-insert', 'insert');
}

module.exports = { addMsg, remvAllMsg, NewDays, Insert };