// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Code structure:
//
//   Mainline
//    Launch Puppeteer
//    EventListener handler for Start button
//      For each date to be processed 
//      |  Call TPscrape
//      |    Call sectionScrape
//      |    For each article in section
//      |      Call artScrape
//      |  Call addArticles
//      |_ Call processSelectedArticles
//      Call updateIndexHTML
//      Call processNewDays
//      Listen for reply from index.js process
//      Send invoke-insert to index.js process

const { ipcRenderer } = require('electron'); // InterProcess Communications

// Mainline function
async function Mainline() {
    console.log("Entered Mainline");

    // Add EventListener for current button
    console.log("Mainline: Adding event listener to current button");
    currentButton = document.getElementById("current");
    currentButton.addEventListener("click", async (evt) => {
        // After current click:
        evt.preventDefault();
        console.log("Mainline: current button clicked");
        ipcRenderer.send('mode', 'current');
    })

    // Add EventListener for past button
    console.log("Mainline: Adding event listener to past button");
    pastButton = document.getElementById("past");
    pastButton.addEventListener("click", async (evt) => {
        // After past click:
        evt.preventDefault();
        console.log("Mainline: past button clicked");
        ipcRenderer.send('mode', 'past');
    })
}

// End of function definitions

Mainline(); // Launch puppeteer and add event listener for Start button