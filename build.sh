#!/bin/bash

# Configuration
VERSION=$(grep -m1 '"version"' manifest.json | awk -F '"' '{print $4}')
OUTPUT_FILE="../TabMasterPro_v${VERSION}.zip"

echo "Bundling TabMaster Pro v${VERSION}..."

# Remove old build if it exists
if [ -f "$OUTPUT_FILE" ]; then
    rm "$OUTPUT_FILE"
    echo "Removed old build."
fi

# Create a zip containing only the essential extension files
zip -r "$OUTPUT_FILE" \
    manifest.json \
    background.js \
    popup/ \
    settings/ \
    utils/ \
    icons/ \
    LICENSE \
    -x "*.DS_Store" \
    -x "*__MACOSX*" \
    -x "*.git*"

echo "✅ Build complete! Extension bundled at: ${OUTPUT_FILE}"
