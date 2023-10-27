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
      const validChannels = ['process-year']
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
    onChangeStartButton: (fn) => {
      ipcRenderer.on('change-start', (event, ...args) => fn(...args))
    }
  }
)
