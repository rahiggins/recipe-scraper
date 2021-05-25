// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Epochs version

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
//      |_ Call processSelectedArticles
//      Call updateIndexHTML
//      Call processNewDays
//      Listen for reply from index.js process
//      Send invoke-insert to index.js process

const { addMsg, remvAllMsg, NewDays, Insert } = require('./lib.js'); // Shared scraper functions
const { ipcRenderer } = require('electron'); // InterProcess Communications
const Moment = require('moment'); // Date/time functions
const fs = require('fs'); // Filesystem functions
const puppeteer = require('puppeteer'); // Chrome API
const needle = require('needle'); // Lightweight HTTP client
const cheerio = require('cheerio'); // core jQuery

var newTableHTML = ''; // Generated table HTML is appended to this
const NYTRecipes_path = '/Users/rahiggins/Sites/NYT Recipes';

const URLStart = 'https://www.nytimes.com/issue/todayspaper/';  // Today's Paper URL prefix
const URLWed = '/todays-new-york-times#food';       // Today's Paper URL Wednesday suffix
const URLSun = '/todays-new-york-times#magazine';   // Today's Paper URL Sunday suffix
//const today = Moment();
var url;
var MDY;    // MM/DD/YYYY
var YMD;    // YYYY/MM/DD
var Day;    // Sunday | Wednesday
var sect;   // Magazine | Food
var dateRowHTML = '';    // Table HTML for date row
var browser;    // Puppeteer browser
var page;       // Puppeteer page
var articleClick;   // Click event handler function, defined and added in articleListen function, removed in processSelectedArticles function.
var startButton;    // Start button element

const aL = document.getElementById('aL');       // article list div
const mL = document.getElementById('msgs');     // messages list div

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

