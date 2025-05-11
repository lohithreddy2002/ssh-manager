const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // Use a preload script for security
            contextIsolation: true, // Enable context isolation
            nodeIntegration: false // Disable Node.js integration in the renderer
        }
    });

    mainWindow.loadFile('index.html');

    // Open the DevTools (optional)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', function () {
        mainWindow = null;
        // Kill the Python backend process when the main window is closed
        if (pythonProcess) {
            pythonProcess.kill();
        }
    });

    // Start the Python backend process
    startPythonBackend();
}

function startPythonBackend() {
    // Adjust the path to your Python script as needed
    const pythonScriptPath = path.join(__dirname, 'ssh_manager_backend.py');

    // Spawn the Python process
    pythonProcess = spawn('python3', [pythonScriptPath]);

    // Handle data from Python script's stdout
    pythonProcess.stdout.on('data', (data) => {
        // Assuming the Python script sends JSON data
        try {
            const message = JSON.parse(data.toString());
            // Send the message to the renderer process
            mainWindow.webContents.send('backend-response', message);
        } catch (error) {
            console.error('Failed to parse JSON from Python:', data.toString(), error);
        }
    });

    // Handle data from Python script's stderr
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Backend Error: ${data}`);
        // Optionally send error to renderer
        mainWindow.webContents.send('backend-error', data.toString());
    });

    // Handle process exit
    // pythonProcess.on('close', (code) => {
        // console.log(`Python backend process exited with code ${code}`);
        // Optionally inform the renderer
        // mainWindow.webContents.send('backend-closed', code);
    // });
}

// Listen for messages from the renderer process
ipcMain.on('backend-request', (event, message) => {
    // Send the message to the Python backend via stdin
    if (pythonProcess) {
        pythonProcess.stdin.write(JSON.stringify(message) + '\n');
    } else {
        console.error('Python backend process is not running.');
        mainWindow.webContents.send('backend-error', 'Backend process not available.');
    }
});


app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    if (mainWindow === null) {
        createWindow();
    }
});
