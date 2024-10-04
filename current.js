// This module executes the 'current' mode of the recipe-scraper application.  Index.js issues
//  require for this module.

// recipe-scraper (current) scrapes Today's Paper pages for food articles and scrapes those aritcles for recipes
// It connects to a remote Chrome instance, which must be logged into nytimes.com, which prevents pages from being obscured by a log in prompt.

// fixTitle version 1.0.3

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//   function Log
//
//  function connectPup
//
//  function TPscrape
//   function artScrape
//    function getTitle
//      function articleType
//    function getRecipes
//   function sectionScrape
//
//  function processSelectedArticles
//    ipcMain.once('submitted')
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
//    function launchPup
//    function addArticles
//      ipcMain.once('added')
//      global.win.webContents.send('add-articles')
//    ipcMain.on('process-date')
//      global.win.webContents.send('add-button')
//
//   app.on('will-quit')

// Program flow:
//
//   Mainline
//    Connect Puppeteer to a remote Chrome instance
//    Listen for a 'process-date' message from current-renderer.js
//      For each date to be processed
//      |  Call TPscrape
//      |    Send 'add-throbber' message to current-renderer.js
//      |    Call sectionScrape
//      |       Send 'create-progressbar' message to current-renderer.js
//      |     For each article in section
//      |       Call artScrape
//      |       Send 'update-progressbar' message to current-renderer.js
//      |     Send 'remove-lastMsg' message to current-renderer.js (remove progress bar)
//      |  Call addArticles
//      |  Send 'add-button' message to current-renderer.js
//      |  Call processSelectedArticles
//      |  Call dayCompare, if a specific date was entered
//      |   Call createButton
//      |   Send 'display-tableCompare' message to current-renderer.js
//      |   Send 'enable-action-buttons' message to current-renderer.js
//      |_  Call getAction
//      Call updateIndexHTML
//      Send 'add-continue' message to current-renderer.js
//      Call processNewDays
//          Call NewDays
//      Call Insert
//      Send 'enable-start' message to current-renderer.js

const { NewDays, Insert } = require('./lib.js') // Shared scraper functions
const { app, ipcMain } = require('electron') // InterProcess Communications
const path = require('path')
const Moment = require('moment') // Date/time functions
const fs = require('fs') // Filesystem functions
const puppeteer = require('puppeteer') // Chrome API
const needle = require('needle') // Lightweight HTTP client
const cheerio = require('cheerio') // core jQuery

const request = require('request') // Simple HTTP request client
const util = require('util') // node.js utilities

// Create a function that returns a promise from a request.head function call
const requestPromise = util.promisify(request.head)

let newTableHTML = '' // Generated table HTML is appended to this
const NYTRecipesPath = '/Users/rahiggins/Sites/NYT Recipes/'

const URLStartCurrent = 'https://www.nytimes.com/issue/todayspaper/' // Today's Paper URL current prefix
const URLStartPast = 'https://www.nytimes.com/indexes/' // Today's Paper URL past prefix
const URLEndCurrent = '/todays-new-york-times' // Today's Paper URL current suffix
const URLEndPast = '/todayspaper/index.html' // Today's Paper URL past suffix
// const today = Moment();

const debug = true
let url
let MDY // MM/DD/YYYY
let YMD // YYYY/MM/DD
let Day // Sunday | Wednesday
let sect // Magazine | Food
let dateRowHTML = '' // Table HTML for date row
let browser // Puppeteer browser
let page // Puppeteer page
let lastRandom // Last generated random wait interval

let dateEntered // boolean

// Epochs is an array of dates when the Today's Paper format changed
const Epochs = [Moment('2006-04-02'), // Today's Paper begins with class story divs
  Moment('2010-10-27'), // change to columnGroups
  Moment('2017-12-24'), // change to <ol>
  Moment() + Moment.duration(1, 'days')] // tomorrow

const maxEpoch = Epochs.length - 1 // Epochs greater than this are in the future, S.N.O.

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

function getRandomInt (min = 5000, max = 25000, gap = 3000) {
  // Generate a random number of milliseconds between *min* and *max* to be used as
  //  a delay before accessing nytimes.com pages to avoid being blocked as a robot.
  // The number generated must be *gap* seconds or more from the previously returned number, which is
  //  contained in the global variable lastRandom

  let random

  // Find a millisecond delay *gap* seconds or more from the last delay
  do {
    random = Math.floor(Math.random() * (max - min) + min) // The maximum is exclusive and the minimum is inclusive
  } while (Math.abs(random - lastRandom) < gap)
  console.log('Click delay: ' + random.toString() + ' ms')

  // Set the found delay as the last delay and return it\
  lastRandom = random
  return lastRandom
}

