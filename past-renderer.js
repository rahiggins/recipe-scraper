// This file is invoked by the past.html file and will
// be executed in the renderer process for that window.

// Context-isolation version 1.0

// Code structure:
//
//  Global variable definitions
//  Global function definitions
//    function addMsg
//    function remvAllMsg
//    function chkEnable
//  window.scraper.onDisplayMsg
//    calls addMsg
//  window.scraper.onRemoveMsgs
//    calls remvAllMsg
//  window.scraper.onChangeStartButton
//  'yearSpec' EventListener for 'change', 'keyup', 'paste'
//    calls chkEnable
//  'yearButton' EventListener for 'click'
//    calls addMsg
//    calls remvAllMsg
//    Sends a 'process-year' message to past.js

console.log('past-renderder entered')

const yearInput = document.getElementById('yearSpec') // Year input field
const startButton = document.getElementById('yearButton') // Start button
const mL = document.getElementById('msgs') // Messages div

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

function chkEnable (e) {
  // If year input field is valid, enable the Start button

  console.log('chkEnable entered, type: ' + e.type)
  if (e.type === 'paste') {
    // Paste events are fired before the clipboard data is posted to the document,
    //  so checkValidity cannot be used.  The clipboard data must be retrieved
    //  and tested against the input validation pattern.

    const pasteText = e.clipboardData.getData('text')
    const yearPat = new RegExp(yearInput.pattern)
    startButton.disabled = !yearPat.test(pasteText)
  } else {
    startButton.disabled = !yearInput.checkValidity()
  }
  console.log('startButton.disabled: ' + startButton.disabled)
}

window.scraper.onDisplayMsg((msg, opt) => {
  addMsg(mL, msg, opt)
})

window.scraper.onRemoveMsgs((msg, opt) => {
  remvAllMsg(mL)
})

window.scraper.onChangeStartButton((state) => {
  switch (state) {
    case 'enable':
      startButton.classList.remove('disabled')
      break
    case 'disable':
      startButton.classList.add('disabled')
      break
    default:
      console.log(`onChangeStartButton: unrecognized state - ${state}`)
  }
})

// On year input change, keyup and paste, enable Start button if year is valid
yearInput.addEventListener('change', chkEnable, false)
yearInput.addEventListener('keyup', chkEnable, false)
yearInput.addEventListener('paste', chkEnable, false)

// Add EventListener for Start button
console.log('past-renderer Mainline: Adding event listener to Start button')
startButton.addEventListener('click', async (evt) => {
  // After Start click:
  evt.preventDefault()
  console.log('past-renderer Mainline: Start button clicked, disable Start button')
  remvAllMsg(mL) // Remove any previous messages
  const enteredYear = yearInput.value

  if (enteredYear === '') {
    addMsg(mL, 'A year (yyyy) is required')
    startButton.classList.remove('disabled')
    return
  }

  // Send the year to be processed to past.js
  window.scraper.send('process-year', enteredYear)

  console.log('past-renderer Mainline: enable Start button')
  startButton.classList.remove('disabled') // Enable the Start button
})
