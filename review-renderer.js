// This file is the renderer script for the reviewtWindow window

const tbody = document.querySelector('tbody')
const saveBtn = document.querySelector('#saveBtn')
const cancelBtn = document.querySelector('#cancelBtn')

const rowTemplateContent = document.querySelector('#trow').content

let r = 0
let changed = false
const changedDates = {} // Obect to track dates being changed
const invalidDates = {} // Obect to track invalid dates

const debug = true

function Log (text, dbg = debug) {
  // If debugging, write text to console.log
  if (dbg) {
    console.log(text)
  }
}

async function sendTable (evt) {
  // Send the content of each table row to the main process
  // Return a promise to be resolved when all the rows' content has been sent
  return new Promise(function (resolve) {
    const trs = tbody.querySelectorAll('tr')
    for (const tr of trs) {
      // Extract each row's content and send it to the main process
      const divs = tr.querySelectorAll('div')
      const date = divs[2].innerHTML.trim()
      const dateClassList = divs[2].dataset.classList
      const type = divs[3].innerText.trim()
      const typeClassList = divs[3].dataset.classList
      const name = divs[4].innerHTML.trim()
      const nameClassList = divs[4].dataset.classList
      window.editExInfo.sendRow([{ content: date, classList: dateClassList }, { content: type, classList: typeClassList }, { content: name, classList: nameClassList }])
    }

    // Tell the main process that all the table rows have been sent
    window.editExInfo.send('save')

    // Reset table changed status and resolve the function's promise
    changed = false
    saveBtn.setAttribute('disabled', '')
    resolve()
  })
}

tbody.addEventListener('input', (evt) => {
  // When anything is input anywhere, indicate that the tabke has changed
  console.log('input listener entered')
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }
  const targetTD = evt.target.closest('td.date')
  if (targetTD) {
    // If the input is in date cell, note the row ID of the changed date
    const rowID = targetTD.parentNode.id
    changedDates[rowID] = true
  }
})

