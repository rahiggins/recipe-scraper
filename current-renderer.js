// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// recipe-scraper (current) scrapes Today's Paper pages for food articles and
//  scrapes those aritcles for recipes

// Epochs version 0.1
//  The Epochs branch of recipe-scraper supports Today's Paper pages back to
//  their inception on 4/2/2006 by catering to the Today's Paper page format
//  change on 12/24/2017.

// Epochs version 0.2
//  The ThirdEpoch branch of recipe-scraper supports the Today's Paper page
//  format prior to 10/27/2010.

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//   function Log
//   function addProgress
//   function createButton
//  
//  function TPscrape
//   function artScrape
//    function getTitle
//    function getRecipes
//   function sectionScrape
//
//  function addArticles
//   function articleListen
//    function articleClick
//
//  function processSelectedArticles
//
//  function updateIndexHTML
// 
//  function processNewDays
//
//  function checkExisting
//
//  function tableCompare
//
//  function Mainline
//   function launchPup

// Program flow:
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
//      Listen for reply to invoke-insert from index.js process
//      Send invoke-insert to index.js process

const { addMsg, remvAllMsg, NewDays, Insert } = require('./lib.js'); // Shared scraper functions
const { ipcRenderer } = require('electron'); // InterProcess Communications
const Moment = require('moment'); // Date/time functions
const fs = require('fs'); // Filesystem functions
const puppeteer = require('puppeteer'); // Chrome API
const needle = require('needle'); // Lightweight HTTP client
const cheerio = require('cheerio'); // core jQuery

const request = require('request'); // Simple HTTP request client
const util = require('util');   // node.js utilities

// Create a function that returns a promise from a request.head function call
const requestPromise = util.promisify(request.head) 

var newTableHTML = ''; // Generated table HTML is appended to this
const NYTRecipes_path = '/Users/rahiggins/Sites/NYT Recipes/';

const URLStartCurrent = 'https://www.nytimes.com/issue/todayspaper/';  // Today's Paper URL current prefix
const URLStartPast = 'https://www.nytimes.com/indexes/';  // Today's Paper URL past prefix
const URLEndCurrent = '/todays-new-york-times';       // Today's Paper URL current suffix
const URLEndPast = '/todayspaper/index.html';   // Today's Paper URL past suffix
//const today = Moment();

var debug = true;
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
const buttons = document.getElementById('buttons');     // tableCompare buttons div
const tableDiv = document.getElementById('tableDiv');   // tableCompare table div
var dateEntered;                                  // boolean

// Epochs is an array of dates when the Today's Paper format changed
const Epochs = [Moment('2006-04-02'), // Today's Paper begins with class story divs
                Moment('2010-10-27'), // change to columnGroups 
                Moment('2017-12-24'), // change to <ol>
                Moment() + Moment.duration(1, 'days')]; // tomorrow

const maxEpoch = Epochs.length - 1; // Epochs greater than this are in the future, S.N.O.

// Function definitions

function Log (text) {
    // If debugging, write text to console.log
    if (debug) {
        console.log(text)
    }
}

function createButton(id, text) {
    let button = document.createElement('input');
    button.className = "btn";
    button.id = id;
    button.type = "submit";
    button.value = text;
    return button
}

