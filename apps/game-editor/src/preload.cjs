const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Electron 34+ removed File.path in the renderer; use webUtils to resolve
  // the OS filesystem path from a File picked up by a drop/paste event.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Single-listener slot so hot reload doesn't accumulate handlers.
  onRequestClose: (handler) => {
    ipcRenderer.removeAllListeners('app:request-close');
    ipcRenderer.on('app:request-close', () => {
      handler();
    });
  },
  closeAck: (shouldClose) => ipcRenderer.send('app:close-ack', shouldClose),

  // System
  getHomePath: () => ipcRenderer.sendSync('get-home-path'),
  getProjectPath: () => ipcRenderer.sendSync('get-project-path'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),

  // Project management
  listProjects: () => ipcRenderer.invoke('list-projects'),
  createProject: (projectPath, projectConfig) =>
    ipcRenderer.invoke('create-project', { projectPath, projectConfig }),
  openProject: (projectPath) => ipcRenderer.send('open-project', projectPath),
  toggleStar: (projectPath) => ipcRenderer.invoke('toggle-star', projectPath),
  removeProject: (projectPath) => ipcRenderer.invoke('remove-project', projectPath),
  revealInFinder: (projectPath) => ipcRenderer.invoke('reveal-in-finder', projectPath),
  createPlugin: (projectPath, pluginId, pluginName) =>
    ipcRenderer.invoke('create-plugin', { projectPath, pluginId, pluginName }),

  // Filesystem
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    readFileBuffer: (filePath) => ipcRenderer.invoke('fs:readFileBuffer', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
    delete: (targetPath) => ipcRenderer.invoke('fs:delete', targetPath),
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', oldPath, newPath),
    copy: (srcPath, destPath) => ipcRenderer.invoke('fs:copy', srcPath, destPath),
    watch: (dirPath) => ipcRenderer.invoke('fs:watch', dirPath),
    unwatch: (watchId) => ipcRenderer.invoke('fs:unwatch', watchId),
    onChange: (callback) => {
      ipcRenderer.on('fs:change', (_event, data) => callback(data));
    },
  },
});
