// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Code structure:
//
//   Mainline
//    Launch Puppeteer
//    EventListener handler for Start button
//      For each date to be processed 
//      |  Call TPscrape
//      |    Call sectionScrape
//      |    For each article in section
//      |      Call artScrape
//      |  Call addArticles
//      |_ Call processGo
//      Call updateIndexHTML
//      Call processNewDays
//      Listen for reply from index.js process
//      Send invoke-insert to index.js process

const { app } = require('electron').remote  // Access to app information
const { ipcRenderer } = require('electron') // InterProcess Communications
const Moment = require("moment");       // Date/time functions
const fs = require('fs');               // Filesystem functions
const puppeteer = require('puppeteer'); // Chrome API
const needle = require('needle');       // Lightweight HTTP client
const $ = require('cheerio');           // core jQuery

const appDataPath = app.getPath("appData") + "/" + app.getName();
const lastDateFile = appDataPath + "/LastDate.txt"
console.log("appDataPath: " + appDataPath);
const output = "/Users/rahiggins/Sites/NYT Recipes/newday.txt"; // Table HTML generated
fs.writeFileSync(output, "");   // Erase any existing output

const URLStart = 'https://www.nytimes.com/issue/todayspaper/';
const URLWed = '/todays-new-york-times#food';
const URLSun = '/todays-new-york-times#magazine';
const today = Moment();
var url;
var MDY;    // MM/DD/YYYY
var YMD;    // YYYY/MM/DD
var Day;    // Sunday | Wednesday
var sect;   // Magazine | Food
var dateRowHTML = '';    // Table HTML for date row
var browser;    // Puppeteer browser
var page;       // Puppeteer page

const aL = document.getElementById('aL');       // article list div
const mL = document.getElementById('msgs');     // messages list div

launchPup();    // Launch Puppeteer

// Function definitions

async function launchPup () {
    // Launch Puppeteer and create a page
    // Called from Mainline
    console.log("launchPup: entered");
    browser = await puppeteer.launch();
    page = await browser.newPage();
    //await page.setDefaultNavigationTimeout(0);
    page.setDefaultNavigationTimeout(0);
    console.log("launchPup: exiting");
}

function addMsg(m, opt) {
    // Add a message to the #msgs div
    // Called throughout
    if (typeof opt === 'undefined') {
        opt = {
            indent: false
        };
    }
    let para = document.createElement("p");
    if (opt.indent) {
        para.className = "pl-2";
    }
    let txnd = document.createTextNode(m);
    para.appendChild(txnd);
    mL.appendChild(para);
    return;
}

function remvAllMsg() {
    // Remove all messages in the #msgs div
    // Called throughout
    while (mL.firstChild) {
        mL.removeChild(mL.lastChild);
    }
}

function addProgress(now,max) {
    // Called from sectionScrape
    // Input:   now - number of articles retrieved
    //          max - number of articles to be retrieved
    // return a progress bar element
    let prog = document.createElement("progress");
    prog.id = "artProg";
    prog.classList = " progress float-left";
    prog.style.paddingTop = "28px"; // aligns progress bar with adjacent text, derived empirically
    prog.max = max;
    prog.value = now;
    return prog;
}