tbody.addEventListener('focusout', (evt) => {
  // When focus leaves a date cell and that date cell has been changed, validate the date
  console.log('focusout listener entered')
  const targetTD = evt.target.closest('td.date')
  if (targetTD) {
    // If the focus left a date cell ...
    const rowID = targetTD.parentNode.id
    let isInvalid = false
    let date
    if (changedDates[rowID]) {
      // and that date cell has been changed ...
      delete changedDates[rowID]
      date = targetTD.textContent.trim()
      const match = date.match(/(\d{2})\/(\d{2})\/(\d{4})/) // ##/##/####
      if (!match) {
        // IF not numbers separated by slashes
        isInvalid = true
      } else {
        // See if it's a valid date
        const jdate = new Date(date.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2' + 'T00:00:00Z'))
        if (jdate.toString() === 'Invalid Date') {
          // Javascript says no
          isInvalid = true
        } else {
          // Check for Javascript date "borrowing", e.g. 04/31 is considered valid and interpreted as 05/01
          if (jdate.toISOString().replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$2/$3/$1') !== date) {
            isInvalid = true
          }
        }
      }
      if (!isInvalid) {
        // see whether a valid date is a duplicate
        const dates = Array.from(document.querySelectorAll('td.date')) // All dates ...
          .filter(td => td.textContent.trim() !== '') // with text ...
          .map(td => [td.textContent.trim(), td.parentNode.id])
          .filter(([d, i]) => d === date && i !== rowID) // and same but not the in the changed row
        if (dates.length > 0) {
          // Any such means the changed date has a duplicate
          isInvalid = true
        }
      }
    }
    const targetRepl = targetTD.parentNode.querySelector('li[data-cmd="repl"]') // Get the row menu's Repl mmand
    if (isInvalid) {
      // Make a note of the invalid date, highlight it and disable the Save button
      invalidDates[rowID] = true
      targetTD.classList.add('text-error')
      targetRepl.classList.add('c-not-allowed')
      saveBtn.setAttribute('disabled', '')
    } else {
      if (invalidDates[rowID]) {
        // If the changed date was previously invalid, but has been fixed, un-note it and unhighlight it
        targetTD.classList.remove('text-error')
        targetRepl.classList.remove('c-not-allowed')
        delete invalidDates[rowID]
        if (Object.keys(invalidDates).length === 0) {
          // Unless there are other invalid dates, enable the Save button
          saveBtn.removeAttribute('disabled')
        }
      }
    }
    Log(`${rowID} date is ${isInvalid ? 'invalid' : 'valid'}`)
  }
})

// Commit button event listener. Call sendTable to send the table rows to the main process to be saved to the databases.
saveBtn.addEventListener('click', sendTable)

// Close button event listener.
cancelBtn.addEventListener('click', () => {
  if (changed) {
    // If the table has been changed, show a modal dialog to save the table first, discard the changes or cancel the close
  } else {
    // If no changhes, remove the table rows from the window
    // discardTable()
    window.editExInfo.send('cancel')
  }
})

function mouseEventHandler (evt) {
  // Handle mouseover and mouseleave events on the row menu
  // Display or hide the menu.
  // Near the bottom of the window, change the menu's top value to ensure the menu is entirely within the window.
  const target = evt.target
  console.log(`mouseEventHandler entered for event ${evt.type} on target ${target.tagName} ${target.classList}`)
  const menu = target.querySelector('.hover-menu') || target.nextElementSibling
  if (!menu) {
    return
  }
  if (evt.type === 'mouseover') {
    if (target.classList.contains('menu-cell')) {
      const targetTD = evt.target.closest('td')
      const tdRect = targetTD.getBoundingClientRect()
      if (window.innerHeight - tdRect.top < 228) {
        // if the top of the target table cell is less than 228 pixels (the menu height) from the bottom of the window, adjust the position of the menu so that the menu fits within the window.
        const offset = 228 - (window.innerHeight - tdRect.top) + 15
        menu.style.top = `-${offset}px`
      }
      menu.style.display = 'block' // Show the menu
    }
  } else {
    // On mouseleave, hide the menu and restore its default position
    menu.style.display = 'none'
    menu.style.top = '-15px'
  }
}

function setListeners (trID) {
  // Add event listeners to row menu selections
  const lis = document.querySelectorAll(`#${trID} li`)
  const listeners = [insert, insert, move, move, repl, del, code, embolden]
  let l = 0
  for (const li of lis) {
    li.addEventListener('click', listeners[l])
    l += 1
  }
  const mcon = document.querySelector(`#${trID} .menu-container`)
  mcon.addEventListener('mouseover', mouseEventHandler)
  mcon.addEventListener('mouseleave', mouseEventHandler)
}

// Listener function for click on Insert above and below
function insert (evt) {
  const rowID = evt.target.dataset.row
  const position = evt.target.dataset.iaePosition // Retrieve insertAdjacentElement position from the clicked button
  console.log('insert entered - ' + rowID)
  const tr = document.querySelector(`#${rowID}`)

  // Create a new row
  const newRow = rowTemplateContent.cloneNode(true)
  r += 1
  const newTr = newRow.querySelector('tr')
  newTr.id = 'r' + r.toString()
  const lis = newRow.querySelectorAll('li')
  for (const li of lis) {
    li.dataset.row = newTr.id
  }

  // Add the new row to the table
  tr.insertAdjacentElement(position, newTr)

  // Add event listeners to the row menu selections
  setListeners(newTr.id)

  // Indicate table changed and enable the Save button
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }
}

// Listener function for click on Move up and down
function move (evt) {
  const rowID = evt.target.dataset.row
  console.log('move entered - ' + rowID)
  const direction = evt.target.dataset.direction // Retieve the move direction from the clicked button
  let sibling, position
  switch (direction) {
    case 'up':
      sibling = 'previousElementSibling'
      position = 'beforebegin'
      break
    case 'down':
      sibling = 'nextElementSibling'
      position = 'afterend'
  }
  const trToMove = document.querySelector(`#${rowID}`) // The row to move
  const targetTr = trToMove[sibling] // The move target sibling
  const movedTr = trToMove.parentNode.removeChild(trToMove) // Remove the row being moved
  targetTr.insertAdjacentElement(position, movedTr) // Insert the row being moved

  // Indicate table changed and enable the Save button
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }
}