// function addMsg(m, opt) {
//     // Add a message to the #msgs div
//     // If opt { indent: true }, add padding-left to message
//     // Called throughout
// 
//     if (typeof opt === 'undefined') {
//         opt = {
//             indent: false
//         };
//     }
//     let para = document.createElement("p");
//     if (opt.indent) {
//         para.className = "pl-2";
//     }
//     let txnd = document.createTextNode(m);
//     para.appendChild(txnd);
//     mL.appendChild(para);
//     return;
// }
// 
// function remvAllMsg() {
//     // Remove all messages in the #msgs div
//     // Called throughout
// 
//     while (mL.firstChild) {
//         mL.removeChild(mL.lastChild);
//     }
// }

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
    addMsg(mL, msg);

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
    
    
        function getTitle($) {
            // Called from artScrape
            // Input is a Cheerio object containing article page HTML
            // Sets variables h2s, ATD_present, arttype, title
    
            // See if And to Drink is present
            ATD_present = "";
            h2s = $('h2.eoo0vm40'); // h2s also referenced in recipes()
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
            //console.log("xOfTimes(.e6idgb70): " + $(".e6idgb70").length.toString());
            $(".e6idgb70").each(function() {
                if ($(this).text().length > 0) {
                    //console.log("e6idgb70 text: " + $(this).text());
                    arttype = $(this).text().split(/ OF THE TIMES/i)[0].toLowerCase();
                    if (arttype.trim() == "eat" || arttype.trim() == "a good appetite") {arttype = "article"}
                    if (arttype.trim() == "wines") {arttype = "wine"}
                }
            })
    
            // Get title - first Heading 1
            let titles = $('h1');
            //console.log("Titles: " + titles.length.toString());
            title = $(titles[0]).text();
            console.log("title: " + title);
            //console.log("arttype: '" + arttype + "'");
    
        }
    
        function getRecipes($) {
            // Called from artScrape
            // Input is a Cheerio object containing article page HTML
            // Creates recipeList array [{name:, link:} ...]
    
            let recipes = false;
    
            // Look for recipe links, which occur in several formats
            //  Create recipe objects {name: , link:} from <a> elements 
            //  and push onto recipeList array
            //
            // Most common format: <p> elements including text "Recipes:", "Recipe:", "Pairing:"
            $("p.evys1bk0").each(function() {
                let p_text = $(this).text();
                if (p_text.includes("Recipe:") || p_text.includes("Recipes:") || p_text.includes("Pairings:")) {
                    recipes = true;
                    //console.log("Recipes found");
                    $("a", $(this)).each(function() {
                        let recipe = {
                            name: $(this).text(),
                            link: $(this).attr("href")
                        };
                        //console.log(recipe);
                        recipeList.push(recipe);
                    })
                }

                // What won't they think of next - 5 Standout Recipes From Julia Reed 9/2/2020
                // Standalone <p> elements consisting solely of a link to a recipe
                let paraanch = $("a",this);
                if (paraanch.length == 1 && 
                    paraanch.text() == $(this).text() && 
                    paraanch.attr("href").includes("cooking.nytimes.com")) {
                    recipes = true;     // Recipes were found
                    let recipe = {
                        name: paraanch.text(),
                        link: paraanch.attr("href")
                    };

                    // Check for duplicate recipe link before adding recipe to recipeList
                    //  For Maximum Flavor, Make These Spice Blends at Home - 2/24/2021
                    let dup = recipeList.filter(item => (item.link == recipe.link));
                    if (dup.length == 0) {
                        // console.log(recipe);
                        recipeList.push(recipe)
                    }
                }
            })
            
            // Look for Heading 2 elements that have an <a> element referencing cooking.nytimes.com
            //  8/14/2020 A Summer Lunch That Feels Like a Splurge
            $(h2s).has("a").each(function () {
                let artHref =  $("a", this).attr("href")
                if (artHref.includes("cooking.nytimes.com")) {
                    //console.log("Alternate recipes found");
                    recipes = true;
                    let recipe = {
                        name: $("a", this).text(),
                        link: artHref
                    }

                    // Check for duplicate recipe link before adding recipe to recipeList
                    let dup = recipeList.filter(item => (item.link == recipe.link));
                    if (dup.length == 0) {
                        // console.log(recipe);
                        recipeList.push(recipe)
                    }
                }
            })

            // Look for h3 elements that contain links and whose text includes 'Recipe[s]:'
            //  2/14/2021 Rediscovering Russian Salad
            $("h3").has("a").each(function () {
                if ($(this).text().search(/Recipe(s*):/) >= 0 ) {
                    // console.log("H3 recipes found");
                    recipes = true;
                    $('a',this).each(function () {
                        // console.log("Title: " + $(this).text());
                        // console.log("Link: " + $(this).attr("href"));
                        let recipe = {
                            name: $(this).text(),
                            link: $(this).attr('href')
                        }

                        // Check for duplicate recipe link before adding recipe to recipeList
                        let dup = recipeList.filter(item => (item.link == recipe.link));
                        if (dup.length == 0) {
                            // console.log(recipe);
                            recipeList.push(recipe)
                        }
                    });
                }
        
            });
            
            if (recipes) {
                console.log("Found " + recipeList.length.toString() + " recipes")
            }
            return recipes;
        }
    
        // Retrieve article page
        const resp = await needle("get", url);
        let $ = cheerio.load(resp.body);
    
        getTitle($);    // Get arttype, title and ATD_present
        // Create article table row
        let tableHTML = "";
        tableHTML = tableHTML + "              <tr>\n                <td><br>\n                </td>\n                <td>" + arttype + "<br>\n";
        tableHTML = tableHTML + '                </td>\n                <td><a href="';
        tableHTML = tableHTML + url + '">' + title + "</a>" + ATD_present + "</td>\n              </tr>\n";
    
        let hasRecipes = getRecipes($);  // Get recipes
        // Create recipe table rows
        for (const i in recipeList) {
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

    async function sectionScrape($) {
        // Called from TPscrape
        // Input is a Cheerio object containing Today's Paper page HTML
        // For each article in the designated section:
        //  Create an article object {title:, author:, href:}
        //  Call artScrape to get { hasRecipes:, html:}
        //  Add hasRecipes: and html: to article object
        //  Push article object onto array of article objects
        // Return array of article objects [{title:, author:, href:, hasRecipes:, html: } ...]

        console.log("Entering sectionScrape");

        let articles = [];  // Array of article objects

        // Locate the target section (anch[1])
        let an = $("a").filter(function() {
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
        para.classList = "pr-2 float-left msg";
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
    let html = await page.content();
    let $ = cheerio.load(html);
    let scrape = await sectionScrape($);
    //console.log("TPscrape: sectionScrape output - " + JSON.stringify(scrape[0]));
    //console.log(scrape)
    console.log("TPscrape: exiting  for " + url)
    return scrape;  // array of article objects - [{title:, author:, href:, hasRecipes:, html:}, ...]
}
function articleListen(arr) {
    // Called from addArticles
    // Input is the article object passed to addArticles from TPscrape
    // Add and eventListener for clicks

    function articleClick(evt) {
        // Called by click on article title
        // Input is a click event
        // Process click on article titles

        if ( evt.target.classList.contains('article')) {
            evt.preventDefault();
            let artIdx = evt.target.parentNode.firstChild.value;
            console.log("Article clicked: " + arr[artIdx].title);
            ipcRenderer.send('article-click', 'click', arr[artIdx].href);
        }
    }

    document.addEventListener('click', articleClick);

}

function addArticles(arr) {
    // Called from Mainline
    // Input is array of article objects returned by TPscrape
    // Add checkboxes for articles returned by TPscrape to index.html
    // Add a button labeled "Next" or "Save" (for last date to be processed) to index.html

    console.log("addArticles: entered with: "+ arr);

    let stringI;
    let lbl;
    let checkbox;
    let iicon;
    let cb_title;
    let cb_author;
    
    articleListen(arr); // Add an eventListener for click on article titles
                        // Passing the article object to a function that ...
                        // ... adds the eventListener makes the article object ...
                        // ... available to the event handler

    // Add {Magazine|Food} articles description to index.html
    let msg = sect + " section articles for " + Day + ", " + MDY;
    addMsg(mL, msg);

    // Remove throbber
    let element = document.getElementById("lD");
    element.parentNode.removeChild(element);

    // Add a checkbox for each article to index.html
    for (const i in arr) {

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
        cb_title.className="article";
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


async function processSelectedArticles (arr) {
    // Called from Mainline
    // Input is array of article objects returned by TPscrape
    // Add event listener, wrapped in a Promise, for the Next/Save button that was added by addArticles
    // Return Promise to Mainline
    //
    // On click of Next/Save button, for each checked article:
    //  append table HTML to newTableHTML
    //
    console.log("processSelectedArticles: entered")
    return new Promise(function (resolve) {
        document.getElementById('aList').addEventListener('submit', async (evt) => {
            // prevent default refresh functionality of forms
            evt.preventDefault();
            console.log("processSelectedArticles - Go clicked")
            document.removeEventListener('click', articleClick);
            ipcRenderer.send('article-click', 'close');
            let ckd = document.querySelectorAll('input:checked')    // Get checked articles
            if (ckd.length > 0){    // If any articles were checked, append date row table HTML
                newTableHTML += dateRowHTML;
                // fs.appendFileSync(output, dateRowHTML, "utf8");  // (diagnostic)
            }

            // Remove article checkboxes and submit button
            while (aL.firstChild) {
                aL.removeChild(aL.lastChild);
            }
            // Remove "Retrieving n articles" msg
            mL.removeChild(mL.lastChild);


            // For each checked article, append its table HTML
            for (let j = 0; j < ckd.length; j++) {
                let artHTML = arr[parseInt(ckd[j].value)].html;
                newTableHTML += artHTML;    // Append table HTML
                // fs.appendFileSync(output, artHTML);  // (diagnostic)
            }
            console.log("processSelectedArticles: resolving")
            resolve();  // Resolve Promise
        },  {once: true});  // AddEventListener option - removes event listener after click
    });    
}

function updateIndexHTML (dates) {
    // Called from Mainline
    // Input: [Moment(first date), Moment(last date)]
    // Returns: true if update performed, false otherwise
    // Replace empty table rows in ~/Sites/NYT Recipes/yyyy/index.html corresponding with new days' table HTML

    // let errmsg; // Error message
    let year = dates[0].format("YYYY")
    const tablePath = NYTRecipes_path + '/' + year + '/index.html';
    const table = fs.readFileSync(tablePath, "UTF-8").toString();       // Read year page
    // const newTableHTML = fs.readFileSync(output, "UTF-8").toString();   // Read new table HTML created by this app (diagnostic)
    let tableLastIndex = table.length-1;

    // Find beginning date
    console.log("Finding start of replace")
    let startDateIndex = table.indexOf(dates[0].format("MM/DD/YYYY"));
    if (startDateIndex == -1) {
        console.error("updateIndexHTML: first date " + dates[0].format("MM/DD/YYYY") + " not found in index.html")
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
        console.error("updateIndexHTML: unable to find </tr> or <tbody> preceding " + dates[0].format("MM/DD/YYYY"));
        return false;
    }
    console.log("trEndBeforeStartDateIndex: " + trEndBeforeStartDateIndex.toString());

    // Find the newline character between the </tr>|<tbody> element and the beginning date
    let nlAfterTrEndBeforeStartDateIndexIndex = table.substr(trEndBeforeStartDateIndex,trEndLength+2).search(/\r\n|\n|\r/);
    if (nlAfterTrEndBeforeStartDateIndexIndex == -1) {
        console.error("updateIndexHTML: unable to find newline following trEndBeforeStartDateIndex");
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
        console.error("updateIndexHTML: last date " + dates[1].format("MM/DD/YYYY") + " not found in index.html");        
        return false;
    }
    console.log("endDateIndex: " + endDateIndex.toString());

    // Find the date following the ending date or </tbody>
    let nextDateAfterEndDateIndex = table.substr(endDateIndex+10).search(/\d\d\/\d\d\/\d\d\d\d/);
    console.log("nextDateAfterEndDateIndex search result: " + nextDateAfterEndDateIndex.toString());
    if (nextDateAfterEndDateIndex == -1) {
        nextDateAfterEndDateIndex = table.indexOf("</tbody", endDateIndex);
        console.log("nextDateAfterEndDateIndex indexOf result: " + nextDateAfterEndDateIndex.toString());
        if (nextDateAfterEndDateIndex == -1) {
            console.error("updateIndexHTML: unable to find MM/DD/YYYY or </tbody following " + dates[1].format("MM/DD/YYYY"));           
            return false; 
        }
    } else {
        nextDateAfterEndDateIndex = nextDateAfterEndDateIndex + endDateIndex + 10;
    }
    console.log("updateIndexHTML: MM/DD/YYYY or </tbody following " + dates[1].format("MM/DD/YYYY") + ": " + nextDateAfterEndDateIndex.toString());

    // Find the </tr> element preceeding the next date or </tbody>
    let trEndBeforeNextDateAfterEndDateIndex = table.lastIndexOf("</tr>", nextDateAfterEndDateIndex);
    if (trEndBeforeNextDateAfterEndDateIndex == -1) {
        console.error("updateIndexHTML: unable to find </tr> preceding MM/DD/YYYY or </tbody");        
        return false;
    }
    console.log("updateIndexHTML: trEndBeforeNextDateAfterEndDateIndex: " + trEndBeforeNextDateAfterEndDateIndex.toString());

    // Find the newline character(s) follow the </tr> element
    let nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex = table.substr(trEndBeforeNextDateAfterEndDateIndex,7).search(/\r\n|\n|\r/);
    if (nlAfterTrEndBeforeNextDateAfterEndDateIndexIndex == -1) {
        console.error("updateIndexHTML: unable to find newline following trEndBeforeNextDateAfterEndDateIndex");        
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

async function processNewDays (yyyy) {
    // Called from Mainline
    // Input: year being processed - yyyy
    // Listen for click on "Continue" button
    //  Call NewDays(yyyy) to extract new and updated days' table rows from /NYT Recipes/yyyy/index.html

	console.log("processNewDays: entered");
    return new Promise(function (resolve) {
		document.getElementById('aList').addEventListener('click', async (evt) => {
            evt.preventDefault();
            remvAllMsg(mL);
            aL.removeChild(aL.lastChild)
            addMsg(mL, "New and updated days:");
			NewDays(yyyy, mL);
			resolve();  // Resolve Promise
        },  {once: true});
    });    
}

// Mainline function
async function Mainline() {
    console.log("Entered Mainline, awaiting Puppeteer launch");

    // Ask main process for app data path and app name
    let appData = await ipcRenderer.invoke('getAppData');

    // Construct path to last-date-processed file
    const lastDateFile = appData.path + "/" + appData.name + '/LastDate.txt';
    // console.log("lastDateFile: " + lastDateFile);

    // Launch Puppeteer
    await launchPup();

    // Determine the minimum and maximum dates for the type=date input 
    //  field dateSpec
    
    // For the maximum date: today.  Locale sv-SE date format is the required YYYY-MM-DD
    let today = new Date();
    let todayStr = today.toLocaleString('sv-SE', {timeZone: 'America/Chicago'}).substr(0,10)

    // The minimum date is 2018-02-04 because the format of the Today's Paper 
    //  article list changed on 2018-02-04 and the prior format is not
    //  supported by this code.

    // Set the minimum and maximum dates.
    let dateInput = document.getElementById('dateSpec');
    dateInput.min = "2018-02-04"
    dateInput.max = todayStr;

    // Add EventListener for Start button
    console.log("Mainline: Adding event listener to Start button");
    startButton = document.getElementById("startButton");
    startButton.addEventListener("click", async (evt) => {
        // After Start click:
        evt.preventDefault();
        console.log("Mainline: Start button clicked, disable Start button");
        startButton.classList.add("disabled");  // Disable the Start button
        remvAllMsg(mL);   // Remove any previous messages
        let datesToProcess = []; // array of dates (Moment objects) to process
        let saveLastDate = false;   // Save LastDate.txt only if datesToProcess were automatically generated
        let msg;
        let bumps = [];    // Increments to next day: [3, 4] from Sunday or [4, 3] from Wednesday

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
            datesToProcess.push(Moment(enteredDate));
        }

        let datesToProcessRange = [];
        if (datesToProcess.length > 0) {
            datesToProcessRange = [datesToProcess[0], datesToProcess[datesToProcess.length-1]];
            console.log("datesToProcessRange: " + datesToProcessRange[0].format("MM/DD/YYYY") + ", " + datesToProcessRange[1].format("MM/DD/YYYY"));
        }

        // Add "Processing" dates message to index.html
        let processDates = true;    // Assume there will be dates to process
        switch (datesToProcess.length) {
            case 0:
                msg = "No new dates to process";
                processDates = false;   // Assumption wrong, there are no dates to process
                break;
            case 1:
                msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY");
                break;
            case 2:
                msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY") + " and " + datesToProcessRange[1].format("MM/DD/YYYY");
                break;
            default:
                msg = "Processing " + datesToProcessRange[0].format("MM/DD/YYYY") + " through " + datesToProcessRange[1].format("MM/DD/YYYY");
        }
        addMsg(mL, msg);

        if (processDates) { // If there are dates to process ...
            // For each date to be processed:
            let lastDateToProcess = datesToProcess.length - 1;
            for (let i = 0; i < datesToProcess.length; i++) {
                MDY = datesToProcess[i].format("MM/DD/YYYY");
                YMD = datesToProcess[i].format("YYYY/MM/DD");
                Day = datesToProcess[i].format("dddd");

                // Set Today's Paper section to be processed according to the day of week
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

                // Create date table row - write to disk in processSelectedArticles 
                dateRowHTML = '              <tr>\n                <td class="date"><a href="' + url + '">';
                dateRowHTML = dateRowHTML + MDY + "</a></td>\n";
                dateRowHTML = dateRowHTML + '                <td class="type"><br>\n';
                dateRowHTML = dateRowHTML + '                </td>\n                <td class="name"><br>\n';
                dateRowHTML = dateRowHTML + '                </td>\n              </tr>\n';

                // Call TPscrape to retrieve designated section articles
                console.log("Mainline: awaiting TPscrape for " + i.toString() + " " + url);
                var artsArray = await TPscrape(url);
                console.log("Mainline: returned from TPscrape for " + i.toString() + " calling addArticles");

                // Add designated section article checkboxes to index.html
                addArticles(artsArray);

                // Add a Next/Save submit button to index.html
                let buttonText;
                if (i < lastDateToProcess) {
                    buttonText = "Next";
                } else {
                    buttonText = "Save";
                }
                let sub = document.createElement('input');
                sub.className = "btn"
                sub.type = "submit";
                sub.value = buttonText;
                aL.appendChild(sub);

                // Add Next/Save button EventListener and after submit, process checked articles
                console.log("Mainline: awaiting processSelectedArticles");
                await processSelectedArticles(artsArray);
                console.log("Mainline: returned from processSelectedArticles");

                // Repeat for next date to be processed
            }

            // Store LastDate processed
            remvAllMsg(mL);
            if (saveLastDate) {
                fs.writeFileSync(lastDateFile, MDY, "utf8");
            }

            // Call updateIndexHTML to add new table rows to ~/Sites/NYT Recipes/{yyyy}/index.html
            if (datesToProcessRange.length > 0) {
                if (updateIndexHTML(datesToProcessRange)) {
                    console.log("Mainline: index.html updated")
                    newTableHTML = "";  // Reset newTableHTML

                    // Add "Review ..." message and a Continue submit button to index.html
                    msg = "Review NYT Recipe index.html, then click Continue";
                    addMsg(mL, msg);
        
                    let sub = document.createElement('input');
                    sub.className = "btn";
                    sub.id = "continueButton";
                    sub.type = "submit";
                    sub.value = "Continue";
                    aL.appendChild(sub);
        
                    // When "Continue" submitted, call processNewDays to look for new and changed days
                    console.log("Mainline: awaiting processNewDays");
                    await processNewDays(datesToProcessRange[0].format("YYYY"));
                    console.log("Mainline: returned from processNewDays");

                    // Call Insert to insert/update new and changed days in local database
                    Insert(mL);

                } else {
                    console.error("Mainliane: problem updating index.html")
                    console.error("newTableHTML:");
                    console.error(newTableHTML);
                    msg = "Problem updating index.html — see console log";
                    addMsg(mL, msg);
                    ipcRenderer.send('tools', 'open');  // Tell main process to open Developer Tools; displays error logging
                }
            }

        }
        console.log("Mainline: enable Start button")
        startButton.classList.remove("disabled");   // Enable the Start button

    });
}

// End of function definitions

Mainline(); // Launch puppeteer and add event listener for Start button