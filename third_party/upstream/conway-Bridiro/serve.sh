#!/bin/bash

# Build and serve script for local development

echo "Building WebAssembly..."
wasm-pack build --target web --release

echo "Copying files to web directory..."
mkdir -p web/pkg
cp pkg/* web/pkg/

echo "Starting local server..."
echo "Open http://localhost:8000 in your browser"
cd web && python3 -m http.server 8000