// Listener function for click on Repl
function repl (evt) {
  const rowID = evt.target.dataset.row
  console.log('Repl entered - ' + rowID)
  if (invalidDates[rowID]) {
    // Don't replicate a row with an invalid date
    return
  }

  // Create a new row from the row being replicated
  const sourceTr = document.querySelector(`#${rowID}`)
  const newTr = sourceTr.cloneNode(true)
  r += 1
  newTr.id = 'r' + r.toString()

  // Adjust the new row's ID on its row menu listitems
  const lis = newTr.querySelectorAll('li')
  for (const li of lis) {
    li.dataset.row = newTr.id
  }

  // The source row's menu is visible; change the new row so its menu is hidden
  const menu = newTr.querySelector('.hover-menu')
  menu.style.display = 'none'
  menu.style.top = '-15px'

  sourceTr.insertAdjacentElement('afterend', newTr) // Add the new row

  // Add event listeners to the new row's menu listitems
  setListeners(newTr.id) // Add event listeners to row buttons

  // Indicate table changed and enable the Save button
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }
}

// Listener function for click on Del
function del (evt) {
  const rowID = evt.target.dataset.row
  console.log('Del entered - ' + rowID)
  const tr = document.querySelector(`#${rowID}`)

  tr.remove()

  // Indicate table changed and enable the Save button
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }

  // If the row had an invalid date, un-note it and nnless there are other invalid dates, enable the Save button
  if (invalidDates[rowID]) {
    delete invalidDates[rowID]
    if (Object.keys(invalidDates).length === 0) {
      saveBtn.removeAttribute('disabled')
    }
  }
}

// Listener function for click on <code>>
function code (evt) {
  const rowID = evt.target.dataset.row
  console.log('code entered - ' + rowID)
  const tds = document.querySelectorAll(`#${rowID}  td[data-code="eligible"]`)
  for (const td of tds) {
    const div = td.querySelector('div')
    const codeToggle = div.dataset.codeToggle

    let iH, iT
    switch (codeToggle) {
      case '0':
        // Get innerHTML of div. Remove all children of div. Then insert the innerHTML as text
        iH = div.innerHTML
        while (div.firstChild) {
          div.removeChild(div.firstChild)
        }
        div.insertAdjacentText('afterbegin', iH)
        div.dataset.codeToggle = '1'
        break
      case '1':
        // Get innerText of div. Remove all children of div. Then insert the innerText as HTML
        iT = div.innerText
        while (div.firstChild) {
          div.removeChild(div.firstChild)
        }
        div.insertAdjacentHTML('afterbegin', iT)
        div.dataset.codeToggle = '0'
    }
  }
}

// Listener function for click on Embolden
function embolden (evt) {
  const rowID = evt.target.dataset.row
  console.log('code entered - ' + rowID)
  const tds = document.querySelectorAll(`#${rowID}  td[data-code="eligible"]`)
  for (const td of tds) {
    const div = td.querySelector('div')
    const inner = div.innerHTML.trim()
    div.innerHTML = '<strong>' + inner + '</strong>'
  }

  // Indicate table changed and enable the Save button
  if (!changed) {
    changed = true
    saveBtn.removeAttribute('disabled')
  }
}

window.editExInfo.onAddRow((event, date, type, name) => {
  // Add a row to the window
  // Input - objects with content and classList properties

  const row = rowTemplateContent.cloneNode(true) // Create a table row from the template
  r += 1 // Set the row's ID attribute
  const tr = row.querySelector('tr')
  tr.id = 'r' + r.toString()
  const divs = row.querySelectorAll('div') // Get the row's divs

  // Populate the date table cell
  divs[2].innerHTML = date.content
  divs[2].dataset.classList = date.classList

  // Populate the row type table cell
  divs[3].innerText = type.content
  divs[3].dataset.classList = type.classList

  // Populate the row name table cell
  divs[4].innerHTML = name.content
  divs[4].dataset.classList = name.classList

  // Add the row's ID to the row menu listitems
  const lis = row.querySelectorAll('li')
  for (const li of lis) {
    li.dataset.row = tr.id
  }

  // Add the row to the window
  tbody.appendChild(row)
  setListeners(tr.id) // Add event listeners to row buttons
})
