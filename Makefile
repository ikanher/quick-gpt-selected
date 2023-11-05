EXTENSION_NAME := quick_gqt_selected
EXTENSION_DIR := src
BUILD_DIR := build
DIST_DIR := dist
SOURCES := $(shell find $(EXTENSION_DIR)/ -type f ! -name '*~')

.PHONY: clean xpi

xpi: clean $(SOURCES)
	rm -rf $(DIST_DIR)
	mkdir $(DIST_DIR)
	mkdir $(BUILD_DIR)
	cp -r $(SOURCES) $(BUILD_DIR)
	cd $(BUILD_DIR); zip -r ../$(DIST_DIR)/$(EXTENSION_NAME).xpi *
	rm -rf $(BUILD_DIR)

clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)/$(EXTENSION_NAME).xpi
