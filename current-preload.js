// This script executes in the renderer.js process before its web content
// begins loading. It runs within the renderer context, but is
// granted more privileges by having access to Node.js APIs.  It uses the
// contextBridge module to expose specific ipcRenderer functions to the renderer process
// in order to make possible communication between the main process and the
// renderer process.

const { contextBridge, ipcRenderer } = require('electron')

// Extract additional arguments
let arg = process.argv.filter(p => p.indexOf('--datesToProcess=') >= 0)[0]
const datesToProcessString = arg.substring(arg.indexOf('=') + 1)
arg = process.argv.filter(p => p.indexOf('--maxPickableDate=') >= 0)[0]
const maxPickableDate = arg.substring(arg.indexOf('=') + 1)

// Define functions to be exposed to the renderer process
contextBridge.exposeInMainWorld(
  'scraper',
  {
    datesToProcessString,
    maxPickableDate,
    send: (channel, data) => {
      // whitelist channels
      const validChannels = ['process-date', 'submitted', 'continue',
        'button-action', 'openTP', 'AOT']
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data)
      }
    },
    onDisplayMsg: (fn) => {
      ipcRenderer.on('display-msg', (event, ...args) => fn(...args))
    },
    onRemoveMsgs: (fn) => {
      ipcRenderer.on('remove-msgs', (event, ...args) => fn(...args))
    },
    onUpdateMaxDate: (fn) => {
      ipcRenderer.on('update-maxdate', (event, ...args) => fn(...args))
    },
    onAddButton: (fn) => {
      ipcRenderer.on('add-button', (event, ...args) => fn(event, ...args))
    },
    onAddArticles: (fn) => {
      ipcRenderer.on('add-articles', (event, ...args) => fn(event, ...args))
    },
    onAddContinue: (fn) => {
      ipcRenderer.on('add-continue', (event, ...args) => fn(...args))
    },
    onEnableContinue: (fn) => {
      ipcRenderer.on('enable-continue', (event, ...args) => fn(...args))
    },
    onCreateButton: (fn) => {
      ipcRenderer.on('create-button', (event, ...args) => fn(event, ...args))
    },
    onEnableActionButton: (fn) => {
      ipcRenderer.on('enable-action-buttons', (event, ...args) => fn(...args))
    },
    onDisplayTableCompare: (fn) => {
      ipcRenderer.on('display-tableCompare', (event, ...args) => fn(...args))
    },
    onRemoveLastMsg: (fn) => {
      ipcRenderer.on('remove-lastMsg', (event, ...args) => fn(...args))
    },
    onRemoveDates: (fn) => {
      ipcRenderer.on('remove-dates', (event, ...args) => fn(...args))
    },
    added: () => ipcRenderer.send('added'),
    articleClick: (action, href) => ipcRenderer.send('article-click', action, href),
    review: (indices) => ipcRenderer.send('review', indices),
    created: () => ipcRenderer.send('created')
  }
)
