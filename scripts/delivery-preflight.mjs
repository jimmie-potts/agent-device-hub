#!/usr/bin/env node
// Read-only delivery preflight for one Hub PR. See docs/development.md
// "Delivery preflight" and scripts/delivery-preflight/cli.mjs. Exit 0: every
// applicable gate satisfied; 1: unresolved; 2: a read failed; 3: usage or
// internal error.
import { main } from './delivery-preflight/cli.mjs';

process.exitCode = await main({ argv: process.argv.slice(2) });
