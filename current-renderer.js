// This file is invoked by the current.html file and will
// be executed in the renderer process for that window.

//  Manual click version 3.1.0

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//    function Log
//    function addMsg
//    function remvAllMsg
//    function addProgress
//    function articleClick
//     window.scraper.articleClick
//
//  datesList.addEventListener for 'click'
//   window.scraper.send('openTP')
//
//  dateSpec.addEventListener for 'change'
//   window.scraper.send('process-date')
//
//  reviewButton.addEventListener for 'click'
//   window.scraper.send('AOT')
//   window.scraper.submitted
//
//  window.scraper.onDisplayMsg
//    calls function addMsg
//
//  window.scraper.onRemoveMsgs
//    calls function remvAllMsg
//
//  window.scraper.onAddArticles
//    window.scraper.send('AOT')
//    document.addEventListener for 'click'
//     calls function articleClick
//    window.scraper.added
//
//  window.scraper.onUpdateMaxDate
//
//  window.scraper.onAddButton
//    'aList' EventListener for 'submit'
//      window.scraper.send 'article-click', 'close'
//      event.sender.send 'submitted'
//
//  window.scraper.onAddContinue
//
//  window.scraper.onEnableContinue
//    'aList' EventListener for 'click'
//    window.scraper.send('continue')
//
//  window.scraper.onCreateButton
//    function createButton
//    function buttonSubmitted
//      window.scraper.send('button-action')
//    buttons.lastChild EventListener for 'submit'
//    event.sender.send('created')
//
//  window.scraper.onEnableActionButton
//
//  window.scraper.onDisplayTableCompare
//
//  window.scraper.onRemoveLastMsg

const debug = true

const datesDiv = document.getElementById('datesDiv') // dates to process list div
const datesList = document.getElementById('datesList') // dates to process list
const dateSpec = document.getElementById('dateSpec')
const aL = document.getElementById('aL') // article list div
const mL = document.getElementById('msgs') // messages list div
const buttons = document.getElementById('buttons') // tableCompare buttons div
const tableCompare = document.getElementById('tableCompare') // tableCompare table tbody element
const reviewButton = document.getElementById('reviewButton') // submit button
const articleTemplateContent = document.getElementById('articleTemplate').content
let articlesIndexArray = [] // Array of article indices of articles added to the window
let articleInfoObjsArray = [] // Array of article info objects sent from the main process
let todaysPaperURL // URL of the date being processed Today's Paper page
let removeDateListItem // true if processing a dateList element, false if date was picked

// Function definitions

function Log (text) {
  // If debugging, write text to console.log
  if (debug) {
    console.log(text)
  }
}

// addMsg creates a <p> element containing message text and adds it to the msgs div
function addMsg (msgDiv, msg, opt) {
  // Add a message to the #msgs div
  // If opt { indent: true }, add padding-left to message
  // Called throughout

  if (typeof opt === 'undefined') {
    opt = {
      indent: false
    }
  }
  const para = document.createElement('p')
  para.className = 'msg'
  if (opt.indent) {
    para.classList.add('pl-2')
  }
  const txnd = document.createTextNode(msg)
  para.appendChild(txnd)
  msgDiv.appendChild(para)
}

// remvAllMsg removes all messages from the msgs div
function remvAllMsg (msgDiv) {
  // Remove all messages in the #msgs div
  // Called throughout

  while (msgDiv.firstChild) {
    msgDiv.removeChild(msgDiv.lastChild)
  }
}

function articleClick (evt) {
  // Called by click on article title
  // Input is a click event
  // Process click on article titles

  if (evt.target.classList.contains('article')) {
    evt.preventDefault()
    const artIdx = evt.target.parentNode.firstChild.value
    console.log('Article clicked: ' + articleInfoObjsArray[artIdx].titleInfo.title)
    window.scraper.articleClick('click', articleInfoObjsArray[artIdx].url)
  }
}

// Add the dates to be processed to the window
const datesToProcess = JSON.parse(window.scraper.datesToProcessString)
if (datesToProcess.length > 0) {
  for (const date of datesToProcess) {
    datesList.insertAdjacentHTML('beforeend', date)
  }
} else {
  datesDiv.innerText = 'There are no new dates to process'
}

datesList.addEventListener('click', (evt) => {
  // Process click on a date in the dateList
  evt.preventDefault()
  console.log(evt.target.tagName)
  todaysPaperURL = evt.target.getAttribute('href')
  console.log('Go to: ' + todaysPaperURL)
  window.scraper.send('openTP', todaysPaperURL) // Open the Today's Paper page for the selected date
  removeDateListItem = true // Remove the date from the dateList after it's been processed
})

