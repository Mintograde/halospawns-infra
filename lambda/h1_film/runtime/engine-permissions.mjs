import { constants } from 'node:fs';

// Retained Emscripten glue uses an internal API for these public constants.
// Supply only that lookup; all other native bindings stay denied by Node.
const deniedBinding = process.binding;
process.binding = name => name === 'constants'
  ? Object.freeze({ fs: constants }) : deniedBinding(name);
