// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Code structure:
//
//  Mainline
//    Listen for currentButton 'click' event
//      Send 'mode', 'current' message to the main process
//    Listen for pastButton 'click' event
//      Send 'mode', 'past' message to the main process

// Mainline function
async function Mainline () {
  console.log('Entered Mainline')

  // Add EventListener for current button
  console.log('Mainline: Adding event listener to current button')
  const currentButton = document.getElementById('current')
  currentButton.addEventListener('click', async (evt) => {
    // After current click:
    evt.preventDefault()
    console.log('Mainline: current button clicked')
    window.scraper.send('mode', 'current')
  })

  // Add EventListener for past button
  console.log('Mainline: Adding event listener to past button')
  const pastButton = document.getElementById('past')
  pastButton.addEventListener('click', async (evt) => {
    // After past click:
    evt.preventDefault()
    console.log('Mainline: past button clicked')
    window.scraper.send('mode', 'past')
  })
}

// End of function definitions

Mainline() // Launch puppeteer and add event listener for Start button
