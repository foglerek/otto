#!/usr/bin/env node
import { runOttoCLI } from "./index.js";

runOttoCLI(process.argv.slice(2)).catch((err) => {
  // CLI-level error boundary. Downstream packages should not use console.
  // This is a scaffold; structured logging will live behind a logger port.
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
