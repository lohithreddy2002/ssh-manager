const { contextBridge, ipcRenderer } = require('electron');

// Expose a limited set of IPC methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    sendBackendRequest: (message) => ipcRenderer.send('backend-request', message),
    onBackendResponse: (callback) => ipcRenderer.on('backend-response', (event, ...args) => callback(...args)),
    onBackendError: (callback) => ipcRenderer.on('backend-error', (event, ...args) => callback(...args)),
    onBackendClosed: (callback) => ipcRenderer.on('backend-closed', (event, ...args) => callback(...args))
});