async function TPscrape(url) {
    // Called from Mainline
    // Input is URL of Today's Paper section
    // Retrieve Today's Paper page
    // Call sectionScrape to extract articles from Todays Paper section {Wednesday: food, Sunday: magazine}
    // For each article, call artScrape to scrape article for title and recipes
    // and return array of article objects = [ {title:, author:, href:, hasRecipes, html:}, ...]

    console.log("TPscrape: entered for " + url)
    var anch = url.split("#");  // ["Today's Paper url", "section name"]
    var prot;
    var hostnm;
    // Add activity description to index.html
    let msg = "Retrieving Today's Paper page for " + Day + ", " + MDY;
    addMsg(msg);

    async function artScrape(url) {
        // Called from sectionScrape
        // Input is article URL
        // Retrieve article page and scrape:
        //   - presence of And to Drink
        //   - article title decoration
        //   - article title
        //   - article recipes
        // Form table HTML for article title and recipes
        // Return { hasRecipes:, html: }
        let title;
        let arttype;
        let ATD_present;
        let h2s;
        let recipeList = [];
    
    
        function getTitle(html) {
            // Called from artScrape
            // Input is article page HTML
            // Sets variables h2s, ATD_present, arttype, title
    
            // See if And to Drink is present
            ATD_present = "";
            h2s = $('h2.eoo0vm40', html); // h2s also referenced in recipes()
            $(h2s).each(function() {
                if ($(this).text().includes("And to Drink")) {
                    ATD_present = " *";
                    //console.log("And to Drink found");
                    return false; // Exit loop
                }
            });
    
            //var h2a = $(h2s).has("a");
            //console.log("h2s: " + h2s.length.toString());
            //console.log("h2 w/a: " + h2a.length.toString());
    
            // Check for title decoration (e.g. "Eat", "A Good Appetite", "Wines of the Times", "Spirits of the Times", "Ales of the Times")
            //  and adjust "article" designation (table column 2)
            arttype = "article";
            //console.log("xOfTimes(.e6idgb70): " + $(".e6idgb70", html).length.toString());
            $(".e6idgb70", html).each(function() {
                if ($(this).text().length > 0) {
                    //console.log("e6idgb70 text: " + $(this).text());
                    arttype = $(this).text().split(/ OF THE TIMES/i)[0].toLowerCase();
                    if (arttype == "eat" || arttype == "a good appetite") {arttype = "article"}
                    if (arttype == "wines") {arttype = "wine"}
                }
            })
    
            // Get title - first Heading 1
            let titles = $('h1', html);
            //console.log("Titles: " + titles.length.toString());
            title = $(titles[0]).text();
            //console.log("title: " + title);
            //console.log("arttype: '" + arttype + "'");
    
        }
    
        function getRecipes(html) {
            // Called from artScrape
            // Input is article page HTML
            // Creates recipeList array [{name:, link:} ...]
    
            let noRecipes = true;
            let recipes = false;
    
            // For <p> elements including text "Recipes:", "Recipe:", "Pairing:"
            //  create recipe objects {name: , link:} from <a> elements 
            //  and push onto recipeList array
            $("p.evys1bk0", html).each(function() {
                let p_text = $(this).text();
                if (p_text.includes("Recipe:") || p_text.includes("Recipes:") || p_text.includes("Pairings:")) {
                    noRecipes = false;  // Typical recipes were found, so noRecipes is false
                    recipes = true;     // Recipes were found
                    //console.log("Recipes found");
                    $("a", $(this)).each(function() {
                        let recipe = {
                            name: $(this).text(),
                            link: $(this).attr("href")
                        }
                        //console.log(recipe);
                        recipeList.push(recipe)
                    })
                }
            })
            
            if (noRecipes) {
                // If no typical recipes were found,
                //  look for Heading 2 elements that have an <a> element referencing cooking.nytimes.com and
                //  create recipe objects {name: , link:} from them and
                //  push onto recipeList array
                $(h2s).has("a").each(function () {
                    let artHref =  $("a", this).attr("href")
                    if (artHref.includes("cooking.nytimes.com")) {
                        //console.log("Alternate recipes found");
                        recipes = true;
                        recipe = {
                            name: $("a", this).text(),
                            link: artHref
                        }
                        //console.log(recipe);
                        recipeList.push(recipe)
                    }
                })
            }
            return recipes;
        }
    
        // Retrieve article page
        const resp = await needle("get", url);
        let html = resp.body;
    
        getTitle(html);    // Get arttype, title and ATD_present
        // Create article table row
        let tableHTML = "";
        tableHTML = tableHTML + "              <tr>\n                <td><br>\n                </td>\n                <td>" + arttype + "<br>\n";
        tableHTML = tableHTML + '                </td>\n                <td><a href="';
        tableHTML = tableHTML + url + '">' + title + "</a>" + ATD_present + "</td>\n              </tr>\n";
    
        let hasRecipes = getRecipes(html);  // Get recipes
        // Create recipe table rows
        for (i in recipeList) {
            tableHTML = tableHTML + "              <tr>\n                <td><br>\n                </td>\n                <td>recipe<br>\n";
                    tableHTML = tableHTML + '                </td>\n                <td><a href="';
                    tableHTML = tableHTML + recipeList[i].link + '">' + recipeList[i].name + "</a></td>\n              </tr>\n";
        }
        console.log("artScrape: exiting for " + url);
        //console.log("artScrape: output hasRecipes: " + hasRecipes);
        //console.log("artScrape: output html: " + tableHTML);
        return {
            hasRecipes: hasRecipes,
            html: tableHTML
        };
    }

    async function sectionScrape(html) {
        // Called from TPscrape
        // Input is Today's Paper page HTML
        // For each article in the designated section:
        //  Create an article object {title:, author:, href:}
        //  Call artScrape to get { hasRecipes:, html:}
        //  Add hasRecipes: and html: to article object
        //  Push article object onto array of article objects
        // Return array of article objects [{title:, author:, href:, hasRecipes:, html: } ...]
        console.log("Entering sectionScrape");

        let articles = [];  // Array of article objects

        // Locate the target section (anch[1])
        let an = $("a", html).filter(function(i,el) {
            return $(this).attr("name") == anch[1];
        })
        //console.log("Number of anchors: " + an.length.toString());
        // 
        let sectionList = $(an).siblings('ol'); // ordered list following section
        //console.log("Number of lists: " + sectionList.length.toString());
        let arts = $(sectionList).children("li"); // list items (articles) of ordered list following section
        //console.log("Number of articles: " + arts.length.toString());

        // Create a float-left div
        let sectArtDiv = document.createElement("div");
        sectArtDiv.className = "float-left";

        // Create a "Retrieving n ... articles" <p> element
        let para = document.createElement("p");
        para.classList = "pr-2 float-left";
        let txt = "Retrieving " + arts.length.toString() + " " +sect + " section articles for " + Day + ", " + MDY;
        let txnd = document.createTextNode(txt);
        para.appendChild(txnd);

        // Add "Retrieving n ... articles" element and a progress bar to the float-left div
        sectArtDiv.appendChild(para);
        sectArtDiv.appendChild(addProgress(0,arts.length));

        // Remove the "Retrieving Today's Paper" message and add the float-left div to the messages div
        mL.removeChild(mL.lastChild);
        mL.appendChild(sectArtDiv);


        for (let a = 0; a < arts.length; a++) {  
            // for each article, collect title, author and link href
            let link = $(arts[a]).find("a");
            let h2 = $(link).find("h2");
            //console.log($(h2).text());
            //console.log(prot + "://" + hostnm + $(link).attr("href"));
            let author = $(arts[a]).find("span.css-1n7hynb")
            //console.log("Author: " + author.text());
            let artObj = {  // create an article object
                title: $(h2).text(),
                author: $(author).text(),
                href: prot + "//" + hostnm + $(link).attr("href")
            };
            let aTH = await artScrape(artObj.href);
            artObj.hasRecipes = aTH.hasRecipes;
            artObj.html = aTH.html;
            //console.log("sectionScrape: artObj: " + JSON.stringify(artObj));
            articles.push(artObj);
            sectArtDiv.removeChild(sectArtDiv.lastChild);           // Remove the progress bar
            sectArtDiv.appendChild(addProgress(a+1,arts.length));   // and add an updated one

        }
        //console.log(articles);
        // return array of article objects
        mL.removeChild(mL.lastChild);   // Remove sectArtDiv 
        console.log("Exiting sectionScrape");
        return articles;
    }

    // Add a throbber icon while retrieving the Today's Paper page
    // let aL = document.getElementById('aL');
    let loadingDiv = document.createElement('div');
    loadingDiv.className = "loading loading-lg col-3";
    loadingDiv.id = "lD";
    aL.appendChild(loadingDiv);

    // Go to Today's Paper page via puppeteer
    await page.goto(anch[0]);
    // Get location protocol and host name for use in artScrape function
    let url_parts = await page.evaluate(() => {
        let results = [];
        results.push(window.location.protocol);
        results.push(window.location.host);
        return results;
    })
    prot = url_parts[0];
    hostnm = url_parts[1];
    // console.log("url_parts: " + prot + " " + hostnm);
    // Retrieve page html and call sectionScrape to extract articles
    const html = await page.content();
    let scrape = await sectionScrape(html);
    //console.log("TPscrape: sectionScrape output - " + JSON.stringify(scrape[0]));
    //console.log(scrape)
    console.log("TPscrape: exiting  for " + url)
    return scrape;  // array of article objects - [{title:, author:, href:, hasRecipes:, html:}, ...]
}

