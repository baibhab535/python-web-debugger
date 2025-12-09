// This line imports the Pyodide library into the Web Worker's environment
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

let pyodide = null;
let executionGenerator = null; // Stores the generator that runs the Python code

// Helper function to send messages back to the main thread (script.js)
function postMessageToMain(type, payload) {
    self.postMessage({ type, payload });
}

// Function to handle Python's print output and redirect it to the main thread's output panel
function stdoutWrite(text) {
    postMessageToMain('output', text);
}

// Function to ensure Pyodide is only loaded once
async function loadPyodideOnce() {
    if (!pyodide) {
        postMessageToMain('output', "Worker: Loading Pyodide...");
        try {
            pyodide = await loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/",
            });
            // Redirect Python's output streams (print statements)
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
    // We only care about the 'line' event (when a new line of code is about to run)
    if (event === 'line') {
        const line = frame.f_lineno;

        try {
            // 1. Extract Local Variables
            // We use a Python helper function (defined in the next section) to get the local variables 
            // from the execution frame and convert them to a plain JavaScript Map.
            const localsMap = pyodide.globals.get('__get_locals')(frame);
            
            // Convert the Map to a simple JS Object for JSON serialization
            const varsPayload = Object.fromEntries(
                [...localsMap.entries()].map(([key, value]) => [key, String(value)])
            );

            // 2. Report Execution State back to script.js
            postMessageToMain('line_executed', { line: line, variables: varsPayload });

            // 3. Yield Control (PAUSE Execution)
            // This advances the Python generator, which pauses the Python execution and 
            // hands control back to the JavaScript event loop until script.js tells it to continue.
            pyodide.globals.get('__python_debugger_step_control').next();

        } catch (e) {
            postMessageToMain('error', `Tracer Error: ${e.message}`);
            // Stop tracing on error
            pyodide.runPython("import sys; sys.settrace(None)");
            return null; // Return null to stop tracing
        }
    }
    return python_tracer; // Must return itself to continue tracing on the next line
}
self.onmessage = async (e) => {
    const { command, code } = e.data;

    if (!await loadPyodideOnce()) return; // Stop if Pyodide failed to load

    if (command === 'start_execution') {
        try {
            // --- STEP 1: Setup the Tracing Mechanism in Python ---
            pyodide.globals.set('__python_tracer', python_tracer);
            pyodide.runPython(`
                import sys
                from pyodide.ffi import to_js

                # Helper function to safely get locals from a frame and return as a JS Map
                def __get_locals(frame):
                    # We convert the Python dict to a JS Map before returning
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
            // Execute the user's code as an async generator.
            const tracedCode = `${code}\nsys.settrace(None)`; // User's code and disable tracer at the end
            executionGenerator = pyodide.runPythonAsync(tracedCode);
            
            // Run until the first yield (which happens inside python_tracer, before the first line executes)
            await executionGenerator.next(); 

        } catch (error) {
            postMessageToMain('error', error.message);
        }

    } else if (command === 'continue_execution') {
        try {
            // --- STEP 3: Continue Execution ---
            // Advance the execution generator to run the next block of code
            const result = await executionGenerator.next();

            if (result.done) {
                // The generator finished executing the Python code
                postMessageToMain('program_end');
            }
            // If result.done is false, the code paused successfully (the tracer sent the line_executed message)
            
        } catch (error) {
            postMessageToMain('error', error.message);
        }
    }
};
