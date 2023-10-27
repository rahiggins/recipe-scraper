// This script executes in the renderer.js process before its web content
// begins loading. It runs within the renderer context, but is
// granted more privileges by having access to Node.js APIs.  It uses the
// contextBridge module to expose specific ipcRenderer functions to the renderer process
// in order to make possible communication between the main process and the
// renderer process.

const { contextBridge, ipcRenderer } = require('electron')

// Define functions to be exposed to the renderer process
contextBridge.exposeInMainWorld(
  'scraper',
  {
    send: (channel, data) => {
      // whitelist channels
      const validChannels = ['process-date', 'submitted', 'continue', 'article-click',
        'added', 'created', 'button-action']
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
    onAddThrobber: (fn) => {
      ipcRenderer.on('add-throbber', (event, ...args) => fn(...args))
    },
    onCreateProgressBar: (fn) => {
      ipcRenderer.on('create-progressbar', (event, ...args) => fn(...args))
    },
    onUpdateProgressBar: (fn) => {
      ipcRenderer.on('update-progressbar', (event, ...args) => fn(...args))
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
    onEnableStartButton: (fn) => {
      ipcRenderer.on('enable-start', (event, ...args) => fn(...args))
    }
  }
)