function addArticles(arr) {
    // Called from Mainline
    // Input is array of article objects returned by TPscrape
    // Add checkboxes for articles returned by TPscrape to index.html
    // Add a button labeled "Go" to index.html

    console.log("addArticles: entered with: "+ arr);

    let stringI;
    let lbl;
    let checkbox;
    let iicon;
    let cb_title;
    let cb_author;
    
    // Remove Retrieving... msg and add {Magazine|Food} articles description to index.html
    let msg = sect + " section articles for " + Day + ", " + MDY;
    addMsg(msg);

    // Remove throbber
    let element = document.getElementById("lD");
    element.parentNode.removeChild(element);

    // Add a checkbox for each article to index.html
    for (i in arr) {

        stringI = i.toString();

        lbl = document.createElement('label');
        lbl.className = "form-checkbox";

        checkbox = document.createElement('input');
        checkbox.type = "checkbox";
        if (arr[i].hasRecipes) {
            checkbox.checked = true;
        }
        checkbox.name = "cbn" + stringI;
        checkbox.value = stringI;
        checkbox.id = "cbi" + stringI;

        iicon = document.createElement('i');
        iicon.className = "form-icon";

        cb_title = document.createElement('div');
        cb_title.innerText = arr[i].title;

        cb_author = document.createElement('div');
        cb_author.classList = 'text-gray author';
        cb_author.innerText = "by " + arr[i].author;

        lbl.appendChild(checkbox);
        lbl.appendChild(iicon);
        lbl.appendChild(cb_title);
        lbl.appendChild(cb_author);
        aL.appendChild(lbl);
    }

    console.log("addArticles: exit")
    return;

}


