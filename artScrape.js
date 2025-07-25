// This file is required in the Tampermonkey userscript Scrape and in current.js of the recipe-scraper application. It contains two functions:
// - artScrape
// - nameDiffersFromURL
//
// Function nameDiffersFromURL is called by function artScrape and by function sectionScrape in current.js.
// Function artScrape is called by the Tampermonkey userscript Scrape.

// Data structures
//
// returnObj {
//  ID: "artInfo",
//  hasRecipes: boolean,
//  recipeList: [{ name: string, link: string, inconsistency: booolean } ...],
//  candidates: [{ title: string, url: string }, ...],
//  titleInfo: { title: string, arttype: string, ATDPresent: boolean },
//  url: string
// }

// eslint-disable-next-line no-unused-vars
function nameDiffersFromURL (originalName, href) {
  // For links to cooking.nytimes.com/recipes/, see if the link text is consistent with the recipe name part of the link URL
  // E.g. name "Butter-Poached Carrots" is consistent with URL https://cooking.nytimes.com/recipes/1026250-butter-poached-carrots

  // Input -  recipe name <string>
  //          cooking.nytimes.com URL <string>
  // Output - boolean, true if name differs from URL

  if (!href.includes('cooking.nytimes.com')) {
    return false // This applies only to cooking.nytimes.com URLs
  }

  function consistencyCheck (nameArray, urlArray) {
    // Perform the test that determines if the recipe name text is consistent with the recipe URL.

    // let matches = 0
    let matchFound = false
    for (let i = 0; i < nameArray.length; i++) {
      // If one word is common to both the name and the URL, they are consistent

      if (urlArray.includes(nameWords[i])) {
        // matches += 1
        matchFound = true
        break
      }
    }
    return matchFound
  }

  // Object used to replace letters having diacritics with the corresponding base letter
  const diacritics = {
    a: 'àáâãäåāą',
    c: 'çćč',
    d: 'đď',
    e: 'èéêëěēę',
    i: 'ìíîïī',
    l: 'ł',
    n: 'ñňń',
    o: 'òóôõöøō',
    r: 'ř',
    s: 'šś',
    t: 'ť',
    u: 'ùúûüůŪū',
    y: 'ÿý',
    z: 'žżź',
    A: 'ÀÁÂÃÄÅĀĄ',
    C: 'ÇĆČ',
    D: 'ĐĎ',
    E: 'ÈÉÊËĚĒĘ',
    I: 'ÌÍÎÏĪ',
    L: 'Ł',
    N: 'ÑŇŃ',
    O: 'ÒÓÔÕÕÖØŌ',
    R: 'Ř',
    S: 'ŠŚ',
    T: 'Ť',
    U: 'ÙÚÛÜŮŪ',
    Y: 'ŸÝ',
    Z: 'ŽŻŹ'
  }

  // Remove punctuation (except dashes) from the recipe name and replace multiple consecutive spaces with a single space.
  //  const name = originalName.replace(/^\d{4}:\s/, '').replaceAll(/[,:'?.’’‘()/“”]/g, '').replace(/\n\s*/, ' ').trim()

  // For any letters in the recipe name that have diacritic marks, substitute the unmarked letter. Then split the name at blanks or dashes.
  const nameWords = originalName
    .replaceAll(/[,:'?.’’‘()/“”]/g, '') // Remove all punctuation except dashes
    .replace(/\n\s*/, ' ') // Replace multiple spaces with a single space
    .trim()
    .toLowerCase()
    .split('')
    .map(
      (l) =>
        Object.keys(diacritics).find((k) => diacritics[k].includes(l)) || l
    ) // Replace any letter having a diacritical mark with the corresponding base lettle
    .join('')
    .split(/[\s-]/) // Split the resulting string at spaces and dashes

  // Get the recipe name part of the cooking.nytimes.com URL and split it at dashes.
  let urlWords
  try {
    urlWords = href.match(/^.*\/\d{1,10}?-(.*)$/)[1].split('-')
  } catch (e) {
    // If the match fails, proceed with no url words
    console.log(`urlWords error - ${e}`)
    console.log(`URL: ${href}`)
    console.log(` name: ${originalName}`)
    urlWords = []
  }

  // Check for consistency
  if (consistencyCheck(nameWords, urlWords)) {
    return false
  }
  return true
}

// eslint-disable-next-line no-unused-vars
async function artScrape (returnObj, debug) {
  // Called from the userscript Scrape
  // Input:
  //  - {
  //      ID: 'articleInfo'
  //    }
  //  - a boolean indicating whether or not to write debug information to the console
  // Scrape:
  //   - presence of And to Drink
  //   - article title decoration
  //   - article title
  //   - article recipes
  // Return {
  //            ID: 'articleInfo',
  //            hasRecipes:,
  //            recipeList: [{ name:, link:, inconsistency: } ...],
  //            titleInfo: { title:, arttype:, ATDPresent: },
  //            url:
  //        }

  const urlObj = new URL(window.location.href)
  urlObj.search = ''
  returnObj.url = urlObj.href
  console.log('artScrape entered with url: ' + returnObj.url)

  function Log (text) {
    // If debugging, write text to console.log
    if (debug) {
      console.log(text)
    }
  }

  function getTitle () {
    // Get a article's title and attibutes:
    //  - article designation (arttype)
    //  - existence of wine pairing advice (ATDPresent)
    // Called from artScrape
    // Input is a Cheerio object containing article page HTML
    // Sets variables h2s, ATDPresent, arttype, title
    Log('Function getTitle entered')

    // See if And to Drink is present
    let ATDPresent = ''
    const h2s = document.querySelectorAll('h2.eoo0vm40')
    for (const h2 of h2s) {
      if (h2.textContent.includes('And to Drink')) {
        ATDPresent = ' *'
        // console.log("And to Drink found")
        break
      }
    }

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
    const decorations = document.querySelectorAll('.e6idgb70')
    Log('Number of class e6idgb70 elements: ' + decorations.length.toString())
    for (const decoration of decorations) {
      console.log('e6idgb70 text: "' + decoration.textContent + '"')
      if (decoration.textContent.length > 0) {
        // The class e6idgb70 elements has text and so is title decoration
        const key = decoration.textContent.toLowerCase()
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
          Log('articleType returned: ' + arttype)
        }
      }
    }

    // Get title - first Heading 1
    let title
    const titles = document.querySelectorAll('h1')
    if (titles.length > 0) {
      title = titles[0].textContent
      Log('Title: ' + title)
    } else {
      Log('No titles found')
      title = null
    }
    Log("arttype: '" + arttype + "'")

    return { title, arttype, ATDPresent }
  }

  async function getRecipes () {
    // Called from artScrape
    // Input is a Cheerio query function for the article page HTML
    // Pushes items to the recipeList array [{name:, link:} ...]
    // Returns a boolean indicating whether or not any recipes were found
    Log('getRecipes entered')

    // Look for recipe links, which occur in several formats, in the <section> named articleBody
    //  Extract text and href from <a> elements and push onto
    //  textArray and hrefArray.

    const recipeList = [] // Array of recipe objects { name:, link: }
    const hrefList = [] // Array of hrefs already added to recipeList

    const textArray = []
    const hrefArray = []
    const inconsistentArray = []
    // Limit the recipe search to the body of the article, which is contained in a <section> element named articleBody or an <article> element (1/8/2025 - An Easy One-Pot Method for Vegetarian Meals)
    const articleBody = document.querySelector('section[name="articleBody"], article')
    if (!articleBody) {
      Log('No articleBody found')
      return [false, []]
    }
    // Most common format: <p> elements including text "Recipes:", "Recipe:", "Pairing:", "Pairings:", "Eat:" (5/23/2021) "^Eat:" (1/24/2024)
    // Added class pantry--body-long "The Surprising Trick for Cooking Rice That Works for Any Grain" 2/5/2025
    const paras = articleBody.querySelectorAll('p.evys1bk0, p.pantry--body-long')
    for (const para of paras) {
      let name
      let href
      let inconsistent
      let first = true
      const pText = para.textContent
      // console.log("p.evys1bk0 loop - <p> text: " + pText)
      if (pText.match(/^Recipe[s]?:|^Pairing[s]?:|^Eat:|^Related:/) != null) {
        Log('Recipes found - ' + '<p> elements including text "Recipes:", "Recipe:", "Pairing:", "Eat:", "Related:"')
        const links = para.querySelectorAll('a')
        for (const link of links) {
          name = link.textContent.trim()
          if (name !== '') { // 4/23/2014 - duplicate <a> elements, 2nd with no text
            href = link.href
            inconsistent = false
            if (nameDiffersFromURL(name, href)) {
              inconsistent = true
            }
            Log(` ${name}`)
            Log(` ${href}`)
            Log(` ${inconsistent}`)
            textArray.push(name)
            hrefArray.push(href)
            inconsistentArray.push(inconsistent)
          }
        }
      }

      // What won't they think of next - 5 Standout Recipes From Julia Reed 9/2/2020
      // Standalone <p> elements consisting solely of a link to a recipe
      // Sometimes a duplicate link in a collection of recipes, with
      //  the text "View the full recipe." - 20 Easy Salads for Hot Summer Days 7/20/2022
      //  Ignore these.
      const paraanch = para.querySelectorAll('a')
      if (paraanch.length === 1 &&
                    paraanch.textContent === para.textContent &&
                    !paraanch.textContent.startsWith('View') &&
                    paraanch.href.includes('cooking.nytimes.com/recipes')) {
        Log('Recipes found -  standalone <p> element')
        name = paraanch.textContent
        href = paraanch.href
        inconsistent = false
        if (nameDiffersFromURL(name, href)) {
          inconsistent = true
        }
        Log(` ${name}`)
        Log(` ${href}`)
        Log(` ${inconsistent}`)
        textArray.push(name)
        hrefArray.push(href)
        inconsistentArray.push(inconsistent)
      }

      // <p> element containing <strong> elements that contain a link to a recipe - How Will I Know if My Braise Is Ready? 3/20/2024
      const strongs = para.querySelectorAll('strong')
      if (strongs.length > 0) {
        for (const strong of strongs) {
          const as = strong.querySelectorAll('a')
          for (const a of as) {
            href = a.href
            name = a.textContent
            if (href.includes('cooking.nytimes.com/recipes/')) {
              inconsistent = false
              if (nameDiffersFromURL(name, href)) {
                inconsistent = true
              }
              textArray.push(name)
              hrefArray.push(href)
              inconsistentArray.push(inconsistent)
              if (first) {
                Log('Recipes found - <p> element comprising <strong> elements')
                first = false
              }
              Log(` ${name}`)
              Log(` ${href}`)
              Log(` ${inconsistent}`)
            }
          }
        }
      }
    }

    // Look for Heading 2 elements that have an <a> element referencing cooking.nytimes.com
    //  8/14/2020 A Summer Lunch That Feels Like a Splurge
    //  8/30/2023 Claire Saffitz’s Foolproof Recipe for Making Macarons (multiple <a> elements)
    // Look for h3 elements that contain links and whose href includes 'cooking.nytimes.com/recipes'
    //  2/14/2021 Rediscovering Russian Salad
    //  10/12/2022 Boneless Chicken Thighs Are the Star of These Easy Dinners
    //  11/16/2022 include 'cooking.nytimes.com/recipes' to exclude 'cooking.nytimes.com/thanksgiving'
    const headings = Array.from(articleBody.querySelectorAll('h2, h3'))
      .filter((el) => el.querySelector('a'))
    for (const heading of headings) {
      let name
      let href
      let inconsistent = false
      const tNm = heading.tagName
      if (heading.querySelector('a').href.includes('cooking.nytimes.com/recipes')) {
        console.log(`Alternate recipes found - ${tNm} elements`)
        const links = heading.querySelectorAll('a')
        for (const link of links) {
          name = link.textContent
          href = link.href

          // If the <a> element text starts with 'Recipe: ', use the remainder of the text as the recipe's name (3/24/2024)
          const recipeMatch = name.match(/^Recipe: (.*)$/)
          if (recipeMatch) {
            name = recipeMatch[1]
          }

          if (nameDiffersFromURL(name, href)) {
            // If the <a> element text is 'see the recipe', use the text of the <h2> element in the parent div (11/13/2024 - Meet Your New Thanksgiving Pie)
            // (12/8/2024 - The Only Holiday Cookie Recipes You’ll Need This Year)
            if (name.toLowerCase().endsWith('recipe')) {
              const parentDiv = link.closest('div')
              name = parentDiv.querySelector('h2')?.textContent
              if (!name) {
                name = 'h3 recipe name not found'
                inconsistent = false
              }
            } else {
              inconsistent = true
            }
          }
          textArray.push(name)
          hrefArray.push(href)
          inconsistentArray.push(inconsistent)
          Log(` ${name}`)
          Log(` ${href}`)
          Log(` ${inconsistent}`)
        }
      }
    }

    // Look for recipes in Related Links blocks. Recipes in Related Links blocks are only candidates for inclusion. The recipe must be examined for a 'featured in' link to the article being scraped.
    // 3/12/2025 'The Secret to Great Pancakes Has Been in Your Pantry All Along'
    // 5/25/2025 'This Filipino Chicken Soup Heals and Restores'
    // 6/18/2025 'The Ever-Evolving Juneteenth Table'

    // Related Links blocks must be scrolled into view to load their contents and control must be relinquished in order to allow their contents to be loaded.
    const lazy = document.querySelectorAll('div[data-testid="lazy-loader"]')
    console.log('Number of lazy-loader instances: ' + lazy.length.toString())
    for (let i = 0; i < lazy.length; i++) {
      lazy[i].scrollIntoView()
      console.log('waiting')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await new Promise(resolve => setTimeout(resolve, 1000))

    const related = document.querySelectorAll('.related-links-block')
    console.log('Number of related-links-block instances: ' + related.length.toString())

    // Filter out related Links block recipes that have already been encountered in the article body.
    const candidatesArray = [] // Array of candidate recipes from Related Links blocks
    const candidates = document.querySelectorAll('.related-links-block a')
    console.log('Number of related recipes: ' + candidates.length.toString())
    for (const candidate of candidates) {
      if (candidate.href.startsWith('https://cooking.nytimes.com')) {
        let push = true
        for (const href of hrefArray) {
          console.log('Comparing candidates to recipes')
          console.log('recipe: ' + href)
          console.log('candidate: ' + candidate.href)
          if (href === candidate.href) {
            console.log('comparison equal')
            push = false
            break
          }
        }
        if (push) {
          // If the recipe was not in the article body, add it to the candidates
          candidatesArray.push({
            title: candidate.querySelector('div:nth-child(2) > div:nth-child(2)').textContent,
            url: candidate.href
          })
        }
      }
    }

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
    let inconsistentAccum = false
    for (let i = 0; i < hrefArray.length; i++) {
      // For each <a> element look for duplicates in the remaining <a> elements
      nameAccum = textArray[i]
      lastHref = hrefArray[i]
      inconsistentAccum = inconsistentArray[i]
      for (let j = i + 1; j < hrefArray.length; j++) {
        // For each of the remaining <a> elements ...
        if (hrefArray[j] === lastHref) {
          // If the hrefs are the same ...
          if (inconsistentAccum) {
            // If the current href's text is inconsistent, use the text of the matching href in the remaining elements
            nameAccum = textArray[j]
            inconsistentAccum = inconsistentArray[j]
          } else if (textArray[j] !== nameAccum && !inconsistentArray[j]) {
            // Otherwise, if the text of the matching href in the remaining elements is not the same as the text of the current href and is not inconsistent, concatenate that text to the text of the current href.
            nameAccum = nameAccum.concat(' ', textArray[j])
          }
        }
      }
      if (!hrefList.includes(lastHref)) {
        // If the href has not already been added to the recipeList, add it
        hrefList.push(lastHref)
        recipeList.push({ name: nameAccum, link: lastHref, inconsistency: inconsistentAccum })
      }
    }

    Log('Function getRecipes exiting')
    console.log('Found ' + recipeList.length.toString() + ' recipes')
    return [recipeList.length > 0, recipeList, candidatesArray]
  }

  // Get title, arttype and ATDPresent
  returnObj.titleInfo = getTitle()

  // Get recipes and candidate recipes from Related Links blocks
  const [hasRecipes, recipeList, candidates] = await getRecipes() // Get recipes
  returnObj.hasRecipes = hasRecipes
  returnObj.recipeList = recipeList
  returnObj.candidates = candidates

  console.log('returnObj:')
  console.log(returnObj)
  return returnObj
}

if (typeof process === 'object' && process.release.name === 'node') {
  module.exports = { artScrape, nameDiffersFromURL }
}