// Set the minimum and maximum dates for the type=date input field dateSpec
// The minimum date is 2006-04-02 because there's no Today's Paper before that date
const dateInput = document.getElementById('dateSpec')
dateInput.min = '2006-04-02'
dateInput.max = window.scraper.maxPickableDate

dateSpec.addEventListener('change', (evt) => {
  // Process a date selected in the dateSpec input field
  Log('dateSpec: ' + evt.target.value)
  window.scraper.send('process-date', evt.target.value) // Send the selected date to the main process
  removeDateListItem = false // Don't try to remove the date from the dateList
})

reviewButton.addEventListener('click', async (evt) => {
  // Process click on the Submit button
  evt.preventDefault()
  console.log('Mainline: Review button clicked, disable Review button')
  reviewButton.classList.add('disabled') // Disable the Submit button

  document.removeEventListener('click', articleClick)
  const ckd = document.querySelectorAll('input:checked') // Get checked articles
  const checkedArticleIndices = [] // Returned to the main process
  // For each checked article, add its index to the return array
  for (let j = 0; j < ckd.length; j++) {
    checkedArticleIndices.push(parseInt(ckd[j].value))
  }

  // Remove article checkboxes
  while (aL.firstChild) {
    aL.removeChild(aL.lastChild)
  }
  articlesIndexArray = [] // Reset array of article indices added to the window
  articleInfoObjsArray = [] // Reset array of article info objects sent from the main process
  if (removeDateListItem) {
    // Remove the submitted articles' date from the dateList
    Array.from(datesList.querySelectorAll('a')).filter((el) => el.getAttribute('href') === todaysPaperURL)[0].remove()
  }
  window.scraper.send('AOT', false) // Set the window's 'always on top' attribute to false

  // Send the array for checked article indices to the main process
  window.scraper.review(JSON.stringify(checkedArticleIndices))
})

window.scraper.onDisplayMsg((msg, opt) => {
  // Display a message
  addMsg(mL, msg, opt)
})

window.scraper.onRemoveMsgs((div) => {
  // Remove all messages from the specified div
  switch (div) {
    case 'msgs':
      remvAllMsg(mL)
      break
    case 'progressBar':
      // remvAllMsg(pB)
      break
    case 'all':
      remvAllMsg(mL)
      remvAllMsg(aL)
      break
    default:
      remvAllMsg(mL)
  }
})

window.scraper.onAddArticles((event, artInfoObjString) => {
  // args - an array:
  //          - a stringified array of article objects returned by TPscrape
  //
  // Add checkboxes for articles returned by TPscrape to the window

  console.log('addArticles: entered')

  const artInfo = JSON.parse(artInfoObjString)
  Log(artInfo)

  // Clone the article template an get the elements that will be filled in
  const article = articleTemplateContent.cloneNode(true)
  const cbLabel = article.querySelector('label')
  const cbInput = article.querySelector('input')
  const cbTitle = article.querySelector('.article')
  const cbAuthor = article.querySelector('.author')

  // If the Submit button is disabled, this is the first article being added. Enable the button, add an event listener for clicks on articles and set the window's 'always on top' attribute to true
  if (reviewButton.classList.contains('disabled')) {
    reviewButton.classList.remove('disabled')
    document.addEventListener('click', articleClick)
    window.scraper.send('AOT', true)
  }

  // Fill in article elements with the article's information
  const idx = artInfo.index.toString()
  cbLabel.id = 'li' + idx
  cbInput.id = 'cbi' + idx
  cbInput.value = idx
  cbInput.name = 'cbn' + idx
  if (artInfo.hasRecipes) {
    cbInput.checked = true
  }
  cbTitle.innerText = artInfo.titleInfo.title
  cbAuthor.innerText = artInfo.author

  // Find the index of the first previously added article that is greater than this article's index.
  const followingArticleIndex = articlesIndexArray.findIndex((element) => element > artInfo.index)
  Log('Indices: ' + artInfo.index + ', ' + followingArticleIndex)
  if (followingArticleIndex === -1) {
    // If no such index is foudn, add the article to the end of the article list
    aL.appendChild(article)
  } else {
    // Otherwise, insert this article before the article whose index was found
    const followingArticle = document.getElementById('li' + followingArticleIndex)
    const newArticle = article.querySelector('label')
    followingArticle.insertAdjacentElement('beforebegin', newArticle)
  }

  // Add the article's index and artInfo object to their respective arrays and tell the main process that the article was added
  articlesIndexArray[artInfo.index] = artInfo.index
  articleInfoObjsArray[artInfo.index] = artInfo
  window.scraper.added()
  console.log('addArticles: exit')
})