async function processGo (arr) {
    // Called from Mainline
    // Input is array of article objects returned by TPscrape
    // Add event listener, wrapped in a Promise, for the submit button that was added by addArticles
    // Return Promise to Mainline
    //
    // On click of submit button, for each checked article:
    //  write table HTML to disk
    //
    console.log("processGo: entered")
    return new Promise(function (resolve) {
        document.getElementById('aList').addEventListener('submit', async (evt) => {
            // prevent default refresh functionality of forms
            evt.preventDefault();
            console.log("processGo - Go clicked")
            let ckd = document.querySelectorAll('input:checked')    // Get checked articles
            if (ckd.length > 0){    // If any articles were checked, write date row table HTML to disk
                fs.appendFileSync(output, dateRowHTML, "utf8");
            }

            // Remove article checkboxes and submit button
            while (aL.firstChild) {
                aL.removeChild(aL.lastChild);
            }
            // Remove "Retrieving n articles" msg
            mL.removeChild(mL.lastChild);


            // For each article, table HTML to disk
            for (j = 0; j < ckd.length; j++) {
                let artHTML = arr[parseInt(ckd[j].value)].html;
                fs.appendFileSync(output, artHTML);
            }
            console.log("processGo: resolving")
            resolve();  // Resolve Promise
        },  {once: true});  // AddEventListener option - removes event listener after click
    });    
}

