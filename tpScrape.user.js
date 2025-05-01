// ==UserScript==
// @name         tpScrape
// @namespace    http://tampermonkey.net/
// @version      2025-03-30
// @description  Scrape a Today's Paper page for food articles
// @author       You
// @exclude      https://www.nytimes.com/www.nytimes.com/indexes/*/*/*/index.html#*
// @exclude      https://archive.nytimes.com/www.nytimes.com/indexes/*/*/*/*/index.html#*
// @match        https://www.nytimes.com/issue/todayspaper/*
// @match        https://www.nytimes.com/www.nytimes.com/indexes/*/*/*/index.html
// @match        https://archive.nytimes.com/www.nytimes.com/indexes/*/*/*/*/index.html
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nytimes.com
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      localhost

// @require      file:///Users/rahiggins/Apps/recipe-scraper-manual-click/tpScrape.js
// ==/UserScript==

(function() {
    'use strict';

    const debug = false

    // eslint-disable-next-line no-undef
    const menu_command_id = GM_registerMenuCommand("tpScrape", async () => {
        console.log('Userscript tpScrape entered')
        const location = window.location
        const href = location.href.split('?', 1)[0]
        console.log(href)
        // eslint-disable-next-line no-undef
        const tpObj = TPscrape(location, debug)
        console.log('tpScrape result:')
        console.log(tpObj)

        // Send the stringified object to the recipe-scraper application
        // eslint-disable-next-line no-undef
        GM_xmlhttpRequest({
          method: 'POST',
          url: 'http://localhost:8012',
          data: JSON.stringify(tpObj),
          headers: {
            'Content-Type': 'application/json; charset=UTF-8'
          },
          onload (response) {
            const responseObj = JSON.parse(response.responseText)
            console.lof(responseObj.message)
          }
        })
    }, "t");
})();