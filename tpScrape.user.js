// ==UserScript==
// @name         tpScrape
// @namespace    http://tampermonkey.net/
// @version      2025-07-23
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
// @grant        GM_openInTab
// @connect      localhost

// @require      file:///Users/rahiggins/Apps/recipe-scraper/tpScrape.js
// ==/UserScript==

(async function() {
    'use strict';

    const debug = false

    const menu_command_id = GM_registerMenuCommand("tpScrape", async () => {
        console.log('Userscript tpScrape entered')

        // Send the object returned by TPscrape to the recipe-scraper application. Return a promise. Resolve the promise upon receipt of a response.
        async function sendArticleArray (tpObj) {
            return new Promise (function (resolve) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'http://localhost:8012',
                    data: JSON.stringify(tpObj),
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8'
                    },
                    onload (response) {
                        const responseObj = JSON.parse(response.responseText)
                        console.log(responseObj.message)
                        resolve()
                    }
                })
            })
        }

        const location = window.location
        const href = location.href.split('?', 1)[0]
        console.log(href)
        // eslint-disable-next-line no-undef
        const tpObj = TPscrape(location, debug)
        console.log('tpScrape result:')
        console.log(tpObj)

        // Send the object returned from function TPscrape to the recipe-scraper application
        await sendArticleArray(tpObj)

        // Open each article in a new tab and make the tab visible
        const articles = tpObj.articles
        for (const article of articles) {
            GM_openInTab(article.tpHref, { active: true })
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }, "t");
})();