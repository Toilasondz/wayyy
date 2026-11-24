#!/usr/bin/env bash
set -euo pipefail

# Biên dịch nhanh VideoStarOTA.dylib (arm64) trên macOS có cài Xcode Command Line Tools
SDK_PATH=$(xcrun --sdk iphoneos --show-sdk-path)

clang -dynamiclib \
  -arch arm64 \
  -isysroot "$SDK_PATH" \
  -miphoneos-version-min=13.0 \
  -fobjc-arc \
  -O2 \
  -framework Foundation \
  -framework UIKit \
  -framework JavaScriptCore \
  -framework WebKit \
  -framework QuartzCore \
  -framework CoreGraphics \
  -install_name "@executable_path/Frameworks/VideoStarOTA.dylib" \
  -o VideoStarOTA.dylib \
  VideoStarOTA.m

if command -v ldid >/dev/null 2>&1; then
  ldid -S VideoStarOTA.dylib
fi

echo "Biên dịch thành công: VideoStarOTA.dylib"
