// This script executes in the renderer.js process before its web content
// begins loading. It runs within the renderer context, but is
// granted more privileges by having access to Node.js APIs.  It uses the
// contextBridge module to expose specific ipcRenderer functions to the renderer process
// in order to make possible communication between the main process and the
// renderer process.

const { contextBridge, ipcRenderer } = require('electron')

// Define functions to be exposed to the renderer process
contextBridge.exposeInMainWorld(
  'editExInfo',
  {
    send: (channel, data) => {
      // whitelist channels
      const validChannels = ['cancel', 'save', 'open-year']
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data)
      }
    },
    sendRow: (args) => ipcRenderer.send('send-row', ...args),
    onAddRow: (fn) => {
      ipcRenderer.on('add-row', (event, ...args) => fn(event, ...args))
    },
    onScrollToToday: (fn) => {
      ipcRenderer.on('scroll-today', (event, ...args) => fn(event, ...args))
    }
  }
)
