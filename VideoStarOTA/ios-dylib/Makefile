# Biên dịch VideoStarOTA.dylib bằng Theos (hoặc dùng ./build.sh trên macOS)
TARGET := iphone:clang:latest:13.0
ARCHS := arm64

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = VideoStarOTA

VideoStarOTA_FILES = VideoStarOTA.m
VideoStarOTA_CFLAGS = -fobjc-arc -O2
VideoStarOTA_FRAMEWORKS = Foundation UIKit JavaScriptCore WebKit QuartzCore CoreGraphics

include $(THEOS_MAKE_PATH)/tweak.mk
