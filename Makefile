EXTENSION_NAME := quick_gqt_selected
EXTENSION_DIR := src
BUILD_DIR := build
DIST_DIR := dist
SOURCES := $(shell find $(EXTENSION_DIR)/ -type f ! -name '*~')
LEGACY_MIN_VERSION := 58.0
LEGACY_XPI := $(EXTENSION_NAME)-legacy.xpi
LEGACY_JQ_FILTER := .browser_specific_settings.gecko.strict_min_version="LEGACY_MIN_VERSION" | del(.browser_specific_settings.gecko.data_collection_permissions) | del(.browser_specific_settings.gecko_android)

.PHONY: clean xpi legacy-xpi

xpi: clean $(SOURCES)
	rm -rf $(DIST_DIR)
	mkdir $(DIST_DIR)
	mkdir $(BUILD_DIR)
	cp -r $(SOURCES) $(BUILD_DIR)
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(EXTENSION_NAME).xpi *
	rm -rf $(BUILD_DIR)

legacy-xpi: clean $(SOURCES)
	rm -rf $(DIST_DIR)
	mkdir $(DIST_DIR)
	mkdir $(BUILD_DIR)
	cp -r $(SOURCES) $(BUILD_DIR)
	@jq '$(LEGACY_JQ_FILTER)' $(BUILD_DIR)/manifest.json | sed "s/LEGACY_MIN_VERSION/$(LEGACY_MIN_VERSION)/" > $(BUILD_DIR)/manifest.json.tmp
	@mv $(BUILD_DIR)/manifest.json.tmp $(BUILD_DIR)/manifest.json
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(LEGACY_XPI) *
	rm -rf $(BUILD_DIR)

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi $(DIST_DIR)/$(LEGACY_XPI)