async function TPscrape (url, epoch) {
  // Called from Mainline
  // Input is URL of Today's Paper section and
  //          Today's Paper format epoch indicator (1, 2 or 3)
  //
  // Retrieve Today's Paper page
  // Call sectionScrape to extract articles from Todays Paper section {Wednesday: food, Sunday: magazine}
  // For each article, call artScrape to scrape article for title and recipes
  // and return array of article objects = [ {title:, author:, href:, hasRecipes, html:}, ...]

  console.log('TPscrape: entered for ' + url)
  const anch = url.split('#') // ["Today's Paper url", "section name"]
  Log('anch: ' + anch)
  // let prot
  // let hostnm
  // Add activity description to index.html
  const msg = "Retrieving Today's Paper page for " + Day + ', ' + MDY
  global.win.webContents.send('display-msg', msg)

  async function artScrape (artObj) {
    // Called from sectionScrape
    // Input is an artObj object
    // Retrieve article page and scrape:
    //   - presence of And to Drink
    //   - article title decoration
    //   - article title
    //   - article recipes
    // Form table HTML for article title and recipes
    // Return { hasRecipes:, html: }

    const url = artObj.href
    console.log('artScrape entered with url: ' + url)

    const recipeList = []
    const hrefList = [] // Array of hrefs already added to recipeList

    function getTitle ($) {
      // Get a article's title and attibutes:
      //  - article designation (arttype)
      //  - existence of wine pairing advice (ATDPresent)
      // Called from artScrape
      // Input is a Cheerio object containing article page HTML
      // Sets variables h2s, ATDPresent, arttype, title
      Log('Function getTitle entered')

      // See if And to Drink is present
      let ATDPresent = ''
      $('h2.eoo0vm40').each(function () {
        if ($(this).text().includes('And to Drink')) {
          ATDPresent = ' *'
          // console.log("And to Drink found");
          return false // Exit loop
        }
      })

      // var h2a = $(h2s).has("a");
      // console.log("h2s: " + h2s.length.toString());
      // console.log("h2 w/a: " + h2a.length.toString());

      // Check for title decoration (a <p> element of class e6idgb70)
      //  and adjust the article designation (table column 2)
      // The article designation is 'article', unless the title decoration
      //  is 'x of the times', in which case the article designation is 'x'
      //  or the title decoration is a key of the object articleTypes, in
      //  which case the article designation is the value associated with
      //  that key.

      function articleType (key) {
        // Map title decorations (key) to an article designation

        // Define title decorations that have an article designation
        //  other than 'article'
        Log('Function articleType entered')

        const articleTypes = {
          pairings: 'pairings',
          'the pour': 'wine',
          'wine school': 'wine school'
        }

        // Return 'article' for any title decoration not defined
        //  in articleType, else return key value
        Log('Function articleType exiting')
        switch (articleTypes[key]) {
          case undefined:
            return 'article'
          default:
            return articleTypes[key]
        }
      }

      // The default article designation is 'article'
      let arttype = 'article'

      // Title decorations are contained in a <p> element of class e6idgb70.
      // See if a title decoration is present, and if so, see if it
      //  modifies the default article designation
      console.log('Number of class e6idgb70 elements: ' + $('.e6idgb70').length.toString())
      $('.e6idgb70').each(function () {
        if ($(this).text().length > 0) {
          // The class e6idgb70 elements has text and so is title decoration
          const key = $(this).text().toLowerCase()
          console.log('e6idgb70 text (title decoration): ' + key)

          if (key.includes('of the times')) {
            // The title decoration contains 'of the times' so the preceding word
            //  is the article designation
            arttype = key.split(/ of the times/)[0]
            if (arttype.trim() === 'wines') { arttype = 'wine' }
            if (arttype.trim() === 'beers') { arttype = 'beer' }
          } else {
            // Otherwise, call articleType to get the article designation
            arttype = articleType(key)
            console.log('articleType returned: ' + arttype)
          }
        }
      })

      // Get title - first Heading 1
      const titles = $('h1')
      console.log('Titles: ' + titles.length.toString())
      if (titles.length.toString() === 0) {
        console.log('Page html:')
        console.log($.html())
      }
      const title = $(titles[0]).text()
      Log('Function getTitle exiting')
      console.log('title: ' + title)
      console.log("arttype: '" + arttype + "'")

      return [title, arttype, ATDPresent]
    }

    function getRecipes ($) {
      // Called from artScrape
      // Input is a Cheerio query function for the article page HTML
      // Pushes items to the recipeList array [{name:, link:} ...]
      // Returns a boolean indicating whether or not any recipes were found
      Log('getRecipes entered')

      // Look for recipe links, which occur in several formats, in the <section> named articleBody
      //  Extract text and href from <a> elements and push onto
      //  textArray and hrefArray.

      const textArray = []
      const hrefArray = []
      const articleBody = $('section[name=articleBody]')
      // Most common format: <p> elements including text "Recipes:", "Recipe:", "Pairing:", "Pairings:", "Eat:" (5/23/2021) "^Eat:" (1/24/2024)
      $('p.evys1bk0', articleBody).each(function () {
        const pText = $(this).text()
        // console.log("p.evys1bk0 loop - <p> text: " + pText)
        if (pText.match(/^Recipe[s]?:|^Pairing[s]?:|^Eat:|^Related:/) != null) {
          Log('Recipes found - ' + '<p> elements including text "Recipes:", "Recipe:", "Pairing:", "Eat:", "Related:"')
          $('a', $(this)).each(function () {
            const name = $(this).text().trim()
            if (name !== '') { // 4/23/2014 - duplicate <a> elements, 2nd with no text
              const href = $(this).attr('href')
              Log(` ${name}`)
              Log(` ${href}`)
              textArray.push(name)
              hrefArray.push(href)
            }
          })
        }

        // What won't they think of next - 5 Standout Recipes From Julia Reed 9/2/2020
        // Standalone <p> elements consisting solely of a link to a recipe
        // Sometimes a duplicate link in a collection of recipes, with
        //  the text "View the full recipe." - 20 Easy Salads for Hot Summer Days 7/20/2022
        //  Ignore these.
        const paraanch = $('a', this)
        if (paraanch.length === 1 &&
                    paraanch.text() === $(this).text() &&
                    !paraanch.text().startsWith('View') &&
                    paraanch.attr('href').includes('cooking.nytimes.com/recipes')) {
          Log('Recipes found -  standalone <p> element')
          const name = paraanch.text()
          const href = paraanch.attr('href')
          Log(` ${name}`)
          Log(` ${href}`)
          textArray.push(name)
          hrefArray.push(href)
        }

        // <p> element containing <strong> elements that contain a link to a recipe - How Will I Know if My Braise Is Ready? 3/20/2024
        const strongs = $('strong', this)
        if (strongs.length > 0) {
          let first = true
          $('strong a', this).each(function () {
            const href = $(this).attr('href')
            if (href.includes('cooking.nytimes.com/recipes/')) {
              const name = $(this).text()
              textArray.push(name)
              hrefArray.push(href)
              if (first) {
                Log('Recipes found - <p> element comprising <strong> elements')
                first = false
              }
              Log(` ${name}`)
              Log(` ${href}`)
            }
          })
        }
      })

      // Look for Heading 2 elements that have an <a> element referencing cooking.nytimes.com
      //  8/14/2020 A Summer Lunch That Feels Like a Splurge
      //  8/30/2023 Claire Saffitz’s Foolproof Recipe for Making Macarons (multiple <a> elements)
      // Look for h3 elements that contain links and whose href includes 'cooking.nytimes.com/recipes'
      //  2/14/2021 Rediscovering Russian Salad
      //  10/12/2022 Boneless Chicken Thighs Are the Star of These Easy Dinners
      //  11/16/2022 include 'cooking.nytimes.com/recipes' to exclude 'cooking.nytimes.com/thanksgiving'
      $('h2, h3', articleBody).has('a').each(function () {
        const tNm = $(this).prop('tagName')
        if ($('a', this).attr('href').includes('cooking.nytimes.com/recipes')) {
          console.log(`Alternate recipes found - ${tNm} elements`)
          $('a', this).each(function () {
            let name = $(this).text()
            const href = $(this).attr('href')

            // If the <a> element text starts with 'Recipe: ', use the remainder of the text as the recipe's name (3/24/2024)
            const recipeMatch = name.match(/^Recipe: (.*)$/)
            if (recipeMatch) {
              name = recipeMatch[1]
            }

            Log(` ${name}`)
            Log(` ${href}`)
            textArray.push(name)
            hrefArray.push(href)
          })
        }
      })

      // Look for duplicate hrefs.
      //  For Maximum Flavor, Make These Spice Blends at Home - 2/24/2021
      //  I Lost My Appetite Because of Covid. This Sichuan Flavor Brought It Back. - 1/24/2021
      //  How to Turn the Humble Lentil Into an Extravagant Luxury - 3/27/2022
      //  This Sheet-Pan Vegetarian Dinner Can’t Get Much Simpler - 9/27/2023
      // For duplicate hrefs with duplicate names, ignore duplicates.
      //  For duplicate hrefs with disparate names, concatenate the names.
      // Create an array of recipe objects { name: link: } for each unique href.

      let lastHref = ''
      let nameAccum = ''
      for (let i = 0; i < hrefArray.length; i += 1) {
        // For each <a> element ...
        if (hrefArray[i] !== lastHref) {
          // If the href changed ...
          if (lastHref !== '') {
            // ... and it's not the first time through the loop, push the previous recipe to the recipeList array ...
            if (!hrefList.includes(lastHref)) {
              // ... if its href has not already been added to recipeList -
              // 5 Festive Recipes for a Juneteenth Feast - 06/12/2024
              recipeList.push({ name: nameAccum, link: lastHref })
              hrefList.push(lastHref)
            }
            nameAccum = '' // Reset the recipe name accumulator
          }
          // ... save the new href and the new recipe name
          lastHref = hrefArray[i]
          nameAccum = textArray[i]
        } else {
          // If the href hasn't changed ...
          if (textArray[i] !== nameAccum) {
            // ... and the text has changed ...
            nameAccum = nameAccum.concat(' ', textArray[i]) // ... add the changed txt to the recipe name
          }
        }
      } // End of loop
      if (hrefArray.length > 0) {
        // If there are any child <a> elements, push the last recipe to the recipeList array ...
        if (!hrefList.includes(lastHref)) {
          // ... if its href has not already been added to recipeList
          recipeList.push({ name: nameAccum, link: lastHref })
        }
      }

      Log('Function getRecipes exiting')
      console.log('Found ' + recipeList.length.toString() + ' recipes')
      return recipeList.length > 0
    }

    // Retrieve article page
    await new Promise(resolve => setTimeout(resolve, getRandomInt())) // Wait a bit
    Log('Function artScrape navigating to ' + url)
    await page.goto(url)
    Log('Function artScrape getting page content')
    const html = await page.content()
    let $ = cheerio.load(html)
    Log('Function artScrape finished loading page content to Cheerio')

    // Check for a captcha.
    if ($('iframe').attr('src')?.includes('captcha')) {
      // If so, wait until the captcha is solved.
      await page.waitForNavigation() // Navigation to the article page
      const html = await page.content()
      $ = cheerio.load(html)
    }

    // Get title, arttype and ATDPresent
    let [title, arttype, ATDPresent] = getTitle($)
    if (!title) {
      // If a title could not be found (57 Sandwiches That Define New York City - 6/19/2024), use the article title from the Today's Paper page
      title = artObj.title
    }

    // Create article table row
    let tableHTML = ''
    tableHTML = tableHTML + '              <tr>\n                <td><br>\n                </td>\n                <td>' + arttype + '\n'
    tableHTML = tableHTML + '                </td>\n                <td><a href="'
    tableHTML = tableHTML + url + '">' + title + '</a>' + ATDPresent + '</td>\n              </tr>\n'

    const hasRecipes = getRecipes($) // Get recipes
    // Create recipe table rows
    for (const i in recipeList) {
      // For each recipe's URL,Look for redirects from www.nytimes.com
      //  to cooking.nytimes.com.  If found, replace the recipe's
      //  www.nytimes.com URL with the cooking.nytimes.com URL
      //  e.g. https://www.nytimes.com/2009/01/21/dining/211prex.html
      if (recipeList[i].link.includes('www.nytimes.com')) {
        const redirect = await requestPromise(recipeList[i].link)
        if (redirect.request.uri.href.includes('cooking.nytimes.com')) {
          Log('Redirect: ' + recipeList[i].link + ' => ' + redirect.request.uri.href)
          recipeList[i].link = redirect.request.uri.href
        }
      }

      tableHTML = tableHTML + '              <tr>\n                <td><br>\n                </td>\n                <td>recipe\n'
      tableHTML = tableHTML + '                </td>\n                <td><a href="'
      tableHTML = tableHTML + recipeList[i].link + '">' + recipeList[i].name + '</a></td>\n              </tr>\n'
    }
    console.log('artScrape: exiting for ' + url)
    // console.log("artScrape: output hasRecipes: " + hasRecipes);
    // console.log("artScrape: output html: " + tableHTML);
    return {
      hasRecipes,
      html: tableHTML
    }
  }

  async function sectionScrape ($, prot, hostnm) {
    // Called from TPscrape
    // Input:
    //  - a Cheerio object containing Today's Paper page HTML
    //  - the protocol portion of the page's URL
    //  - the hostname portion of the page's URL
    //
    // Find the section that contains food articles, then ...
    // For each article in the designated section:
    //  Create an article object {title:, author:, href:}
    //  Call artScrape to get { hasRecipes:, html:}
    //  Add hasRecipes: and html: to article object
    //  Push article object onto array of article objects
    // Return array of article objects [{title:, author:, href:, hasRecipes:, html: } ...]

    Log('Entering sectionScrape')
    Log('Epoch: ' + epoch.toString())

    const articles = [] // Array of article objects, value returned by sectionScrape
    let sh // div.section-headline element in epoch 1

    // Define names of sections that contain food articles
    const sectionNames = ['magazine', 'food', 'dining', 'diningin,diningout']

    // Find an <a> element whose name belongs to the sectionNames array of
    //  sections containing food articles
    const an = $('a').filter(function () {
      const name = $(this).attr('name')
      if (name === undefined) {
        return false
      } else {
        return sectionNames.includes(name.replace(/\s/g, '').toLowerCase())
      }
    })

    if (epoch === 1) {
      // For the first epoch, find the <a> element's parent whose
      //  class name is "section-headline"
      sh = $(an).parents().filter(function () {
        return $(this).attr('class') === 'section-headline'
      })
    }

    // console.log("Number of anchors: " + an.length.toString())

    // Set section name from the identified <a> element
    sect = $(an).attr('name')
    Log('Section name: ' + sect)

    // Cheerio object containing article elements, set in the following
    //  switch block
    let arts
    let sectionList
    let colGroupParent
    let sib

    switch (epoch) {
      case 3:

        //
        sectionList = $(an).siblings('ol') // ordered list following section
        Log('Number of lists: ' + sectionList.length.toString())
        arts = $(sectionList).children('li') // list items (articles) of ordered list following section
        // console.log("Number of articles: " + arts.length.toString());
        break

      case 2:

        colGroupParent = $(an).parents().filter(function () {
          return $(this).attr('class') === 'columnGroup'
        })
        Log('colGroupParent length: ' + colGroupParent.length.toString())

        arts = $('li', colGroupParent)
        break

      case 1:

        sib = $(sh).next()
        do {
          arts = $(arts).add(sib)
          console.log('Sib: ' + $('a', sib).text())
          sib = $(sib).next()
        } while ($(sib).attr('class') !== 'jumptonavbox')
        break
    }
    Log('Number of articles: ' + arts.length.toString())

    const barLabel = 'Retrieving ' + arts.length.toString() + ' ' + sect + ' section articles for ' + Day + ', ' + MDY
    global.win.webContents.send('create-progressbar', arts.length, barLabel)

    for (let a = 0; a < arts.length; a++) {
      // For each article, create an article object (artObj)

      let artObj // Article object, appended to articles array
      let title
      let author
      let h2
      let href
      let byLine
      let shlAuthor
      const link = $(arts[a]).find('a') // Hyperlink to article

      // According to epoch, collect title, href and author. Create artObj.
      switch (epoch) {
        case 3:
          h2 = $(link).find('h2')
          Log('Article title: ' + $(h2).text())
          Log('Article href: ' + prot + '://' + hostnm + $(link).attr('href'))
          author = $(arts[a]).find('span.css-1n7hynb')
          Log('Author: ' + author.text())
          artObj = { // create an article object
            title: $(h2).text(),
            author: $(author).text(),
            href: prot + '//' + hostnm + $(link).attr('href')
          }
          break

        case 2:
          title = $(link).text().trim()
          Log('Title: ' + title)
          href = $(link).attr('href')
          if (!$(link).attr('href').startsWith('http')) {
            href = prot + '://' + hostnm + $(link).attr('href')
          }
          href = href.split('?')[0]
          Log('href: ' + href)
          byLine = $(arts[a]).find('div.byline')
          if (byLine.length > 0) {
            author = $(arts[a]).find('div.byline').text().split(/By|by/)[1].trim()
          } else {
            author = ''
          }
          Log('Author: ' + author)
          artObj = { // create an article object
            title,
            author,
            href
          }
          break

        case 1:
          title = $(link).text()
          Log('Title: ' + title)
          href = $(link).attr('href').replace('events', 'www')
          console.log('Href: ' + href)
          shlAuthor = $(arts[a]).find('div.storyheadline-author')
          if (shlAuthor.length > 0 & $(shlAuthor).text().match(/by/i) != null) {
            author = $(shlAuthor).text().split(/By|by/)[1].trim()
          } else {
            author = ''
          }
          Log('Author: ' + author)
          artObj = { // create an article object
            title,
            author,
            href
          }
          break
      }

      // Call function artScrape to scrape article page for recipes
      const aTH = await artScrape(artObj)

      // Add values returned by artScrape to the article object (artObj)
      artObj.hasRecipes = aTH.hasRecipes
      artObj.html = aTH.html
      // console.log("sectionScrape: artObj: " + JSON.stringify(artObj));

      // Append this article's artObj to the array returned
      articles.push(artObj)

      // Update progress bar
      global.win.webContents.send('update-progressbar', a + 1, arts.length)
    }
    // console.log(articles);

    // Remove the progress bar div
    global.win.webContents.send('remove-lastMsg')

    // Return array of article objects
    console.log('Exiting sectionScrape')
    return articles
  }

  // Add a throbber icon while retrieving the Today's Paper page
  global.win.webContents.send('add-throbber')

  // Go to Today's Paper page via puppeteer
  Log('Going to page')
  await page.goto(anch[0])
  Log('Back with page')
  // Get location protocol and host name for use in artScrape function
  const urlParts = await page.evaluate(() => {
    const results = []
    results.push(window.location.protocol)
    results.push(window.location.host)
    results.push(window.location.href)
    results.push(window.location.hostname)
    results.push(window.location.pathname)
    return results
  })
  const prot = urlParts[0]
  const hostnm = urlParts[1]
  Log('urlParts: ' + prot + ' ' + hostnm)
  Log('w.l.href: ' + urlParts[2])
  Log('w.l.hostname: ' + urlParts[3])
  Log('w.l.pathname: ' + urlParts[4])
  // Retrieve page html and call sectionScrape to extract articles
  const html = await page.content()
  const $ = cheerio.load(html)
  const scrape = await sectionScrape($, prot, hostnm)
  // console.log("TPscrape: sectionScrape output - " + JSON.stringify(scrape[0]));
  // console.log(scrape)
  console.log('TPscrape: exiting  for ' + url)
  return scrape // array of article objects - [{title:, author:, href:, hasRecipes:, html:}, ...]
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
  console.log('processSelectedArticles: entered')
  return new Promise(function (resolve) {
    ipcMain.once('submitted', (evt, checkedArticleIndicesString) => {
      const checkedArticleIndices = JSON.parse(checkedArticleIndicesString)
      if (checkedArticleIndices.length > 0) { // If any articles were checked, append date row table HTML
        newTableHTML += dateRowHTML
        // fs.appendFileSync(output, dateRowHTML, "utf8");  // (diagnostic)
      }

      // For each checked article, append its table HTML
      for (let j = 0; j < checkedArticleIndices.length; j++) {
        const artHTML = arr[checkedArticleIndices[j]].html
        newTableHTML += artHTML // Append table HTML
        // fs.appendFileSync(output, artHTML);  // (diagnostic)
      }
      console.log('processSelectedArticles: resolving')
      resolve() // Resolve Promise
    })
  })
}

