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
let pyodideWorker = null;    // The Web Worker that runs Python
let breakpoints = new Set(); // Stores line numbers where execution should pause
let currentLine = 0;         // Tracks the line number currently paused on
let isRunning = false;       // True when the code is executing (Run mode)
let isStepping = false;      // True when execution should pause after every line (Step mode)
// Function to append output to the UI
function appendOutput(text) {
    outputElement.textContent += text + '\n';
    outputElement.scrollTop = outputElement.scrollHeight; // Scroll to bottom
}

// Function to update the variables panel
function updateVariables(vars) {
    variablesElement.textContent = JSON.stringify(vars, null, 2);
}

// Function to redraw the list of active breakpoints
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

// Resets the debugger to its initial state
function resetExecution() {
    outputElement.textContent = '';
    variablesElement.textContent = '{}';
    currentLine = 0;
    isRunning = false;
    isStepping = false;
    runCodeBtn.disabled = true; // Re-disable until Pyodide is fully loaded
    stepCodeBtn.disabled = true;
    loadPyodideBtn.disabled = false;
}
// Initialize the worker and its message handler
function initPyodideWorker() {
    // Terminate any existing worker to ensure a clean reset
    if (pyodideWorker) {
        pyodideWorker.terminate();
    }
    
    // Create a new worker instance from the separate JS file
    pyodideWorker = new Worker('pyodide-worker.js');

    // This defines how we handle messages coming FROM the worker
    pyodideWorker.onmessage = (e) => {
        const { type, payload } = e.data;
        
        if (type === 'output') {
            // Received a print statement or message from the worker
            appendOutput(payload);

        } else if (type === 'line_executed') {
            // Received a line execution update (the core of the debugger)
            currentLine = payload.line;
            updateVariables(payload.variables);
            
            // 1. Re-enable control buttons
            runCodeBtn.disabled = false;
            stepCodeBtn.disabled = false;

            // 2. Decide whether to pause (Step mode) or continue (Run mode)
            const isBreakpointHit = breakpoints.has(currentLine);

            if (isStepping || isBreakpointHit) {
                // If in 'Step' mode or we hit a breakpoint, we pause here.
                isRunning = false; 
                isStepping = false;
                appendOutput(`Execution paused at line ${currentLine}.`);
                // (Optional: Implement line highlighting here)

            } else if (isRunning) {
                // If in 'Run' mode and not at a breakpoint, auto-continue.
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
// --- LOAD INTERPRETER BUTTON ---
loadPyodideBtn.addEventListener('click', async () => {
    appendOutput("Loading Pyodide...");
    // The actual Pyodide loading logic is in the worker, we just initialize the worker here.
    initPyodideWorker(); 
    loadPyodideBtn.disabled = true;
    // Once the worker successfully loads Pyodide, it will send an 'output' message, 
    // and we can enable the Run/Step buttons. 
    // For now, we manually enable them after worker starts, assuming load will succeed:
    setTimeout(() => {
        runCodeBtn.disabled = false;
        stepCodeBtn.disabled = false;
    }, 2000); // Give worker 2 seconds to load (adjust as needed)
});

// --- ADD BREAKPOINT BUTTON ---
addBreakpointBtn.addEventListener('click', () => {
    const line = parseInt(breakpointInput.value);
    if (!isNaN(line) && line > 0) {
        breakpoints.add(line);
        updateBreakpointList();
        breakpointInput.value = '';
    }
});

// --- RUN BUTTON ---
runCodeBtn.addEventListener('click', () => {
    resetExecution(); // Reset state
    isRunning = true;
    isStepping = false;
    runCodeBtn.disabled = true;
    stepCodeBtn.disabled = true;
    outputElement.textContent = 'Starting execution in Run mode...';
    // Send the user's code to the worker to start tracing
    pyodideWorker.postMessage({ command: 'start_execution', code: pythonCodeEditor.value });
});

// --- STEP BUTTON ---
stepCodeBtn.addEventListener('click', () => {
    // If program is not running, this is the first step.
    if (!isRunning && currentLine === 0) {
        resetExecution();
        isRunning = true; // Set to true, but we'll pause immediately
        isStepping = true;
        outputElement.textContent = 'Starting execution in Step mode...';
        pyodideWorker.postMessage({ command: 'start_execution', code: pythonCodeEditor.value });
    } else {
        // Continue execution for one step. The worker will pause after the next line.
        isStepping = true;
        pyodideWorker.postMessage({ command: 'continue_execution' });
    }
    runCodeBtn.disabled = true;
    stepCodeBtn.disabled = true;
});

// --- RESET BUTTON ---
resetCodeBtn.addEventListener('click', () => {
    if (pyodideWorker) {
        pyodideWorker.terminate(); 
        initPyodideWorker(); // Re-initialize worker for a clean slate
    }
    resetExecution();
    appendOutput("Debugger state reset. Click 'Load Interpreter' to start.");
});
