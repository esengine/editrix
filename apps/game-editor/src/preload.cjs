const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // System
  getHomePath: () => ipcRenderer.sendSync('get-home-path'),
  getProjectPath: () => ipcRenderer.sendSync('get-project-path'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Project management
  listProjects: () => ipcRenderer.invoke('list-projects'),
  createProject: (projectPath, projectConfig) =>
    ipcRenderer.invoke('create-project', { projectPath, projectConfig }),
  openProject: (projectPath) => ipcRenderer.send('open-project', projectPath),
  toggleStar: (projectPath) => ipcRenderer.invoke('toggle-star', projectPath),
  createPlugin: (projectPath, pluginId, pluginName) =>
    ipcRenderer.invoke('create-plugin', { projectPath, pluginId, pluginName }),

  // Filesystem
  fs: {
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
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
