#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target path to the compiled postinstall JS script
const targetPath = path.join(__dirname, '..', 'dist', 'scripts', 'postinstall.js');

if (fs.existsSync(targetPath)) {
  try {
    // Dynamic import to execute the ES module compiled script
    await import(`file://${targetPath}`);
  } catch (err) {
    // Prevent installation failure if the script errors out
    console.error(`[TokenFlow] Postinstall script failed: ${err.message}`);
  }
} else {
  // Silent bypass during development/CI install before dist/ exists
  console.log('[TokenFlow] Compiled postinstall script not found, bypassing setup hook.');
}
