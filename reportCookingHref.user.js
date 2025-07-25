// ==UserScript==
// @name         reportCookingHref
// @namespace    http://tampermonkey.net/
// @version      2025-07-23
// @description  Send an NYT Cooking recipe's related article URL to the recipe-scraper application
// @author       You
// @match        https://cooking.nytimes.com/recipes/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cooking.nytimes.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    console.log('Userscript reportCookingHref entered')
    const debug = false

    const location = window.location
    const recipeURL = location.href.split('?', 1)[0]

    const Obj = {
                  ID: 'recipeRelatedArticle',
                  recipeURL: recipeURL
                }

    const relatedLink = document.querySelector('p[class^="topnote_relatedArticle"] a')
    if (relatedLink) {
        Obj.relatedArticleURL = relatedLink.href
        console.log('relatedArticleURL: ' + Obj.relatedArticleURL)
    }

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
})();