EXTENSION_NAME := quick_gqt_selected
EXTENSION_DIR := src
BUILD_DIR := build
DIST_DIR := dist
SOURCES := $(shell find $(EXTENSION_DIR)/ -type f ! -path '$(EXTENSION_DIR)/vendor/*' ! -name '*~')
KATEX_SRC := node_modules/katex
KATEX_DIST := $(KATEX_SRC)/dist
KATEX_VENDOR_DIR := $(EXTENSION_DIR)/vendor/katex
LEGACY_MIN_VERSION := 58.0
LEGACY_XPI := $(EXTENSION_NAME)-legacy.xpi
LEGACY_JQ_FILTER := .applications={gecko:{id:.browser_specific_settings.gecko.id,strict_min_version:"LEGACY_MIN_VERSION"}} | del(.browser_specific_settings)

.PHONY: clean xpi legacy-xpi vendor-katex

xpi: vendor-katex $(SOURCES)
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi
	mkdir -p $(DIST_DIR) $(BUILD_DIR)
	rsync -a --exclude='*~' $(EXTENSION_DIR)/ $(BUILD_DIR)/
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(EXTENSION_NAME).xpi *
	rm -rf $(BUILD_DIR)

legacy-xpi: vendor-katex $(SOURCES)
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(LEGACY_XPI)
	mkdir -p $(DIST_DIR) $(BUILD_DIR)
	rsync -a --exclude='*~' $(EXTENSION_DIR)/ $(BUILD_DIR)/
	@jq '$(LEGACY_JQ_FILTER)' $(BUILD_DIR)/manifest.json | sed "s/LEGACY_MIN_VERSION/$(LEGACY_MIN_VERSION)/" > $(BUILD_DIR)/manifest.json.tmp
	@mv $(BUILD_DIR)/manifest.json.tmp $(BUILD_DIR)/manifest.json
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(LEGACY_XPI) *
	rm -rf $(BUILD_DIR)

vendor-katex:
	@if [ ! -f "$(KATEX_DIST)/katex.min.js" ] || [ ! -f "$(KATEX_DIST)/katex.min.css" ] || [ ! -d "$(KATEX_DIST)/fonts" ]; then \
		echo "Missing KaTeX sources."; \
		echo "Expected:"; \
		echo "  $(KATEX_DIST)/katex.min.js"; \
		echo "  $(KATEX_DIST)/katex.min.css"; \
		echo "  $(KATEX_DIST)/fonts"; \
		echo "Run in this repo: npm install"; \
		exit 1; \
	fi
	rm -rf $(EXTENSION_DIR)/vendor/mathjax $(KATEX_VENDOR_DIR)
	mkdir -p $(KATEX_VENDOR_DIR)
	cp "$(KATEX_DIST)/katex.min.js" "$(KATEX_VENDOR_DIR)/katex.min.js"
	cp "$(KATEX_DIST)/katex.min.css" "$(KATEX_VENDOR_DIR)/katex.min.css"
	cp -R "$(KATEX_DIST)/fonts" "$(KATEX_VENDOR_DIR)/fonts"
	@if [ -f "$(KATEX_SRC)/LICENSE" ]; then \
		cp "$(KATEX_SRC)/LICENSE" "$(KATEX_VENDOR_DIR)/LICENSE"; \
	fi; \
	if [ -f "$(KATEX_SRC)/package.json" ]; then \
		cp "$(KATEX_SRC)/package.json" "$(KATEX_VENDOR_DIR)/package.json"; \
	fi

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi $(DIST_DIR)/$(LEGACY_XPI)
