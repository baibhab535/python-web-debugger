// This line imports the Pyodide library into the Web Worker's environment
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

let pyodide = null;
let executionGenerator = null; 

// Helper function to send messages back to the main thread (script.js)
function postMessageToMain(type, payload) {
    self.postMessage({ type, payload });
}

// Function to handle Python's print output and redirect it to the main thread's output panel
function stdoutWrite(text) {
    postMessageToMain('output', text);
}

async function loadPyodideOnce() {
    if (!pyodide) {
        postMessageToMain('output', "Worker: Loading Pyodide...");
        try {
            pyodide = await loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
            });
            pyodide.setStdout({ write: stdoutWrite });
            pyodide.setStderr({ write: stdoutWrite });
            postMessageToMain('output', "Worker: Pyodide loaded and ready.");
        } catch (error) {
            postMessageToMain('error', `Pyodide failed to load: ${error.message}`);
            return false;
        }
    }
    return true;
}

// The Python 'sys.settrace' calls this JS function before each line execution.
function python_tracer(frame, event, arg) {
    if (event === 'line') {
        const line = frame.f_lineno;

        try {
            // 1. Extract Local Variables using the helper function defined in Python
            const localsMap = pyodide.globals.get('__get_locals')(frame);
            
            // Convert the Map to a simple JS Object for JSON serialization
            const varsPayload = Object.fromEntries(
                [...localsMap.entries()].map(([key, value]) => [key, String(value)])
            );

            // 2. Report Execution State back to script.js
            postMessageToMain('line_executed', { line: line, variables: varsPayload });

            // 3. Yield Control (PAUSE Execution)
            // This advances the Python generator, pausing execution
            pyodide.globals.get('__python_debugger_step_control').next();

        } catch (e) {
            postMessageToMain('error', `Tracer Error: ${e.message}`);
            pyodide.runPython("import sys; sys.settrace(None)");
            return null;
        }
    }
    return python_tracer;
}

self.onmessage = async (e) => {
    const { command, code } = e.data;

    if (!await loadPyodideOnce()) return;

    if (command === 'start_execution') {
        try {
            // --- STEP 1: Setup the Tracing Mechanism in Python ---
            pyodide.globals.set('__python_tracer', python_tracer);
            pyodide.runPython(`
                import sys
                from pyodide.ffi import to_js
                from js import Object # FIXED: Import Object for dictionary conversion

                # Helper function to safely get locals from a frame
                def __get_locals(frame):
                    return to_js(frame.f_locals, dict_converter=Object.fromEntries)

                # A Python generator that we use to pause execution and yield control to JS
                def __debugger_step_control_generator():
                    while True:
                        yield

                sys.settrace(__python_tracer)
                __python_debugger_step_control = __debugger_step_control_generator()
                __python_debugger_step_control.next() # Initialize the generator
            `);
            
            // --- STEP 2: Start Running the User's Code ---
            const tracedCode = `
                # Actual user code starts here
                ${code} 
                
                # Disable tracer after execution finishes
                sys.settrace(None) 
                
                # Final yield to signal end of code
                __python_debugger_step_control.next()
            `;

            // Execute the user's code as an async generator
            executionGenerator = pyodide.runPythonAsync(tracedCode);
            
            // Run until the first yield (first line of user code)
            await executionGenerator.next(); 

        } catch (error) {
            postMessageToMain('error', error.message);
        }

    } else if (command === 'continue_execution') {
        try {
            // --- STEP 3: Continue Execution ---
            const result = await executionGenerator.next();

            if (result.done) {
                postMessageToMain('program_end');
            }
        } catch (error) {
            postMessageToMain('error', error.message);
        }
    }
};
