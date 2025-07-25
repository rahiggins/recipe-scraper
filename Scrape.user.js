// ==UserScript==
// @name         Scrape
// @namespace    http://tampermonkey.net/
// @version      2025-07-23
// @description  Scrape NYT articles for recipes plus look for related-block recipes
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

    // Send the object returned by artScrap to the recipe-scraper application. Return a promise. Upon receipt of a response, resolve the promise and
    // open any candidate recipes (recipes extracted from related links blocks) in new tabs at half second intervals.
    async function sendArticleObj (Obj) {
        return new Promise (function (resolve) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'http://localhost:8012',
                data: JSON.stringify(Obj),
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8'
                },
                async onload (response) {
                    const responseObj = JSON.parse(response.responseText)
                    console.log('HTTP response messsage: ' + responseObj.message)
                    resolve()
                    for (const candidate of Obj.candidates) {
                        GM_openInTab(candidate.url)
                        await new Promise(resolve => setTimeout(resolve, 500))
                    }
                    if (responseObj.message === 'OK' && !debug) {
                        window.close()
                    }
                }
            })
        })
    }

    console.log('userscript ScrapePlus entered')

    // Create an object to send to the recipe-scraper application with information about the article
    let Obj = { ID: 'artInfo' }

    // Call function artScrape (in artScrape.js) to scrape the page for recipes
    // eslint-disable-next-line no-undef
    Obj = await artScrape(Obj, debug)

    Log('Scrape returnObj')
    Log(Obj)

    // Send the output of artScrape to the recipe-scraper application and open any candidate recipes in tabs.
    await sendArticleObj(Obj)

})()
