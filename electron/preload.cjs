const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("xingmiao", {
  invoke: (action, data) => ipcRenderer.invoke("xm:invoke", action, data),
  onJob: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("xm:job", handler);
    return () => ipcRenderer.removeListener("xm:job", handler);
  },
  onBrainstorm: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on("xm:brainstorm", handler);
    return () => ipcRenderer.removeListener("xm:brainstorm", handler);
  },
  onClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("xm:closing", handler);
    return () => ipcRenderer.removeListener("xm:closing", handler);
  },
  
  
});
