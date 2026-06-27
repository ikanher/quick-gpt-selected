EXTENSION_NAME := quick_gqt_selected
EXTENSION_DIR := src
BUILD_DIR := build
DIST_DIR := dist
SOURCES := $(shell find $(EXTENSION_DIR)/ -type f ! -path '$(EXTENSION_DIR)/vendor/mathjax/*' ! -name '*~')
MATHJAX_SRC := node_modules/mathjax/es5
MATHJAX_SRC_ALT := node_modules/mathjax
NPM_ROOT := $(shell npm root 2>/dev/null)
MATHJAX_SRC_NPM_ROOT := $(NPM_ROOT)/mathjax
MATHJAX_VENDOR_DIR := $(EXTENSION_DIR)/vendor/mathjax
MATHJAX_COMPONENT := tex-svg.js
LEGACY_MIN_VERSION := 58.0
LEGACY_XPI := $(EXTENSION_NAME)-legacy.xpi
LEGACY_JQ_FILTER := .applications={gecko:{id:.browser_specific_settings.gecko.id,strict_min_version:"LEGACY_MIN_VERSION"}} | del(.browser_specific_settings)

.PHONY: clean xpi legacy-xpi vendor-mathjax

xpi: vendor-mathjax $(SOURCES)
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi
	mkdir -p $(DIST_DIR) $(BUILD_DIR)
	rsync -a --exclude='*~' $(EXTENSION_DIR)/ $(BUILD_DIR)/
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(EXTENSION_NAME).xpi *
	rm -rf $(BUILD_DIR)

legacy-xpi: vendor-mathjax $(SOURCES)
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(LEGACY_XPI)
	mkdir -p $(DIST_DIR) $(BUILD_DIR)
	rsync -a --exclude='*~' $(EXTENSION_DIR)/ $(BUILD_DIR)/
	@jq '$(LEGACY_JQ_FILTER)' $(BUILD_DIR)/manifest.json | sed "s/LEGACY_MIN_VERSION/$(LEGACY_MIN_VERSION)/" > $(BUILD_DIR)/manifest.json.tmp
	@mv $(BUILD_DIR)/manifest.json.tmp $(BUILD_DIR)/manifest.json
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(LEGACY_XPI) *
	rm -rf $(BUILD_DIR)

vendor-mathjax:
	@if [ ! -f "$(MATHJAX_SRC)/$(MATHJAX_COMPONENT)" ] && [ ! -f "$(MATHJAX_SRC_ALT)/$(MATHJAX_COMPONENT)" ] && [ ! -f "$(MATHJAX_SRC_NPM_ROOT)/$(MATHJAX_COMPONENT)" ]; then \
		echo "Missing MathJax sources."; \
		echo "Expected one of:"; \
		echo "  $(MATHJAX_SRC)/$(MATHJAX_COMPONENT) (MathJax v3)"; \
		echo "  $(MATHJAX_SRC_ALT)/$(MATHJAX_COMPONENT) (MathJax v4)"; \
		echo "  $(MATHJAX_SRC_NPM_ROOT)/$(MATHJAX_COMPONENT) (from npm root)"; \
		echo "Run in this repo: npm install"; \
		exit 1; \
	fi
	rm -rf $(MATHJAX_VENDOR_DIR)
	mkdir -p $(MATHJAX_VENDOR_DIR)
	@if [ -f "$(MATHJAX_SRC)/$(MATHJAX_COMPONENT)" ]; then \
		mathjax_src="$(MATHJAX_SRC)"; \
	elif [ -f "$(MATHJAX_SRC_NPM_ROOT)/$(MATHJAX_COMPONENT)" ]; then \
		mathjax_src="$(MATHJAX_SRC_NPM_ROOT)"; \
	else \
		mathjax_src="$(MATHJAX_SRC_ALT)"; \
	fi; \
	cp "$$mathjax_src/$(MATHJAX_COMPONENT)" "$(MATHJAX_VENDOR_DIR)/$(MATHJAX_COMPONENT)"; \
	if [ -f "$$mathjax_src/LICENSE" ]; then \
		cp "$$mathjax_src/LICENSE" "$(MATHJAX_VENDOR_DIR)/LICENSE"; \
	fi; \
	if [ -f "$$mathjax_src/package.json" ]; then \
		cp "$$mathjax_src/package.json" "$(MATHJAX_VENDOR_DIR)/package.json"; \
	fi

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi $(DIST_DIR)/$(LEGACY_XPI)
