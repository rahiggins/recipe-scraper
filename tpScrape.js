// This file is included in the tpScrape userscript via require

// eslint-disable-next-line no-unused-vars
function TPscrape (location, debug) {
  // Called from the tpScrape userscript
  // Input is window.location object of the Today's Paper page
  //
  // Collect information from the food section  {Wednesday: Food, Sunday: Magazine} of an NYT Today's Paper page
  // - article titles
  // - article authors
  // - article URLs
  //
  // Data structures
  //
  // artObj {
  //  tpTitle: string,
  //  author: string,
  //  tpHref: string,
  //  index: number,
  // }
  //
  // return object {
  //  ID: 'articleArray',
  //  url: string,
  //  sectionName: string,
  //  articles: [artObj, artObj, ..., artObj]
  // }

  console.log('TPscrape: entered for ' + location.href)

  function Log (text) {
    // If debugging, write text to console.log
    if (debug) {
      console.log(text)
    }
  }

  const prot = location.protocol
  const hostnm = location.hostname
  const tpDate = location.pathname.replace(/^.*?\/(\d{4})\/(\d{2})\/(\d{2}).*$/, '$1-$2-$3')
  Log('tpDate: ' + tpDate)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  // Epochs is an array of dates when the Today's Paper format changed
  const Epochs = ['2006-04-02', // Today's Paper begins with class story divs
    '2010-10-27', // change to columnGroups
    '2017-12-24', // change to <ol>
    `${tomorrow.getFullYear().toString()}-${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getDate().toString().padStart(2, '0')}`] // tomorrow

  const maxEpoch = Epochs.length - 1 // Epochs greater than this are in the future, S.N.O.

  // Establish Today's Paper format epoch: 1, 2 or 3, where 3 is the current epoch
  let epoch = 0 // Initialize the epoch indicator
  for (const ep of Epochs) {
    // For each element of the Epochs array (an epoch begin date) ...

    if (tpDate < ep) {
      // If the date to process is prior to this begin date,
      //  exit loop
      break
    } else {
      // Increment epoch indicator and repeat
      epoch += 1
    }
  }

  Log('Epochs: ' + Epochs)
  Log('Epoch: ' + epoch.toString())

  if (epoch === 0 | epoch > maxEpoch) {
    console.log("Date out of Today's Paper range")
    return
  } else {
    Log('Epoch ' + epoch.toString())
  }

  const anch = location.href.split('#') // ["Today's Paper url", "section name"]
  Log('anch: ' + anch)

  // Scroll to the section that contains food articles
  const sects = document.querySelectorAll('ol li a, div.jumptonav a, div.jumpToModule div.refer a')
  const sectionNames = ['magazine', 'food', 'dining', 'diningin,diningout', 'dining in, dining out']

  let sect
  for (sect of sects) {
    // Look for a section that contains food articles
    const name = sect.textContent.toLowerCase() // Get the section name
    if (!name) {
      continue
    }
    if (sectionNames.includes(name)) {
      break
    }
  }
  let sectionAnchor
  let sectionAnchorURL
  if (sectionNames.includes(sect.textContent.toLowerCase())) {
    sectionAnchor = document.querySelector(`a[name*="${sect.textContent}"], a[name*="${sect.textContent.toLowerCase()}"], a[name*="dining"]`)
    sectionAnchorURL = sectionAnchor.baseURI + '#' + sectionAnchor.getAttribute('name')
    sectionAnchor.scrollIntoView()
  } else {
    console.log('No food section found')
    return // Should notify the recipe-scraper app
  }

  Log('urlParts: ' + prot + ' ' + hostnm)
  const articles = [] // Array of artObj objects, returned by sectionScrape
  let sh // div.section-headline element in epoch 1

  if (epoch === 1) {
    // For the first epoch, find the <a> element's parent whose
    //  class name is "section-headline"
    sh = sectionAnchor.closest('.section-headline')
    Log('typeof sh: ' + typeof sh)
  }

  // Article elements, set in the following switch block
  let arts
  let sectionList
  let colGroupParent
  let sib

  switch (epoch) {
    case 3:

      sectionList = sectionAnchor.parentElement.querySelector('ol')
      sect = sectionAnchor.parentElement.querySelector('h2').textContent
      arts = sectionList.querySelectorAll('li')
      break

    case 2:

      sect = sectionAnchor.parentElement.innerText.split('').map((c, idx) => idx === 0 ? c.toUpperCase() : c.toLocaleLowerCase()).join('')
      colGroupParent = sectionAnchor.closest('.columnGroup')
      arts = colGroupParent.querySelectorAll('li')
      break

    case 1:

      sect = sectionAnchor.getAttribute('name')
      sib = sh.nextElementSibling
      arts = []
      do {
        arts.push(sib)
        sib = sib.nextElementSibling
      } while (!sib?.className.includes('jumptonavbox'))
      break
  }
  Log('Section name: ' + sect)
  Log('Number of articles: ' + arts.length.toString())

  for (let a = 0; a < arts.length; a++) {
    // For each article, create an article object (artObj)

    let artObj // Article object, appended to articles array
    let tpTitle
    let author
    let tpHref
    let byLine
    const link = arts[a].querySelector('a')

    // According to epoch, collect title, href and author. Create artObj.
    switch (epoch) {
      case 3:
        tpTitle = link.querySelector('h2').textContent
        Log('Article title: ' + tpTitle)
        tpHref = link.getAttribute('href')
        if (!tpHref.startsWith('https')) {
          // 12/4/2024 - You Might Be Storing Cheese All Wrong
          tpHref = prot + '//' + hostnm + tpHref
        }
        Log('Article href: ' + tpHref)
        author = arts[a].querySelector('span.css-1n7hynb')?.textContent
        if (!author) {
          author = ''
        }
        Log('Author: ' + author)
        artObj = { // create an article object
          tpTitle,
          author,
          tpHref
        }
        break

      case 2:
        tpTitle = link.textContent.trim()
        Log('Title: ' + tpTitle)
        tpHref = link.getAttribute('href')
        if (!tpHref.startsWith('http')) {
          tpHref = prot + '://' + hostnm + tpHref
        }
        tpHref = tpHref.split('?')[0]
        Log('href: ' + tpHref)
        byLine = arts[a].querySelector('div.byline')
        if (byLine) {
          author = byLine.textContent.split(/By|by/)[1].trim()
        } else {
          author = ''
        }
        Log('Author: ' + author)
        artObj = { // create an article object
          tpTitle,
          author,
          tpHref
        }
        break

      case 1:
        tpTitle = link.textContent
        Log('Title: ' + tpTitle)
        tpHref = link.getAttribute('href').replace('events', 'www')
        console.log('Href: ' + tpHref)
        author = arts[a].querySelector('div.storyheadline-author')?.textContent
        if (author) {
          author = author.replace(/by\s/i, '')
        } else {
          author = ''
        }
        Log('Author: ' + author)
        artObj = { // create an article object
          tpTitle,
          author,
          tpHref
        }
        break
    }

    // Remove any search string from the article's URL
    const urlObj = new URL(artObj.tpHref)
    if (urlObj.pathname.includes('todayspaper')) continue
    urlObj.search = ''
    artObj.tpHref = urlObj.href

    // Add an index to the article's artObj
    artObj.index = a

    // Append this article's artObj to the array returned
    articles.push(artObj)
  }

  console.log('TPscrape: exiting  for ' + location.href)
  return {
    ID: 'articleArray',
    url: sectionAnchorURL,
    sectionName: sect,
    articles // array of artObj objects - [{ tpTitle:, author:, tpHref: }, ...]
  }
}
