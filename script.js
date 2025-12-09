// --- 1. UI ELEMENT REFERENCES ---
const pythonCodeEditor = document.getElementById('python-code');
const loadPyodideBtn = document.getElementById('load-pyodide');
const runCodeBtn = document.getElementById('run-code');
const stepCodeBtn = document.getElementById('step-code');
const resetCodeBtn = document.getElementById('reset-code');
const outputElement = document.getElementById('output');
const variablesElement = document.getElementById('variables');
const breakpointInput = document.getElementById('breakpoint-input');
const addBreakpointBtn = document.getElementById('add-breakpoint');
const breakpointList = document.getElementById('breakpoint-list');

// --- 2. GLOBAL STATE ---
let pyodideWorker = null;
let breakpoints = new Set();
let currentLine = 0;
let isRunning = false;
let isStepping = false;


// --- 3. UI HELPER FUNCTIONS ---

function appendOutput(text) {
    outputElement.textContent += text + '\n';
    outputElement.scrollTop = outputElement.scrollHeight;
}

function updateVariables(vars) {
    variablesElement.textContent = JSON.stringify(vars, null, 2);
}

function updateBreakpointList() {
    breakpointList.innerHTML = '';
    breakpoints.forEach(line => {
        const li = document.createElement('li');
        li.textContent = `Line ${line}`;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => {
            breakpoints.delete(line);
            updateBreakpointList();
        };
        li.appendChild(removeBtn);
        breakpointList.appendChild(li);
    });
}

function resetExecution() {
    outputElement.textContent = '';
    variablesElement.textContent = '{}';
    currentLine = 0;
    isRunning = false;
    isStepping = false;
    runCodeBtn.disabled = true;
    stepCodeBtn.disabled = true;
    loadPyodideBtn.disabled = false;
}


// --- 4. WEB WORKER COMMUNICATION SETUP ---

function initPyodideWorker() {
    if (pyodideWorker) {
        pyodideWorker.terminate();
    }
    
    // Create the worker
    pyodideWorker = new Worker('pyodide-worker.js');

    // Handle messages coming FROM the worker
    pyodideWorker.onmessage = (e) => {
        const { type, payload } = e.data;
        
        if (type === 'output') {
            appendOutput(payload);

        } else if (type === 'line_executed') {
            currentLine = payload.line;
            updateVariables(payload.variables);
            
            // Re-enable control buttons
            runCodeBtn.disabled = false;
            stepCodeBtn.disabled = false;

            // Decide whether to pause (Step mode) or continue (Run mode)
            const isBreakpointHit = breakpoints.has(currentLine);

            if (isStepping || isBreakpointHit) {
                // Pause for user input
                isRunning = false; 
                isStepping = false;
                appendOutput(`Execution paused at line ${currentLine}.`);

            } else if (isRunning) {
                // Auto-continue execution if in run mode and not at a breakpoint
                stepCodeBtn.disabled = true; 
                runCodeBtn.disabled = true;
                pyodideWorker.postMessage({ command: 'continue_execution' });
            }

        } else if (type === 'program_end') {
            appendOutput("--- Program Finished ---");
            isRunning = false;
            isStepping = false;
            runCodeBtn.disabled = true;
            stepCodeBtn.disabled = true;
        
        } else if (type === 'error') {
            appendOutput(`RUNTIME ERROR: ${payload}`);
            isRunning = false;
            isStepping = false;
            runCodeBtn.disabled = false;
            stepCodeBtn.disabled = true;
        }
    };

    pyodideWorker.onerror = (error) => {
        appendOutput(`WORKER ERROR: ${error.message}`);
        console.error('Worker error:', error);
        isRunning = false;
        isStepping = false;
        runCodeBtn.disabled = true;
        stepCodeBtn.disabled = true;
    };
}


// --- 5. EVENT LISTENERS (BUTTON LOGIC) ---

loadPyodideBtn.addEventListener('click', async () => {
    appendOutput("Loading Pyodide...");
    initPyodideWorker(); 
    loadPyodideBtn.disabled = true;
    setTimeout(() => {
        runCodeBtn.disabled = false;
        stepCodeBtn.disabled = false;
    }, 2000); // Give worker time to load
});

addBreakpointBtn.addEventListener('click', () => {
    const line = parseInt(breakpointInput.value);
    if (!isNaN(line) && line > 0) {
        breakpoints.add(line);
        updateBreakpointList();
        breakpointInput.value = '';
    }
});

runCodeBtn.addEventListener('click', () => {
    resetExecution(); 
    isRunning = true;
    isStepping = false;
    runCodeBtn.disabled = true;
    stepCodeBtn.disabled = true;
    outputElement.textContent = 'Starting execution in Run mode...';
    pyodideWorker.postMessage({ command: 'start_execution', code: pythonCodeEditor.value });
});

stepCodeBtn.addEventListener('click', () => {
    if (!isRunning && currentLine === 0) { // First step
        resetExecution();
        isRunning = true;
        isStepping = true;
        outputElement.textContent = 'Starting execution in Step mode...';
        pyodideWorker.postMessage({ command: 'start_execution', code: pythonCodeEditor.value });
    } else { // Subsequent step
        isStepping = true;
        pyodideWorker.postMessage({ command: 'continue_execution' });
    }
    runCodeBtn.disabled = true;
    stepCodeBtn.disabled = true;
});

resetCodeBtn.addEventListener('click', () => {
    if (pyodideWorker) {
        pyodideWorker.terminate(); 
        initPyodideWorker();
    }
    resetExecution();
    appendOutput("Debugger state reset. Click 'Load Interpreter' to start.");
});