function updateIndexHTML (dates) {
    // Called from Mainline
    // Input: [Moment(first date), Moment(last date)]
    // Returns: true if update performed, false otherwise
    // Replace empty table rows in ~/Sites/NYT Recipes/yyyy/index.html corresponding with new days' table HTML
    let year = dates[0].format("YYYY")
    const tablePath = '/Users/rahiggins/Sites/NYT Recipes/' + year + '/index.html';
    const table = fs.readFileSync(tablePath, "UTF-8").toString();       // Read year page
    const newTableHTML = fs.readFileSync(output, "UTF-8").toString();   // Read new table HTML created by this app
    let tableLastIndex = table.length-1;

    // Find beginning date
    console.log("Finding start of replace")
    let startDateIndex = table.indexOf(dates[0].format("MM/DD/YYYY"));
    if (startDateIndex == -1) {
        console.log("updateIndexHTML: first date " + dates[0].format("MM/DD/YYYY") + " not found in index.html")
        return false;
    }
    //console.log("startDateIndex: " + startDateIndex.toString());

    // Find the </tr> or <tbody> preceeding the first date
    let trEndLength = 5;
    let trEndBeforeStartDateIndex = table.lastIndexOf("</tr>", startDateIndex);
    if (trEndBeforeStartDateIndex == -1) {
        trEndLength = 7;
        trEndBeforeStartDateIndex = table.lastIndexOf("<tbody>", startDateIndex);
    }
    if (trEndBeforeStartDateIndex == -1) {
        console.log("updateIndexHTML: unable to find </tr> or <tbody> preceding " + dates[0].format("MM/DD/YYYY"));
        return false;
    }
    console.log("trEndBeforeStartDateIndex: " + trEndBeforeStartDateIndex.toString());

    // Find the newline character between the </tr>|<tbody> element and the beginning date
    let nlAfterTrEndBeforeStartDateIndexIndex = table.substr(trEndBeforeStartDateIndex,trEndLength+2).search(/\r\n|\n|\r/);
    if (nlAfterTrEndBeforeStartDateIndexIndex == -1) {
        console.log("updateIndexHTML: unable to find newline following trEndBeforeStartDateIndex");
        return false;
    }
    //console.log("nlAfterTrEndBeforeStartDateIndexIndex: " + nlAfterTrEndBeforeStartDateIndexIndex.toString())

    // The index following the newline character(s) is where the replacement starts
    let nlAfterTrEndBeforeStartDateIndex = table.substr(trEndBeforeStartDateIndex + nlAfterTrEndBeforeStartDateIndexIndex,2).match(/\r\n|\n|\r/);
    //console.log("nlAfterTrEndBeforeStartDateIndex: " + nlAfterTrEndBeforeStartDateIndex.toString())
    let replaceStartIndex = trEndBeforeStartDateIndex + nlAfterTrEndBeforeStartDateIndexIndex + nlAfterTrEndBeforeStartDateIndex[0].length;
    //console.log("updateIndexHTML: replaceStartIndex: " + replaceStartIndex.toString());

    // Find the ending date
    let endDateIndex = table.indexOf(dates[1].format("MM/DD/YYYY"));
    if (endDateIndex == -1) {
        console.log("updateIndexHTML: last date " + dates[1].format("MM/DD/YYYY") + " not found in index.html")
        return false;
    }
    console.log("endDateIndex: " + endDateIndex.toString());

    // Find the date following the ending date or </tbody>
    let nextDateAfterEndDateIndex = table.substr(endDateIndex+10).search(/\d\d\/\d\d\/\d\d\d\d/);
    console.log("nextDateAfterEndDateIndex search result: " + nextDateAfterEndDateIndex.toString());
    if (nextDateAfterEndDateIndex == -1) {
        nextDatefterEndDateIndex = table.indexOf("</tbody", endDateIndex);
        console.log("nextDateAfterEndDateIndex indexOf result: " + nextDateAfterEndDateIndex.toString());
        if (nextDateAfterEndDateIndex == -1) {
            console.log("updateIndexHTML: unable to find MM/DD/YYYY or </tbody following " + dates[1].format("MM/DD/YYYY"));
            return false; 
        }
    } else {
        nextDateAfterEndDateIndex = nextDateAfterEndDateIndex + endDateIndex + 10;
    }
    console.log("updateIndexHTML: MM/DD/YYYY or </tbody following " + dates[1].format("MM/DD/YYYY") + ": " + nextDateAfterEndDateIndex.toString());

    // Find the </tr> element preceeding the next date or </tbody>
    let trEndBeforeNextDateAfterEndDateIndex = table.lastIndexOf("</tr>", nextDateAfterEndDateIndex);
    if (trEndBeforeNextDateAfterEndDateIndex == -1) {
        console.log("updateIndexHTML: unable to find </tr> preceding MM/DD/YYYY or </tbody");
        return false;
    }
    console.log("updateIndexHTML: trEndBeforeNextDateAfterEndDateIndex: " + trEndBeforeNextDateAfterEndDateIndex.toString());

    // Find the newline character(s) follow the </tr> element
    let nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex = table.substr(trEndBeforeNextDateAfterEndDateIndex,7).search(/\r\n|\n|\r/);
    if (nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex == -1) {
        console.log("updateIndexHTML: unable to find newline following trEndBeforeNextDateAfterEndDateIndex");
        return false;
    }
    console.log("updateIndexHTML: (nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex: " + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex.toString());

    // The index following the newline character(s) is the replacement ends
    let nlAfterTrEndBeforeNextDateAfterEndDateIndex = table.substr(trEndBeforeNextDateAfterEndDateIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex,2).match(/\r\n|\n|\r/);
    console.log("updateIndexHTML: nlAfterTrEndBeforeNextDateAfterEndDateIndex: " + nlAfterTrEndBeforeNextDateAfterEndDateIndex.toString());
    let replaceEndIndex = trEndBeforeNextDateAfterEndDateIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex + nlAfterTrEndBeforeNextDateAfterEndDateIndex[0].length;
    console.log("updateIndexHTML: replaceEndIndex: " + replaceEndIndex.toString());
    console.log("updateIndexHTML: insert between 0-" + replaceStartIndex.toString() + " and " + replaceEndIndex.toString() + "-" + tableLastIndex.toString());

    // Replace ~/Sites/NYT Recipes/yyyy/index.html with the leading unchanged part + the new table HTML + the trailing unchanged part
    fs.writeFileSync(tablePath, table.substring(0,replaceStartIndex) + newTableHTML + table.substring(replaceEndIndex, tableLastIndex), "utf8");
    return true;
}

