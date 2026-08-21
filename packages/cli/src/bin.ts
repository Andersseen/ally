#!/usr/bin/env node
import { main } from './main.js';

/**
 * Process entry point.
 *
 * Everything interesting lives in `main`, which takes its console and working
 * directory as arguments. This file exists only to connect that to the real
 * process.
 */
const code = await main(process.argv.slice(2), console, process.cwd());
process.exitCode = code;
