// ==UserScript==
// @name         Scrape
// @namespace    http://tampermonkey.net/
// @version      2025-07-10
// @description  Scrape NYT articles for recipes
// @author       Me
// @match        https://www.nytimes.com/*
// @match        https://cooking.nytimes.com/article/*
// @match        https://archive.nytimes.com/*
// @exclude      https://www.nytimes.com/issue/*
// @exclude      https://archive.nytimes.com/www.nytimes.com/indexes/*/*/*/todayspaper/index.html
// @exclude      */embeddedinteractive/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nytimes.com
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      localhost

// @require      file:///Users/rahiggins/Apps/recipe-scraper/artScrape.js
// ==/UserScript==

(async function () {
  'use strict'

  const debug = false

  function Log (text) {
    // If debugging, write text to console.log
    if (debug) {
      console.log(text)
    }
  }

  console.log('userscript Scrape entered')

  // Create an object to send to the recipe-scraper application with information about the article
  let Obj = { ID: 'artInfo' }

  // Call function artScrape (in artScrape.js) to scrape the page for recipes
  // eslint-disable-next-line no-undef
  Obj = artScrape(Obj, debug)

  Log('Scrape returnObj')
  Log(Obj)

  // Send the stringified object to the recipe-scraper application
  // eslint-disable-next-line no-undef
  GM_xmlhttpRequest({
    method: 'POST',
    url: 'http://localhost:8012',
    data: JSON.stringify(Obj),
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    onload (response) {
      const responseObj = JSON.parse(response.responseText)
      if (responseObj.message === 'OK' && !debug) {
        window.close()
      }
    }
  })
})()