function updateIndexHTML (dates) {
  // Called from Mainline
  // Input: [Moment(first date), Moment(last date)]
  // Returns: true if update performed, false otherwise
  // Replace empty table rows in ~/Sites/NYT Recipes/yyyy/index.html corresponding with new days' table HTML

  // let errmsg; // Error message
  const year = dates[0].format('YYYY')
  const tablePath = NYTRecipesPath + year + '/index.html'
  const table = fs.readFileSync(tablePath, 'UTF-8').toString() // Read year page
  // const newTableHTML = fs.readFileSync(output, "UTF-8").toString();   // Read new table HTML created by this app (diagnostic)
  const tableLastIndex = table.length - 1

  // Find beginning date
  console.log('Finding start of replace')
  const startDateIndex = table.indexOf(dates[0].format('MM/DD/YYYY'))
  if (startDateIndex === -1) {
    console.error('updateIndexHTML: first date ' + dates[0].format('MM/DD/YYYY') + ' not found in index.html')
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
    console.error('updateIndexHTML: unable to find </tr> or <tbody> preceding ' + dates[0].format('MM/DD/YYYY'))
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
  const endDateIndex = table.indexOf(dates[1].format('MM/DD/YYYY'))
  if (endDateIndex === -1) {
    console.error('updateIndexHTML: last date ' + dates[1].format('MM/DD/YYYY') + ' not found in index.html')
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
      console.error('updateIndexHTML: unable to find MM/DD/YYYY or </tbody following ' + dates[1].format('MM/DD/YYYY'))
      return false
    }
  } else {
    nextDateAfterEndDateIndex = nextDateAfterEndDateIndex + endDateIndex + 10
  }
  console.log('updateIndexHTML: MM/DD/YYYY or </tbody following ' + dates[1].format('MM/DD/YYYY') + ': ' + nextDateAfterEndDateIndex.toString())

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
  // Input: a Moment object for the date under consideration
  // Output: {
  //           exists: boolean,
  //           existingHTML: string
  //         }
  console.log('checkExisting entered, date: ' + date.format('YYYY-MM-DD'))

  const yyyy = date.format('YYYY')
  const dashesYMD = date.format('YYYY-MM-DD')
  const dayPath = NYTRecipesPath + yyyy + '/Days/' + dashesYMD + '.txt'
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
  console.log('Entered Mainline, awaiting Puppeteer launch')

  // Construct path to last-date-processed file
  const lastDateFile = path.join(app.getPath('appData'), app.getName(), 'LastDate.txt')
  console.log('lastDateFile: ' + lastDateFile)

  // Connect to a remote instance of Chrome and create a new tab in which to navigate to nytimes.com pages
  await connectPup()
  page = await browser.newPage()
  page.setDefaultNavigationTimeout(0) // Make the navigation timeout unlimited

  async function addArticles (arrString) {
    // Called from Mainline
    // Input is a stringified array of the article objects returned by TPscrape
    // Add event listener, wrapped in a Promise, for the Next/Save button that was added by addArticles
    // Return Promise to Mainline
    //
    // On click of Next/Save button, for each checked article:
    //  append table HTML to newTableHTML
    //
    console.log('addArticles: entered')
    return new Promise(function (resolve) {
      ipcMain.once('added', () => {
        console.log('addArticles: resolving')
        resolve() // Resolve Promise
      })

      // Add designated section article checkboxes to current.html
      const desc = `${sect} section articles for ${Day}, ${MDY}` // Articles description to be displayed
      global.win.webContents.send('add-articles', arrString, desc)
    })
  }

  ipcMain.on('process-date', async (event, enteredDate) => {
    console.log('current.js - date: ' + enteredDate)
    const today = new Date()
    const datesToProcess = [] // array of dates (Moment objects) to process
    let saveLastDate = false // Save LastDate.txt only if datesToProcess were automatically generated
    let msg
    let bumps = [] // Increments to next day: [3, 4] from Sunday or [4, 3] from Wednesday

    // Check if a date was entered
    if (enteredDate === '') {
      // If no date was entered, get the last processed date and
      //  calculate the days to be processedlastDateFile
      dateEntered = false
      const lastDate = Moment(fs.readFileSync(lastDateFile, 'utf8'), 'MM-DD-YYYY')
      if (lastDate.day() === 0) { // If last was Sunday,
        bumps = [3, 4] //  next is Wednesday (+3), then Sunday (+4)
      } else { // If last was Wednesday,
        bumps = [4, 3] //  next is Sunday (+4), then Wednesday (+3)
      }
      const swtch = [1, 0] // bumps toggle
      let s = 0
      let nextDate = lastDate.add(bumps[s], 'days') // nextDate after LastDate processed
      while (nextDate <= today) {
        datesToProcess.push(Moment(nextDate)) // Moment() clones nextDate
        s = swtch[s]
        nextDate = nextDate.add(bumps[s], 'days') // Increment nextDate
      }
      if (datesToProcess.length > 0) {
        saveLastDate = true
      }
    } else {
      // Otherwise, process only the entered date
      dateEntered = true
      datesToProcess.push(Moment(enteredDate))
    }

    let datesToProcessRange = []
    if (datesToProcess.length > 0) {
      datesToProcessRange = [datesToProcess[0], datesToProcess[datesToProcess.length - 1]]
      console.log('datesToProcessRange: ' + datesToProcessRange[0].format('MM/DD/YYYY') + ', ' + datesToProcessRange[1].format('MM/DD/YYYY'))
    }

    // Add "Processing" dates message to index.html
    let processDates = true // Assume there will be dates to process
    switch (datesToProcess.length) {
      case 0:
        msg = 'No new dates to process'
        processDates = false // Assumption wrong, there are no dates to process
        break
      case 1:
        msg = 'Processing ' + datesToProcessRange[0].format('MM/DD/YYYY')
        break
      case 2:
        msg = 'Processing ' + datesToProcessRange[0].format('MM/DD/YYYY') + ' and ' + datesToProcessRange[1].format('MM/DD/YYYY')
        break
      default:
        msg = 'Processing ' + datesToProcessRange[0].format('MM/DD/YYYY') + ' through ' + datesToProcessRange[1].format('MM/DD/YYYY')
    }
    global.win.webContents.send('display-msg', msg)

    if (processDates) { // If there are dates to process ...
      let checkExistingResult
      let compareResult
      const lastDateToProcess = datesToProcess.length - 1
      for (let i = 0; i < datesToProcess.length; i++) {
        // For each date to be processed:

        // Establish Today's Paper format epoch: 1, 2 or 3, where 3 is the current epoch
        let epoch = 0 // Set epoch indicator
        for (const el in Epochs) {
          // For each element of the Epochs array (an epoch begin date) ...

          if (datesToProcess[i] < Epochs[el]) {
            // If the date to process is prior to this begin date,
            //  exit loop
            break
          } else {
            // Increment epoch indicator and repeat
            epoch++
          }
        }

        if (epoch === 0 | epoch > maxEpoch) {
          console.log("Date out of Today's Paper range")
          return
        } else {
          console.log('Epoch ' + epoch.toString())
        }

        MDY = datesToProcess[i].format('MM/DD/YYYY')
        YMD = datesToProcess[i].format('YYYY/MM/DD')
        Day = datesToProcess[i].format('dddd')

        // Set Today's Paper URL according to epoch
        switch (epoch === 3) {
          case true: // Current epoch
            url = `${URLStartCurrent}${YMD}${URLEndCurrent}`
            break

          case false: // Prior epochs
            url = `${URLStartPast}${YMD}${URLEndPast}`
            break
        }

        // Call TPscrape to retrieve designated section articles
        console.log('Mainline: awaiting TPscrape for ' + i.toString() + ' ' + url)
        console.log('sect: ' + sect)
        const artsArray = await TPscrape(url, epoch)
        console.log('Mainline: returned from TPscrape for ' + i.toString() + ' calling addArticles')
        console.log('sect: ' + sect)

        // Create date table row - write to disk in processSelectedArticles
        dateRowHTML = '              <tr>\n                <td class="date"><a href="' + url + '#' + sect + '">'
        dateRowHTML = dateRowHTML + MDY + '</a></td>\n'
        dateRowHTML = dateRowHTML + '                <td class="type"><br>\n'
        dateRowHTML = dateRowHTML + '                </td>\n                <td class="name"><br>\n'
        dateRowHTML = dateRowHTML + '                </td>\n              </tr>\n'

        // Add designated section article checkboxes to index.html
        await addArticles(JSON.stringify(artsArray))

        // Add a Next/Save submit button to index.html
        let buttonText
        if (i < lastDateToProcess) {
          buttonText = 'Next'
        } else {
          if (dateEntered) {
            buttonText = 'Continue'
          } else {
            buttonText = 'Save'
          }
        }
        global.win.webContents.send('add-button', buttonText)

        // Add Next/Save button EventListener and after submit, process checked articles
        console.log('Mainline: awaiting processSelectedArticles')
        await processSelectedArticles(artsArray)
        console.log('Mainline: returned from processSelectedArticles')

        // If a date was entered, see if table HTML already exists
        if (dateEntered) {
          checkExistingResult = checkExisting(datesToProcess[i])
          if (checkExistingResult.exists) {
            compareResult = await dayCompare(newTableHTML, checkExistingResult.existingHTML)
            Log('Action returned: ' + compareResult.action)
            Log('HTML returned: ' + compareResult.mergedHTML)
          }
        }

        // Repeat for next date to be processed
      }

      // Store LastDate processed
      if (saveLastDate) {
        fs.writeFileSync(lastDateFile, MDY, 'utf8')
      }

      if (dateEntered && checkExistingResult.exists) {
        console.log('Date was entered and has existing table HTML')
        console.log('Action: ' + compareResult.action)

        switch (compareResult.action) {
          case 'None':
            msg = 'An identical set of table rows already exists'
            global.win.webContents.send('display-msg', msg)
            datesToProcessRange = []
            newTableHTML = '' // Reset newTableHTML
            break

          case 'Discard':
            global.win.webContents.send('remove-lastMsg')
            msg = 'Changes discarded, existing table rows retained'
            global.win.webContents.send('display-msg', msg)
            datesToProcessRange = []
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

      // Call updateIndexHTML to add new table rows to ~/Sites/NYT Recipes/{yyyy}/index.html
      if (datesToProcessRange.length > 0) {
        if (updateIndexHTML(datesToProcessRange)) {
          console.log('Mainline: index.html updated')
          newTableHTML = '' // Reset newTableHTML

          // Add "Review ..." message and a 'Continue' submit button to index.html
          global.win.webContents.send('add-continue')

          // Call processNewDays to wait for 'Continue' submitted, and then look for new and changed days
          console.log('Mainline: awaiting processNewDays')
          await processNewDays(datesToProcessRange[0].format('YYYY'))
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
    }
    console.log('Mainline: enable Start button')
    global.win.webContents.send('enable-start') // Enable the Start button
  })
}

// End of function definitions

app.on('will-quit', async () => {
  // Close the application's tab in the remote Chrome instance
  if (!browser.isConnected()) {
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

Mainline() // Launch puppeteer and add event listener for Start button
