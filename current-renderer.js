// This file is invoked by the current.html file and will
// be executed in the renderer process for that window.

//  Context-isolation version 1.0

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//    function Log
//    function addMsg
//    function remvAllMsg
//    function addProgress
//
//  startButton EventListener for 'click'
//    window.scraper.send('process-date')
//
//  window.scraper.onDisplayMsg
//    calls function addMsg
//
//  window.scraper.onRemoveMsgs
//    calls function remvAllMsg
//
//  window.scraper.onAddThrobber
//
//  window.scraper.onCreateProgressBar
//    calls addProgress
//
//  window.scraper.onUpdateProgressBar
//    calls addProgress
//
//  window.scraper.onAddArticles
//    function articleListen
//      function articleClick
//        event.sender.send 'article-click', 'click'
//      document EventListener for 'click'
//    event.sender.send('added')
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
//
//  window.scraper.onEnableStartButton

const debug = true
let articleClick // Click event handler function, defined and added in articleListen function, removed in processSelectedArticles function.
let sectArtDiv // <div> element containing a progress bar and its label

const aL = document.getElementById('aL') // article list div
const mL = document.getElementById('msgs') // messages list div
const buttons = document.getElementById('buttons') // tableCompare buttons div
const tableCompare = document.getElementById('tableCompare') // tableCompare table tbody element

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

function addProgress (now, max) {
  // Called from sectionScrape
  // Input:   now - number of articles retrieved
  //          max - number of articles to be retrieved
  // return a progress bar element

  const prog = document.createElement('progress')
  prog.id = 'artProg'
  prog.classList = ' progress float-left'
  prog.style.paddingTop = '28px' // aligns progress bar with adjacent text, derived empirically
  prog.max = max
  prog.value = now
  return prog
}

// Determine the minimum and maximum dates for the type=date input
//  field dateSpec

// For the maximum date: today.  Locale sv-SE date format is the required YYYY-MM-DD
const today = new Date()
const todayStr = today.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).substr(0, 10)

// The minimum date is 2006-04-02 because there's no Today's Paper
//  before that date

// Set the minimum and maximum dates.
const dateInput = document.getElementById('dateSpec')
dateInput.min = '2006-04-02'
dateInput.max = todayStr

const startButton = document.getElementById('startButton')
startButton.addEventListener('click', async (evt) => {
  // After Start click:
  evt.preventDefault()
  console.log('Mainline: Start button clicked, disable Start button')
  startButton.classList.add('disabled') // Disable the Start button
  remvAllMsg(mL) // Remove any previous messages
  const enteredDate = document.getElementById('dateSpec').value
  window.scraper.send('process-date', enteredDate)
})

window.scraper.onDisplayMsg((msg, opt) => {
  // Display a message
  addMsg(mL, msg, opt)
})

window.scraper.onRemoveMsgs(() => {
  // Remove all messages
  remvAllMsg(mL)
})

window.scraper.onAddThrobber(() => {
  // Add a throbber icon while retrieving the Today's Paper page
  const loadingDiv = document.createElement('div')
  loadingDiv.className = 'loading loading-lg col-3'
  loadingDiv.id = 'lD'
  aL.appendChild(loadingDiv)
})

window.scraper.onCreateProgressBar((max, barLabel) => {
  // Create a progress bar
  console.log('create-progressBar entered with:')
  console.log(' max: ' + max)
  console.log(' barLabel: ' + barLabel)

  // Create a float-left div
  sectArtDiv = document.createElement('div')
  sectArtDiv.className = 'float-left'

  // Create a "Retrieving n ... articles" <p> element
  const para = document.createElement('p')
  para.classList = 'pr-2 float-left msg'
  const txnd = document.createTextNode(barLabel)
  para.appendChild(txnd)

  // Add "Retrieving n ... articles" element and a progress bar to the float-left div
  sectArtDiv.appendChild(para)
  sectArtDiv.appendChild(addProgress(0, max))

  // Remove the "Retrieving Today's Paper" message and add the float-left div to the messages div
  mL.removeChild(mL.lastChild)
  mL.appendChild(sectArtDiv)
})

window.scraper.onUpdateProgressBar((now, max) => {
  // Update the progress bar
  console.log('update-progressBar entered with:')
  console.log(' now: ' + now)
  console.log(' max: ' + max)

  sectArtDiv.removeChild(sectArtDiv.lastChild) // Remove the progress bar
  sectArtDiv.appendChild(addProgress(now, max)) // and add an updated one
})

window.scraper.onAddArticles((event, artsArrayString, text) => {
  // args - an array:
  //          - a stringified array of article objects returned by TPscrape
  //          - a {Magazine|Food} articles description to be displayed
  //
  // Add checkboxes for articles returned by TPscrape to current.html

  console.log('addArticles: entered')

  const artsArray = JSON.parse(artsArrayString)

  let stringI
  let lbl
  let checkbox
  let iicon
  let cbTitle
  let cbAuthor

  function articleListen (artsArray) {
    // Called from addArticles
    // Input is the article object passed to addArticles from TPscrape
    // Add and eventListener for clicks

    articleClick = function (evt) {
      // Called by click on article title
      // Input is a click event
      // Process click on article titles

      if (evt.target.classList.contains('article')) {
        evt.preventDefault()
        const artIdx = evt.target.parentNode.firstChild.value
        console.log('Article clicked: ' + artsArray[artIdx].title)
        event.sender.send('article-click', 'click', artsArray[artIdx].href)
      }
    }

    console.log('Add articleClick')
    document.addEventListener('click', articleClick)
  }

  articleListen(artsArray) // Add an eventListener for click on article titles
  // Passing the article object to a function that ...
  // ... adds the eventListener makes the article object ...
  // ... available to the event handler

  // Add {Magazine|Food} articles description to current.html
  addMsg(mL, text)

  // Remove throbber
  const element = document.getElementById('lD')
  element.parentNode.removeChild(element)

  // Add a checkbox for each article to index.html
  for (const i in artsArray) {
    stringI = i.toString()

    lbl = document.createElement('label')
    lbl.className = 'form-checkbox'

    checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    if (artsArray[i].hasRecipes) {
      checkbox.checked = true
    }
    checkbox.name = 'cbn' + stringI
    checkbox.value = stringI
    checkbox.id = 'cbi' + stringI

    iicon = document.createElement('i')
    iicon.className = 'form-icon'

    cbTitle = document.createElement('div')
    cbTitle.className = 'article'
    cbTitle.innerText = artsArray[i].title

    cbAuthor = document.createElement('div')
    cbAuthor.classList = 'text-gray author'
    cbAuthor.innerText = artsArray[i].author

    lbl.appendChild(checkbox)
    lbl.appendChild(iicon)
    lbl.appendChild(cbTitle)
    lbl.appendChild(cbAuthor)
    aL.appendChild(lbl)
  }

  event.sender.send('added')
  console.log('addArticles: exit')
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
    window.scraper.send('article-click', 'close')
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
    event.sender.send('submitted', JSON.stringify(checkedArticleIndices))
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
  event.sender.send('created')
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
  // Remove ?
  Log('remove-lastMsg entered')
  mL.removeChild(mL.lastChild)
})

window.scraper.onEnableStartButton(() => {
  // Enable/Disable the Start button
  Log('enable-start entered')
  startButton.classList.remove('disabled')
})