async function TPscrape(url, epoch) {
    // Called from Mainline
    // Input is URL of Today's Paper section and
    //          Today's Paper format epoch indicator (1, 2 or 3)
    //
    // Retrieve Today's Paper page
    // Call sectionScrape to extract articles from Todays Paper section {Wednesday: food, Sunday: magazine}
    // For each article, call artScrape to scrape article for title and recipes
    // and return array of article objects = [ {title:, author:, href:, hasRecipes, html:}, ...]

    console.log("TPscrape: entered for " + url)
    var anch = url.split("#");  // ["Today's Paper url", "section name"]
    Log("anch: " + anch)
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

        console.log("artScrape entered with url: " + url)

        let title;
        let arttype;
        let ATD_present;
        let h2s;
        let recipeList = [];
    
    
        function getTitle($) {
            // Get a article's title and attibutes: 
            //  - article designation (arttype)
            //  - existence of wine pairing advice (ATD_present)
            // Called from artScrape
            // Input is a Cheerio object containing article page HTML
            // Sets variables h2s, ATD_present, arttype, title
    
            // See if And to Drink is present
            ATD_present = "";
            h2s = $('h2.eoo0vm40'); // h2s also referenced in getRecipes()
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
    
            // Check for title decoration (a <p> element of class e6idgb70)
            //  and adjust the article designation (table column 2)
            // The article designation is 'article', unless the title decoration
            //  is 'x of the times', in which case the article designation is 'x'
            //  or the title decoration is a key of the object articleTypes, in
            //  which case the article designation is the value associated with
            //  that key.

            function articleType(key) {
                // Map title decorations (key) to an article designation

                // Define title decorations that have an article designation
                //  other than 'article'
                let articleTypes = {
                    pairings: 'pairings',
                    'the pour': 'wine',
                    'wine school': 'wine school'
                };

                // Return 'article' for any title decoration not defined 
                //  in articleType, else return key value
                switch (articleTypes[key]) {
                    case undefined:
                        return 'article'
                    default:
                        return articleTypes[key]
                }
            }

            // The default article designation is 'article'
            arttype = 'article';

            // Title decorations are contained in a <p> element of class e6idgb70.
            // See if a title decoration is present, and if so, see if it 
            //  modifies the default article designation
            console.log("Number of class e6idgb70 elements: " + $(".e6idgb70").length.toString());
            $(".e6idgb70").each(function() {
                if ($(this).text().length > 0) {
                    // The class e6idgb70 elements has text and so is title decoration
                    let key = $(this).text().toLowerCase()
                    console.log("e6idgb70 text (title decoration): " + key);

                    if (key.includes('of the times')) {
                        // The title decoration contains 'of the times' so the preceding word
                        //  is the article designation
                        arttype = key.split(/ of the times/)[0];
                        if (arttype.trim() == "wines") {arttype = "wine"}
                        if (arttype.trim() == "beers") {arttype = "beer"}
                    } else {
                        // Otherwise, call articleType to get the article designation
                        arttype = articleType(key);
                        console.log('articleType returned: ' + arttype)
                    }
                }
            })
    
            // Get title - first Heading 1
            let titles = $('h1');
            console.log("Titles: " + titles.length.toString());
            if (titles.length.toString() == 0) {
                console.log("Page html:")
                console.log($.html())
            }
            title = $(titles[0]).text();
            console.log("title: " + title);
            console.log("arttype: '" + arttype + "'");
    
        }
    
        function getRecipes($) {
            // Called from artScrape
            // Input is a Cheerio query function for the article page HTML
            // Returns recipeList array [{name:, link:} ...]
            Log("getRecipes entered")
    
            let recipes = false;
    
            // Look for recipe links, which occur in several formats
            //  Create recipe objects {name: , link:} from <a> elements 
            //  and push onto recipeList array
            //
            // Most common format: <p> elements including text "Recipes:", "Recipe:", "Pairing:", "Pairings:", "Eat:" (5/23/2021)
            $("p.evys1bk0").each(function() {
                let p_text = $(this).text();
                // console.log("p.evys1bk0 loop - <p> text: " + p_text)
                if (p_text.match(/Recipe[s]?:|Pairing[s]?:|Eat:|Related:/) != null) {
                    recipes = true;
                    console.log("Recipes found - " + '<p> elements including text "Recipes:", "Recipe:", "Pairing:", "Eat:", "Related:"');
                    $("a", $(this)).each(function() {
                        let name = $(this).text().trim();
                        if (name != "") { // 4/23/2014 - duplicate <a> elements, 2nd with no text
                            let recipe = {
                                name: name,
                                link: $(this).attr("href")
                            };
                            console.log(recipe);
                            recipeList.push(recipe);
                        }
                    })
                }

                // What won't they think of next - 5 Standout Recipes From Julia Reed 9/2/2020
                // Standalone <p> elements consisting solely of a link to a recipe
                // Sometimes a duplicate link in a collection of recipes, with
                //  the text "View the full recipe." - 20 Easy Salads for Hot Summer Days 7/20/2022
                //  Ignore these.
                let paraanch = $("a",this);
                if (paraanch.length == 1 && 
                    paraanch.text() == $(this).text() && 
                    paraanch.text() != "View the full recipe." &&
                    paraanch.attr("href").includes("cooking.nytimes.com")) {
                    recipes = true;     // Recipes were found
                    console.log("Recipes found -  standalone <p> element")
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
            //  8/30/2023 Claire Saffitz’s Foolproof Recipe for Making Macarons (multiple <a> elements)
            $(h2s).has("a").each(function () {
                if ($("a", this).attr("href").includes("cooking.nytimes.com/recipes") ) {
                    console.log("Alternate recipes found - H2 elements");
                    recipes = true;
                    $('a',this).each(function () {
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
            })

            // Look for h3 elements that contain links and whose href includes 'cooking.nytimes.com/recipes'
            //  2/14/2021 Rediscovering Russian Salad
            //  10/12/2022 Boneless Chicken Thighs Are the Star of These Easy Dinners
            //  11/16/2022 include 'cooking.nytimes.com/recipes' to exclude 'cooking.nytimes.com/thanksgiving'
            $("h3").has("a").each(function () {
                if ($("a", this).attr("href").includes("cooking.nytimes.com/recipes") ) {
                    console.log("H3 recipes found");
                    recipes = true;
                    $('a',this).each(function () {
                        console.log("Title: " + $(this).text());
                        console.log("Link: " + $(this).attr("href"));
                        let recipe = {
                            name: $(this).text(),
                            link: $(this).attr('href')
                        }

                        // Check for duplicate recipe link before adding recipe to recipeList
                        let dup = recipeList.filter(item => (item.link == recipe.link));
                        if (dup.length == 0) {
                            console.log(recipe);
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
    
        // Retrieve article page (following redirects)
        const resp = await needle("get", url, {follow_max: 10});
        let $ = cheerio.load(resp.body);
    
        getTitle($);    // Get arttype, title and ATD_present
        // Create article table row
        let tableHTML = "";
        tableHTML = tableHTML + "              <tr>\n                <td><br>\n                </td>\n                <td>" + arttype + "\n";
        tableHTML = tableHTML + '                </td>\n                <td><a href="';
        tableHTML = tableHTML + url + '">' + title + "</a>" + ATD_present + "</td>\n              </tr>\n";
    
        let hasRecipes = getRecipes($);  // Get recipes
        // Create recipe table rows
        for (const i in recipeList) {

            // For each recipe's URL,Look for redirects from www.nytimes.com
            //  to cooking.nytimes.com.  If found, replace the recipe's 
            //  www.nytimes.com URL with the cooking.nytimes.com URL
            //  e.g. https://www.nytimes.com/2009/01/21/dining/211prex.html
            if (recipeList[i].link.includes("www.nytimes.com")) {
                let redirect =  await requestPromise(recipeList[i].link)
                if (redirect.request.uri.href.includes("cooking.nytimes.com")) {
                    Log("Redirect: " + recipeList[i].link + " => " + redirect.request.uri.href);
                    recipeList[i].link = redirect.request.uri.href
                }
            }

            tableHTML = tableHTML + "              <tr>\n                <td><br>\n                </td>\n                <td>recipe\n";
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
        //
        // Find the section that contains food articles, then ...
        // For each article in the designated section:
        //  Create an article object {title:, author:, href:}
        //  Call artScrape to get { hasRecipes:, html:}
        //  Add hasRecipes: and html: to article object
        //  Push article object onto array of article objects
        // Return array of article objects [{title:, author:, href:, hasRecipes:, html: } ...]

        Log("Entering sectionScrape");
        Log("Epoch: " + epoch.toString())

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
        
        let articles = [];  // Array of article objects, value returned by sectionScrape
        let sh; // div.section-headline element in epoch 1

        // Define names of sections that contain food articles
        let sectionNames = ["magazine", "food", "dining", "diningin,diningout"];

        // Find an <a> element whose name belongs to the sectionNames array of
        //  sections containing food articles
        let an = $("a").filter(function() {
            let name = $(this).attr("name");
            if (name == undefined) {
                return false
            } else {
                return sectionNames.includes(name.replace(/\s/g, "").toLowerCase())
            }
        })

        if (epoch == 1) {
            // For the first epoch, find the <a> element's parent whose 
            //  class name is "section-headline"
            sh = $(an).parents().filter(function() {
                return $(this).attr("class") == "section-headline";
            })            
        }

        //console.log("Number of anchors: " + an.length.toString())

        // Set section name from the identified <a> element
        sect = $(an).attr("name");
        Log("Section name: " + sect)

        // Cheerio object containing article elements, set in the following
        //  switch block
        let arts;

        switch (epoch) {

            case 3:
        
                // 
                let sectionList = $(an).siblings('ol'); // ordered list following section
                Log("Number of lists: " + sectionList.length.toString());
                arts = $(sectionList).children("li"); // list items (articles) of ordered list following section
                //console.log("Number of articles: " + arts.length.toString());
                break;
            
            case 2:

                let colGroupParent = $(an).parents().filter(function() {
                    return $(this).attr("class") == "columnGroup";
                })
                Log("colGroupParent length: " + colGroupParent.length.toString());
            
                arts = $('li', colGroupParent);
                break;

            case 1:

                let sib = $(sh).next()
                do {
                    arts = $(arts).add(sib)
                    console.log("Sib: " + $('a', sib).text())
                    sib = $(sib).next()
                } while ($(sib).attr('class') != 'jumptonavbox')
                break;
                
        }
        Log("Number of articles: " + arts.length.toString());

        // Create a float-left div
        let sectArtDiv = document.createElement("div");
        sectArtDiv.className = "float-left";

        // Create a "Retrieving n ... articles" <p> element
        let para = document.createElement("p");
        para.classList = "pr-2 float-left msg";
        let txt = "Retrieving " + arts.length.toString() + " " + sect + " section articles for " + Day + ", " + MDY;
        let txnd = document.createTextNode(txt);
        para.appendChild(txnd);

        // Add "Retrieving n ... articles" element and a progress bar to the float-left div
        sectArtDiv.appendChild(para);
        sectArtDiv.appendChild(addProgress(0,arts.length));

        // Remove the "Retrieving Today's Paper" message and add the float-left div to the messages div
        mL.removeChild(mL.lastChild);
        mL.appendChild(sectArtDiv);


        for (let a = 0; a < arts.length; a++) {  
            // For each article, create an article object (artObj) 

            let artObj; // Article object, appended to articles array
            let title;
            let author;
            let link = $(arts[a]).find("a");    // Hyperlink to article

            // According to epoch, collect title, href and author. Create artObj.
            switch (epoch) {
    
                case 3:
                    let h2 = $(link).find("h2");
                    Log("Article title: " + $(h2).text());
                    Log("Article href: " + prot + "://" + hostnm + $(link).attr("href"));
                    author = $(arts[a]).find("span.css-1n7hynb")
                    Log("Author: " + author.text());
                    artObj = {  // create an article object
                        title: $(h2).text(),
                        author: $(author).text(),
                        href: prot + "//" + hostnm + $(link).attr("href")
                    };
                    break;

                case 2:
                    title = $(link).text().trim();
                    Log("Title: " + title);
                    href = $(link).attr("href")
                    if (!$(link).attr("href").startsWith("http")) {
                        href = prot + "://" + hostnm + $(link).attr("href")
                    }
                    href = href.split('?')[0]
                    Log("href: " + href);
                    let byLine = $(arts[a]).find("div.byline")
                    if (byLine.length > 0) {
                        author = $(arts[a]).find("div.byline").text().split(/By|by/)[1].trim()
                    } else {
                        author = "";
                    }
                    Log("Author: " + author);
                    artObj = {  // create an article object
                        title: title,
                        author: author,
                        href: href
                    };
                    break;

                case 1:
                    title = $(link).text();
                    Log("Title: " + title)
                    href = $(link).attr("href").replace('events', 'www')
                    console.log("Href: " + href)
                    let shlAuthor = $(arts[a]).find("div.storyheadline-author")
                    if (shlAuthor.length > 0 & $(shlAuthor).text().match(/by/i) != null) {
                        author = $(shlAuthor).text().split(/By|by/)[1].trim()
                    } else {
                        author = "";
                    }
                    Log("Author: " + author);
                    artObj = {  // create an article object
                        title: title,
                        author: author,
                        href: href
                    };
                    break;
            }

            // Call function artScrape to scrape article page for recipes
            let aTH = await artScrape(artObj.href);

            // Add values returned by artScrape to the article object (artObj)
            artObj.hasRecipes = aTH.hasRecipes;
            artObj.html = aTH.html;
            //console.log("sectionScrape: artObj: " + JSON.stringify(artObj));

            // Append this article's artObj to the array returned
            articles.push(artObj);

            // Update progress bar
            sectArtDiv.removeChild(sectArtDiv.lastChild);           // Remove the progress bar
            sectArtDiv.appendChild(addProgress(a+1,arts.length));   // and add an updated one

        }
        //console.log(articles);

        // Return array of article objects
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
        results.push(window.location.href);
        results.push(window.location.hostname);
        results.push(window.location.pathname)
        return results;
    })
    prot = url_parts[0];
    hostnm = url_parts[1];
    Log("url_parts: " + prot + " " + hostnm);
    Log("w.l.href: " + url_parts[2]);
    Log("w.l.hostname: " + url_parts[3]);
    Log("w.l.pathname: " + url_parts[4]);
    // Retrieve page html and call sectionScrape to extract articles
    let html = await page.content();
    let $ = cheerio.load(html);
    let scrape = await sectionScrape($);
    //console.log("TPscrape: sectionScrape output - " + JSON.stringify(scrape[0]));
    //console.log(scrape)
    console.log("TPscrape: exiting  for " + url)
    return scrape;  // array of article objects - [{title:, author:, href:, hasRecipes:, html:}, ...]
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

    function articleListen(arr) {
        // Called from addArticles
        // Input is the article object passed to addArticles from TPscrape
        // Add and eventListener for clicks
    
        articleClick = function(evt) {
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
    
        console.log("Add articleClick")
        document.addEventListener('click', articleClick);
    
    }    
    
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
        cb_author.innerText = arr[i].author;

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
    const tablePath = NYTRecipes_path + year + '/index.html';
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

function checkExisting(date) {
    // See if table HTML for the input date already exists in
    //  NYTRecipes_path + YYYY + '/Days/YYYY-MM-DD.txt'
    // Input: a Moment object for the date under consideration
    // Output: {
    //           exists: boolean,
    //           existingHTML: string
    //         }
    console.log("checkExisting entered, date: " + date.format('YYYY-MM-DD'))

    let yyyy = date.format("YYYY");
    let dashesYMD = date.format('YYYY-MM-DD');
    let dayPath = NYTRecipes_path + yyyy + '/Days/' + dashesYMD + '.txt';
    Log("dayPath: " + dayPath)
    let dayExists = fs.existsSync(dayPath);
    Log("dayExists: " + dayExists);
    let differs;
    let existingTableHTML = null;
    if (dayExists) {
        existingTableHTML = fs.readFileSync(dayPath, "UTF-8").toString()
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

    Log("function dayCompare entered")

    const prefix = '<table>'        // prepend to newTable/oldTable
    const suffix = '</table>'       // append to newTable/oldTable
    const addColor = '#e7fcd7';     // light green - background color for added rows
    const delColor = '#fce3e3';     // light red - background color for missing rows
    let test = false
    let debug = true;

    function rowsText(rows, cheerioQuery) {
        // Create an array of table row text
        // Input: 1) Iterable Cheerio object of table rows
        //        2) Cheerio query function for argument 1
        // Output: array of table row text
        //
        // Extract the text from each table row's table data elements (TD), remove whitespace
        //  and add the concatenation of the TD text to the output array

        let text = [];
        rows.each(function() {
            // For each row,

            // Get its TD elements
            let tds = cheerioQuery('td', this);

            // rowText will be a concatenation of each TD's text
            let rowText = '';

            tds.each(function() {
                // For each TD element, 

                // Get its text, remove whitespace and <br> elements, 
                //  replace 'http' with 'https', and concatenate the result 
                //  to rowText
                rowText += cheerioQuery(this).html().replace(/\s+|<br>/g, '').replace('http:', 'https:');
            })

            // Append the row's concatenated text to the output array
            text.push(rowText);
        })

        // return [row text, row text, ...]
        return text;
    }

    function createButton(id, text) {
        // Create and return a submit button
        // Input:   element id
        //          button value and element name

        let button = document.createElement('input');
        button.classList = "btn mr-2"; // margin-right to separate it from subsequent buttons
        button.id = id;
        button.type = "submit";
        button.value = text;
        button.name = text;
        return button;
    }

    // Create a Cheerio query function for the old collection
    const old$ = cheerio.load(prefix + oldTable + suffix);

    // For the old collection, create an iterable Cheerio object of the table rows (oldRows)
    // and a javascript array of Cheerio objects for each table row
    const oldRows = old$('tr')
    const oldRowsArray = oldRows.toArray()

    // Create an array (oldRowsText) of each old table row's text
    let oldRowsText = rowsText(oldRows, old$);

    // Create a Cheerio query function for the new collection
    const new$ = cheerio.load(prefix + newTable + suffix);

    // For the new collection, create an iterable Cheerio object of the table rows (newRows)
    // and a javascript array of Cheerio objects for each table row
    const newRows = new$('tr')
    const newRowsArray = newRows.toArray();

    // Create an array (newRowsText) of each new table row's text
    let newRowsText = rowsText(newRows, new$);

    // Uncomment the following 3 rows to test
    //newRowsText = ["r", "a", "b", "c", "z", "d", "e", "f", "g", "h", "w", "i", "j", "k", "l", "m", "u" ];
    //oldRowsText = ["s", "t", "a", "c", "b", "d", "e", "f", "y", "x", "g", "h", "i", "j", "k", "v", "l", "m", "p", "q" ];
    //test = true

    // Create an array (newInNew) whose elements are the index of each 
    //  new collection row not found in the old collection.
    let newInNew = [];

    // Compare each new row text (the elements of newRowsText) to the text of the old 
    //  rows (elements of oldRowsText).
    // If the new row's text is not found, add that row's index to the newInNew array
    // Test output - newInNew array: [0,4,10,16]

    for (let n = 0; n<newRowsText.length; n++ ) {
        // For each row in the new collection...
        let notFound = true; // Not found yet
        for (let o = 0; o<oldRowsText.length; o++) {
            // ... look for its text in the old collection
            if (newRowsText[n] == oldRowsText[o]) {
                // If found, move on to the next new row
                notFound = false; // It has been found ...
                break; // ... so break out of the old rows loop
            }
        }
        if (notFound) {
            // If not found, add the added row's index to the newInNew array
            newInNew.push(n)
        }
    }

    // Create an array (oldInNew) consisting of the index of each old row in the new row collection.
    let oldInNew = [];

    // Compare each old row text (the elements of oldRowsText) to the new rows text
    //  (elements of newRowsText)
    // If the old row's text is found, add its index in the new rows array to oldInNew.
    // If the old row's text is not found, add -1 to oldInNew.
    // Test output - oldInNew: [-1,-1,1,3,2,5,6,7,-1,-1,8,9,11,12,13,-1,14,15,-1,-1]

    for (let o = 0; o<oldRowsText.length; o++ ) {
        // For each row in the old collection...
        let notFound = true; // Not found yet
        for (let n = 0; n<newRowsText.length; n++) {
            // ... look for its text in the new collection
            if (oldRowsText[o] == newRowsText[n]) {
                // If found, add its index in the new collection to the oldInNew array.
                oldInNew.push(n);
                notFound = false; // The row has been found ...
                break; // ... so break out of the new rows loop
            }
        }
        if (notFound) {
            // If not found, indicate that by adding -1 to the oldInNew array
            oldInNew.push(-1)
        }
    }

    Log("oldInNew: " + oldInNew, debug)
    Log("newInNew array: " + newInNew, debug)

    // Create an array (oldInOld) consisting of the indices of rows in the oldInNew
    //  array that don't exist in the new collection (i.e. oldInNew elements equal
    //  to -1).
    let oldInOld = [];

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
    let from = oldInNew.length-1;

    // Index of a -1 element
    let oldInOldIndex;

    do {
        // Starting from the last element of oldInNew, find a prior -1 element, indicating an old row
        //  missing from the new collection

        oldInOldIndex = oldInNew.lastIndexOf(-1, from) // returns -1 if not found
        Log("oldINOld loop after lastInexOf: oldInOldIndex: " + oldInOldIndex.toString() + " from: " + from.toString(), debug)
        if (oldInOldIndex >= 0) {
            // If a -1 element was found, add its index to the oldInOld array
            oldInOld.push(oldInOldIndex)
            Log("Pushed: " + oldInOldIndex.toString(), debug)
        }

        // If a -1 element was found, start the next search from the
        //  preceeding element; if no such element was found, 'from' is set to -2
        //  resulting in exit from the loop
        from = oldInOldIndex - 1
        Log("oldINOld loop after from update: oldInOldIndex: " + oldInOldIndex.toString() + " from: " + from.toString(), debug)

        // Repeat the search while 'from' is within the oldInNew array
    } while (from >= 0)

    Log("After oldInOld loop: oldInOldIndex: " + oldInOldIndex.toString(), debug)
    Log("oldInOld array: " + oldInOld, debug)

    // diffRowsHTML is only for debugging
    let diffRowsHTML = [...newRowsText]

    // For each newInNew element (an added table row in newRowsArray),
    //  modify the table row in newRowsArray to set its background color to 'added'.
    newInNew.forEach((el) => {
        diffRowsHTML[el] = "+" + diffRowsHTML[el]
        new$(newRowsArray[el]).css('background-color', addColor)
    })

    // If there are table rows in oldRowsArray not present in newRowsArray
    //  (i.e. oldInOld not empty), duplcate newRowsArray as mergedHTML.
    // mergedHTML will be modified in the following loop and then returned
    //  to the caller if the Merge action is chosen.
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
    Log("oldInOld loop", debug)
    oldInOld.forEach((el) => {
        // For each oldInOld element (an index in the oldInNew array) ...
        Log("el: " + el.toString(), debug)

        // ... examine the oldInNew array elements preceeding that index ...
        let prevEl = el - 1

        // ... within the oldInNew array (prevEl > -1) 
        //  until a non-negative element is found
        while (prevEl > -1 && oldInNew[prevEl] < 0) {
            prevEl--
        }

        if (prevEl < 0) {
            // If a non-negative element is not found ...
            Log("Prepend el: " + el.toString(), debug)
            diffRowsHTML.unshift("-" + oldRowsText[el])

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
            let insertion = oldInNew[prevEl] + 1;        
            Log("Add " + el.toString() + " at: " + insertion.toString(), debug);
            diffRowsHTML.splice(insertion, 0, "-" + oldRowsText[el])

            // Insert the oldRowsArray elment into mergedHTML
            mergedHTML.splice(insertion, 0, oldRowsArray[el])

            // Set the row's background color to 'deleted' in oldRowsArray 
            old$(oldRowsArray[el]).css('background-color', delColor)

            // Insert the modified oldRowsArray elment into the newRowsArray
            newRowsArray.splice(insertion, 0, oldRowsArray[el])
        }

    })

    Log("oldRowsText: " + oldRowsText, debug)
    Log("newRowsText: " + newRowsText, debug)
    Log("updated diffRowsHTML: " + diffRowsHTML, debug)

    Log("Added rows: " + newInNew.length.toString(), debug)
    Log("Deleted rows: " + oldInOld.length.toString(), debug)

    // added is true if newRowsArray contains added rows
    let added = newInNew.length > 0;

    // deleted is true if oldRowsArray contains rows missing from newRowsArray
    let deleted = oldInOld.length > 0;

    if (test) {
        return
    } 

    //if (added) {
    //    // If there are added rows, display a button to replace the existing
    //    //  table HTML with the new table HTML
    //    let replaceBtn = createButton("replaceBtn", "Replace")
    //    buttons.appendChild(replaceBtn)
    //}
    if (added && deleted) {
        // If there are both added and missing rows in the new table HTML,
        //  display a button to replace the existing table HTML with the 
        //  union of the added and existing rows, i.e. add the added rows and
        //  retain the missing rows
        let mergeBtn = createButton("mergeBtn", "Merge");
        buttons.appendChild(mergeBtn);
    }
    if (added || deleted) {
        // If there are added rows or missing rows in the new table HTML,
        //  display a button to discard the new table HTML
        let replaceBtn = createButton("replaceBtn", "Replace")
        buttons.appendChild(replaceBtn)
        discardBtn = createButton("discardBtn", "Discard");
        buttons.appendChild(discardBtn);
        msg = "Existing table rows differ from the selected rows"
        addMsg(mL, msg);
    }

    // Name of button clicked (action selected)
    //  or "None" if the new and old table HTML are equivalent
    let buttonClicked;

    if (added || deleted) {
        // If there are either added rows or missing rows in the new table HTML,
        //  display a table identifying the added and missing rows by background
        //  color

        // Create a Cheerio query function for an empty table
        const table$ = cheerio.load('<table><tbody></tbody></table>')

        // Add table rows from newRowsArray to the empty table
        for (a = 0; a<newRowsArray.length; a++) {
            table$(newRowsArray[a]).appendTo('tbody')
        }
        Log("diff table:", debug)
        Log(table$('table').html(), debug)

        // Display the table 
        document.getElementById("tableCompare").innerHTML = table$('table').html();

        // Create an array (inps) of buttons
        let inps = buttons.getElementsByTagName("input");    
        Log("Number of buttons: " + inps.length.toString(), debug)

        // Create an array (inpsPromises) of promises related to the clicking of
        //  buttons (submit type input elements)
        let inpsPromises = [];
        for (let i=0; i<inps.length; i++) {
            // For each button, create a Promise resolved by a 'click' event listener
            //  and add it to the inpsPromises array.  
            inpsPromises.push( new Promise (function(resolve) {
                inps[i].addEventListener("click", async (e) => {
                    // When a button is clicked, remove all buttons and the 
                    //  table from the display.  Resolve the related promise with the name
                    //  of the clicked button (Replace, Merge or Discard)
                    e.preventDefault();
                    Log("Click handler entered", debug);
                    Log("Target: " + e.target.name, debug)

                    // Remove butttons
                    while (buttons.firstChild) {
                        buttons.removeChild(buttons.lastChild);
                    }

                    // Remove the table
                    //while (tableDiv.firstChild) {
                    //    tableDiv.removeChild(tableDiv.lastChild);
                    //}
                    while (tableCompare.firstChild) {
                        tableCompare.removeChild(tableCompare.lastChild);
                    }

                    // Resolve the promise related to the clicked button with the
                    //  button's name
                    resolve(e.target.name)
                }, false)}

            ))
        }

        // Wait for a button to be clicked
        buttonClicked = await Promise.race(inpsPromises)

    } else {
        // If the new table HTML has neither added nor missing rows, return "None"
        buttonClicked = "None"
    }

    Log("Button clicked: " + buttonClicked, debug)

    // Return an object that specifies the action selected (Replace, Merge, Discard or
    //  None).  In the case of Merge, the returned object also contains the merged
    //  table HTML.
    let returnObj;
    if (buttonClicked == "Merge") {
        // Create a Cheerio query function for an empty table
        const merged$ = cheerio.load('<table><tbody></tbody></table>')

        // Add table rows from mergedHTML to the empty table
        for (a = 0; a<mergedHTML.length; a++) {
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
    return returnObj;
}

// Mainline function
async function Mainline() {
    console.log("Entered Mainline, awaiting Puppeteer launch");

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

    // Ask main process for app data path and app name
    let appData = await ipcRenderer.invoke('getAppData');

    // Construct path to last-date-processed file
    // For macOS: /Users/rahiggins/Library/Application Support/recipe-scraper/
    const lastDateFile = appData.path + "/" + appData.name + '/LastDate.txt';
    // console.log("lastDateFile: " + lastDateFile);

    // Launch Puppeteer
    await launchPup();

    // Determine the minimum and maximum dates for the type=date input 
    //  field dateSpec
    
    // For the maximum date: today.  Locale sv-SE date format is the required YYYY-MM-DD
    let today = new Date();
    let todayStr = today.toLocaleString('sv-SE', {timeZone: 'America/Chicago'}).substr(0,10)

    // The minimum date is 2006-04-02 because there's no Today's Paper 
    //  before that date

    // Set the minimum and maximum dates.
    let dateInput = document.getElementById('dateSpec');
    dateInput.min = "2006-04-02"
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
            dateEntered = false;
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
            dateEntered = true;
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
            let checkExistingResult;
            let compareResult;
            let lastDateToProcess = datesToProcess.length - 1;
            for (let i = 0; i < datesToProcess.length; i++) {
                // For each date to be processed:
                
                // Establish Today's Paper format epoch: 1, 2 or 3, where 3 is the current epoch
                let epoch = 0;  // Set epoch indicator
                for (el of Epochs) {
                    // For each element of the Epochs array (an epoch begin date) ...
                
                    if (datesToProcess[i] < el) {
                        // If the date to process is prior to this begin date,
                        //  exit loop
                        break;
                    } else {
                        // Increment epoch indicator and repeat
                        epoch++;
                    }
                }

                if (epoch == 0 | epoch > maxEpoch) {
                    console.log("Date out of Today's Paper range")
                    return
                } else {
                    console.log("Epoch " + epoch.toString())
                }

                MDY = datesToProcess[i].format("MM/DD/YYYY");
                YMD = datesToProcess[i].format("YYYY/MM/DD");
                Day = datesToProcess[i].format("dddd");

                // Set Today's Paper URL according to epoch
                switch (epoch == 3) {

                    case true:  // Current epoch
                        url = `${URLStartCurrent}${YMD}${URLEndCurrent}`;
                        break;

                    case false: // Prior epochs
                        url = `${URLStartPast}${YMD}${URLEndPast}`
                        break;

                }

                // Call TPscrape to retrieve designated section articles
                console.log("Mainline: awaiting TPscrape for " + i.toString() + " " + url);
                console.log("sect: " + sect)
                var artsArray = await TPscrape(url, epoch);
                console.log("Mainline: returned from TPscrape for " + i.toString() + " calling addArticles");
                console.log("sect: " + sect)

                // Create date table row - write to disk in processSelectedArticles 
                dateRowHTML = '              <tr>\n                <td class="date"><a href="' + url + "#" + sect + '">';
                dateRowHTML = dateRowHTML + MDY + "</a></td>\n";
                dateRowHTML = dateRowHTML + '                <td class="type"><br>\n';
                dateRowHTML = dateRowHTML + '                </td>\n                <td class="name"><br>\n';
                dateRowHTML = dateRowHTML + '                </td>\n              </tr>\n';

                // Add designated section article checkboxes to index.html
                addArticles(artsArray);

                // Add a Next/Save submit button to index.html
                let buttonText;
                if (i < lastDateToProcess) {
                    buttonText = "Next";
                } else {
                    if (dateEntered) {
                        buttonText = "Continue"
                    } else {
                        buttonText = "Save";
                    }
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

                // If a date was entered, see if table HTML already exists
                if (dateEntered) {
                    checkExistingResult = checkExisting(datesToProcess[i])
                    if (checkExistingResult.exists) {
                        compareResult = await dayCompare(newTableHTML, checkExistingResult.existingHTML);
                        Log("Action returned: " + compareResult.action);
                        Log("HTML returned: " + compareResult.mergedHTML);
                    }
                }

                // Repeat for next date to be processed
            }

            // Remove previous messages
            //remvAllMsg(mL);

            // Store LastDate processed
            if (saveLastDate) {
                fs.writeFileSync(lastDateFile, MDY, "utf8");
            }

            if (dateEntered && checkExistingResult.exists) {
                console.log("Date was entered and has existing table HTML");
                console.log("Action: " + compareResult.action);

                switch (compareResult.action) {

                    case 'None':
                        msg = "An identical set of table rows already exists"
                        addMsg(mL, msg)
                        datesToProcessRange = [];
                        newTableHTML = "";  // Reset newTableHTML
                        break;

                    case 'Discard':
                        mL.removeChild(mL.lastChild);
                        msg = "Changes discarded, existing table rows retained"
                        addMsg(mL, msg)
                        datesToProcessRange = [];
                        newTableHTML = "";  // Reset newTableHTML
                        break;

                    case 'Replace':
                        mL.removeChild(mL.lastChild);
                        break;

                    case 'Merge':
                        mL.removeChild(mL.lastChild);
                        newTableHTML = compareResult.mergedHTML

                    default:
                        break;

                }
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
                    console.error("Mainline: problem updating index.html")
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