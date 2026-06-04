#!/usr/bin/env bash
set -euo pipefail

direnv allow
corepack installj
pnpm install
