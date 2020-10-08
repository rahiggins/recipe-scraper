// This file is required by the past.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

// Code structure:
//
//   Mainline
//    EventListener handler for yearInput change, keyup and paste events
//      Enable Start button if yearInput is valid
//    EventListener handler for Start button
//      Call NewDays
//      Call Insert

console.log("past-renderder: Entered Mainline");

// Filesystem functions
const fs = require('fs'); // Filesystem functions

// Functions shared with current-renderer.js
const { addMsg, remvAllMsg, NewDays, Insert } = require('./lib.js');

// Year input field
const yearInput = document.getElementById('yearSpec');

// Start button
const startButton = document.getElementById('yearButton');

// Messages div
const mL = document.getElementById('msgs');     // messages list div

// Functions

function chkEnable(e) {
    // If year input field is valid, enable the Start button

    console.log("chkEnable entered, type: " + e.type);
    if (e.type == 'paste') {
        // Paste events are fired before the clipboard data is posted to the document,
        //  so checkValidity cannot be used.  The clipboard data must be retrieved
        //  and tested against the input validation pattern.

        let pasteText = e.clipboardData.getData('text');
        let yearPat = new RegExp(yearInput.pattern);
        startButton.disabled = !yearPat.test(pasteText);

    } else {
        startButton.disabled = !yearInput.checkValidity();
    }
    console.log("startButton.disabled: " + startButton.disabled);
}

// On year input change, keyup and paste, enable Start button if year is valid
yearInput.addEventListener("change", chkEnable, false);
yearInput.addEventListener("keyup", chkEnable, false);
yearInput.addEventListener("paste", chkEnable, false);

// Add EventListener for Start button
console.log("past-renderer Mainline: Adding event listener to Start button");
startButton.addEventListener("click", async (evt) => {
    // After Start click:
    evt.preventDefault();
    console.log("past-renderer Mainline: Start button clicked, disable Start button");
    remvAllMsg(mL);   // Remove any previous messages
    let enteredYear = yearInput.value;

    if (enteredYear == "") {
        addMsg(mL, "A year (yyyy) is required");
        startButton.classList.remove("disabled");
        return; 
    }
    const tablePath = '/Users/rahiggins/Sites/NYT Recipes/' + enteredYear + '/index.html';
    if (!fs.existsSync(tablePath)) {
        addMsg(mL, tablePath + " not found");
        startButton.classList.remove("disabled");
        return; 
    }
    startButton.classList.add("disabled");  // Disable the button
    addMsg(mL, "New and updated days:");

    // Call NewDays to identify new and changed days.
    // If there are new and changed days, invoke Insert to update the local
    //   database and create an import file for the remote database.
    if (NewDays(enteredYear, mL)) {
        Insert(mL);
    }

    console.log("past-renderer Mainline: enable Start button")
    startButton.classList.remove("disabled");   // Enable the Start button
});