window.scraper.onUpdateMaxDate((event, maxDate) => {
  // After a date is processed, update the dateSpec max attribute
  dateSpec.max = maxDate
})

window.scraper.onAddButton((event, buttonText) => {
  // Add a Next/Save button at the end of the article list
  Log('add-button entered with ' + buttonText)
  const sub = document.createElement('input')
  sub.className = 'btn'
  sub.type = 'submit'
  sub.value = buttonText
  aL.appendChild(sub)
  document.getElementById('aList').addEventListener('submit', async (evt) => {
    // prevent default refresh functionality of forms
    evt.preventDefault()
    console.log('onAddButton - button clicked')
    document.removeEventListener('click', articleClick)
    window.scraper.articleClick('close')
    const ckd = document.querySelectorAll('input:checked') // Get checked articles
    const checkedArticleIndices = [] // Returned to the main process

    // Remove article checkboxes and submit button
    while (aL.firstChild) {
      aL.removeChild(aL.lastChild)
    }
    // Remove "Retrieving n articles" msg
    mL.removeChild(mL.lastChild)

    // For each checked article, add its index to the return array
    for (let j = 0; j < ckd.length; j++) {
      checkedArticleIndices.push(parseInt(ckd[j].value))
    }
    window.scraper.submitted(JSON.stringify(checkedArticleIndices))
  }, { once: true }) // AddEventListener option - removes event listener after click
})

window.scraper.onAddContinue(() => {
  // Add a 'Continue' button to allow review of the updated table before continuing
  Log('add-continue entered')
  const msg = 'Review NYT Recipe index.html, then click Continue'
  addMsg(mL, msg)

  const sub = document.createElement('input')
  sub.className = 'btn'
  sub.id = 'continueButton'
  sub.type = 'submit'
  sub.value = 'Continue'
  sub.disabled = true
  aL.appendChild(sub)
})

window.scraper.onEnableContinue(() => {
  // Add and event listener to the 'Continue' button and enable it
  Log('enable-continue entered')
  document.getElementById('aList').addEventListener('click', async (evt) => {
    evt.preventDefault()
    remvAllMsg(mL)
    aL.removeChild(aL.lastChild)
    addMsg(mL, 'New and updated days:')
    window.scraper.send('continue')
  }, { once: true })
  document.getElementById('continueButton').disabled = false
})

window.scraper.onCreateButton((event, buttonId, buttonText) => {
  // Add a tableCompare action button
  Log('create-button entered')

  function createButton (id, text) {
    // Create and return a 'submit' button
    // Input:   element id
    //          button value and element name

    const button = document.createElement('input')
    button.classList = 'btn mr-2' // margin-right to separate it from subsequent buttons
    button.id = id
    button.type = 'submit'
    button.value = text
    button.name = text
    button.disabled = true
    return button
  }

  function buttonSubmitted (evt) {
    // 'Submit' event handler for tableCompare action butttons
    evt.preventDefault()
    const buttonName = evt.target.name
    Log('Action button ' + buttonName + 'submitted')

    // Remove butttons
    while (buttons.firstChild) {
      buttons.removeChild(buttons.lastChild)
    }

    // Remove the table rows
    while (tableCompare.firstChild) {
      tableCompare.removeChild(tableCompare.lastChild)
    }

    window.scraper.send('button-action', buttonName)
  }

  buttons.appendChild(createButton(buttonId, buttonText))
  buttons.lastChild.addEventListener('click', buttonSubmitted, { once: true })
  window.scraper.created()
})

window.scraper.onEnableActionButton(() => {
  // Enable the tableCompare action buttons
  Log('enable-action-button entered')
  const inps = buttons.getElementsByTagName('input')
  for (let i = 0; i < inps.length; i++) {
    inps[i].disabled = false
  }
})

window.scraper.onDisplayTableCompare((html) => {
  // Display the table showing discrepancies between the generated table and a pre-existing table
  Log('display-tableCompare entered')
  document.getElementById('tableCompare').innerHTML = html
})

window.scraper.onRemoveLastMsg(() => {
  // Remove last message
  Log('remove-lastMsg entered')
  mL.removeChild(mL.lastChild)
})

window.scraper.onRemoveDates(() => {
  // Remove list of dates to process
  Log('remove-dates entered')
  datesList.remove()
  dateSpec.disabled = true
})