function NewDays(yyyy) {
    // Called from processNewDays
    // Input: year (yyyy) of dates being processed
    // Segment the year's table HTML (~/Sites/NYT Recipes/yyyy/index.html) by day
    // Determine if each day's segment is new or if it's an update
    console.log("NewDays entered with " + yyyy);

    function back2NL(idx) {
        // Called from NewDays
        // Input: index of <tr> element
        // Returns: index following the new line procedding the input <tr> element
        // Back up from the <tr> element looking for CRLF or LF or CR
        var nl_index = -1;
        var nl_look = idx;
        while (nl_index < 0) {
            nl_look = nl_look - 2;
            nl_index = table.substring(nl_look,idx).search(/\r\n|\n|\r/);
        }
        nl_index = nl_look + nl_index;
        nl_str = table.substr(nl_index,nl_index+3).match(/\r\n|\n|\r/);
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
        classes = ["date", "type", "name"]
        for (let i = 0; i <= 2; ++i) {
            let class_insert = ' class="' + classes[i] + '"';
            idx = mk.indexOf("<td",idx) + 3;
            mk = mk.slice(0,idx).concat(class_insert,mk.slice(idx));
            idx += 3;
        }
        return mk;
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
            date_row_index = back2NL(tr);
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

    // Segment table HTML by day
    for (let i = 0; i < last_index; i++) {
        day_markup = table.substring(date_indices[i],date_indices[i+1]);
        
        if (day_markup.includes("article") || day_markup.includes("recipe")) {
            // If this day's segment has content (articles or recipes):
            //  See if a segment for the day already exists in Days_path
            //  If a segment already exists, see if they're identical
            //  If they're not identical, add the new segment to update_path
            //  If a segment for the day doesn't already exist in Days_path,
            //    add it to Days_path and to insert_path
            day_markup = add_class(day_markup); // add class names to first row's <td> elements
            keys = dates[i].split("/"); // Split date into [mm, dd, yyyy]
            var file_name = keys[2] + "-" + keys[0] + "-" + keys[1] + ".txt";
            if (fs.existsSync(Days_path + file_name)) {
                // console.log(file_name + " exists");
                const existing = fs.readFileSync(Days_path + file_name, "UTF-8").toString();
                if (existing == day_markup) {
                    // console.log("Both " + file_name + " are the same");
                } else { // Used to have a problem with BlueGriffon changing newline codes. This probably isn't needed any more
                    var diff = false;
                    if (existing.length == day_markup.length) {
                        var scanLength = day_markup.length;
                        var misMatch = false;
                        for (var j = 0; j < scanLength; j++) {
                            if (existing[j] !== day_markup[j]) {
                                if (newLineChars.includes(existing[j]) && newLineChars.includes(day_markup[j])) {
                                    console.log("Newline mismatch at " + j.toString() + " for " + file_name);
                                    misMatch = true;                                
                                } else {
                                    diff = true;
                                    break;
                                }
                            } 
                        }
                        if (misMatch) {
                            fs.writeFileSync(Days_path + file_name, day_markup, "utf8");
                            console.log(file_name + " replaced in Days");
                        }
                    } else {
                        diff = true;
                    }
                    if (diff) {
                        addMsg(file_name + " differs, added to updates", {indent: true});
                        fs.writeFileSync(Days_path + "NotSame_" + file_name, day_markup, "utf8");
                        fs.writeFileSync(update_path + file_name, day_markup, "utf8");
                    }
                }
    
            } else {
                addMsg(file_name + " added to inserts", {indent: true});
                fs.writeFileSync(Days_path + file_name, day_markup, "utf8");
                fs.writeFileSync(insert_path + file_name, day_markup, "utf8");
            }
        }
    }
}

async function processNewDays (yyyy) {
    // Called from Mainline
    // Input: year being processed - yyyy
    // Listen for click on "Continue" button
    //  Call NewDays(yyyy) to extract new and updated days' table rows from /NYT Recipes/yyyy/index.html
	console.log("processNewDays: entered");
   	return new Promise(function (resolve) {
		document.getElementById('aList').addEventListener('click', async (evt) => {
            evt.preventDefault();
            remvAllMsg();
            aL.removeChild(aL.lastChild)
            addMsg("New and updated days:");
			NewDays(yyyy);
			resolve();  // Resolve Promise
        	},  {once: true});
   	});    
}

// Mainline
// Add EventListener for Start button
document.getElementById("startButton").addEventListener("click", async (evt) => {
    // After Start click:
    evt.preventDefault();
    let datesToProcess = []; // array of dates (Moment objects) to process
    let saveLastDate = false;   // Save LastDate.txt only if datesToProcess were automatically generated
    let msg;
    // Check if a date was entered
    let enteredDate = document.getElementById("dateSpec").value;
    if (enteredDate == "") {
        // If no date was entered, get the last processed date and 
        //  calculate the days to be processedlastDateFile
        let lastDate = Moment(fs.readFileSync(lastDateFile, "utf8"), "MM-DD-YYYY");
        if (lastDate.day() == 0) {  // If last was Sunday,
            bumps = [3, 4];         //  next is Wednesday (+3), then Sunday (+4)
        } else {                    // If last was Wednesday,
            bumps = [4, 3];         //  next is Sunday (+4), then Wednesday (+3)
        }
        const swtch = [1, 0];       // bumps toggle
        let s = 0;
        let nextDate = lastDate.add(bumps[s], 'days');  // nextDate after LastDate processed
        while (nextDate <= today) {
            datesToProcess.push(Moment(nextDate));  // Moment() clones nextDate
            s = swtch[s];
            nextDate = nextDate.add(bumps[s], 'days');  // Increment nextDate
        }
        if (datesToProcess.length > 0) {
            saveLastDate = true;
        }
    } else {
        // Otherwise, process only the entered date
        datesToProcess.push(Moment(enteredDate, 'MM-DD-YYYY'));
    }

    let datesToProcessRange = [];
    if (datesToProcess.length > 0) {
        datesToProcessRange = [datesToProcess[0], datesToProcess[datesToProcess.length-1]];
        console.log("datesToProcessRange: " + datesToProcessRange[0].format("MM/DD/YYYY") + ", " + datesToProcessRange[1].format("MM/DD/YYYY"));
    }

    // if (datesToProcess.length > 1) {
    //     msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY") + " through " + datesToProcessRange[1].format("MM/DD/YYYY");
    // } else {
    //     msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY");
    // }
    switch (datesToProcess.length) {
        case 1:
            msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY");
            break;
        case 2:
            msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY") + " and " + datesToProcessRange[1].format("MM/DD/YYYY");
            break;
        default:
            msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY") + " through " + datesToProcessRange[1].format("MM/DD/YYYY");
    }
    addMsg(msg);

    // For each date to be processed:
    let lastDateToProcess = datesToProcess.length - 1;
    for (let i = 0; i < datesToProcess.length; i++) {
        MDY = datesToProcess[i].format("MM/DD/YYYY");
        YMD = datesToProcess[i].format("YYYY/MM/DD");
        Day = datesToProcess[i].format("dddd");

        switch (Day) {
            case "Sunday":
                sect = "Magazine";
                break;
            case "Wednesday":
                sect = "Food";
                break;
            default:
                sect = "";
        }

        // Form Today's Paper URL
        url = `${URLStart}${YMD}`;
        if (Day == "Sunday") {
            url = `${url}${URLSun}`;
        } else {
            url = `${url}${URLWed}`;
        }

        // Create date table row - write to disk in processGo 
        dateRowHTML = '              <tr>\n                <td class="date"><a href="' + url + '">';
        dateRowHTML = dateRowHTML + MDY + "</a></td>\n";
        dateRowHTML = dateRowHTML + '                <td class="type"><br>\n';
        dateRowHTML = dateRowHTML + '                </td>\n                <td class="name"><br>\n';
        dateRowHTML = dateRowHTML + '                </td>\n              </tr>\n';

        // Call TPscrape to retrieve designated section articles
        console.log("Mainline: awaiting TPscrape for " + i.toString() + " " + url);
        var artsArray = await TPscrape(url);
        console.log("Mainline: returned from TPscrape for " + i.toString() + " calling addArticles");

        // Add designated section article checkboxes and Go button to index.html
        addArticles(artsArray);

        // Add a submit button to index.html
        if (i < lastDateToProcess) {
            buttonText = "Next";
        } else {
            buttonText = "Save";
        }
        let sub = document.createElement('input');
        sub.type = "submit";
        sub.value = buttonText;
        aL.appendChild(sub);

        // Add Go button EventListener and after submit, process checked articles
        console.log("Mainline: awaiting processGo");
        await processGo(artsArray);
        console.log("Mainline: returned from processGo");

        // Repeat for next date to be processed
    }

    // Store LastDate processed
    remvAllMsg();
    if (saveLastDate) {
        fs.writeFileSync(lastDateFile, MDY, "utf8");
    }

    // Add new table rows to ~/Sites/NYT Recipes/{yyyy}/index.html
    if (datesToProcessRange.length > 0) {
        if (updateIndexHTML(datesToProcessRange)) {
            console.log("index.html updated")
        } else {
            console.log("problem updating index.html")
        }
    }

    // Add "Review ..." message and a submit button to index.html
    msg = "Review NYT Recipe index.html, then click Continue";
    addMsg(msg);
    
    let sub = document.createElement('input');
    sub.id = "continueButton";
    sub.type = "submit";
    sub.value = "Continue";
    aL.appendChild(sub);

    // When "Continue" submitted, look for new and changed days
    console.log("Mainline: awaiting processNewDays");
    await processNewDays(datesToProcessRange[0].format("YYYY"));
    console.log("Mainline: returned from processNewDays");

    // Create listener for insert-closed message from index.js
    ipcRenderer.on('insert-closed', (event, arg) => {
        console.log("insert window closed");
        remvAllMsg();
        msg = "Finished";
        addMsg(msg);
        // Close puppeteer browser
        browser.close();
    })

    // Tell index.js to run insert php script
    ipcRenderer.send('invoke-insert', 'insert');

});