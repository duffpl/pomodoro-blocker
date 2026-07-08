# Build the Chrome Web Store package.
# Version is read from manifest.json so it never drifts.

VERSION := $(shell grep '"version"' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
ZIP := pomodoro-blocker-$(VERSION).zip

# Only runtime files ship — no tests, git, or design folders.
FILES := \
	manifest.json \
	background.js schedule.js domains.js \
	theme.css \
	popup.html popup.css popup.js \
	options.html options.css options.js \
	blocked.html blocked.css blocked.js \
	assets/stop.svg \
	assets/icon-16.png assets/icon-48.png assets/icon-64.png assets/icon-128.png

.PHONY: zip clean
zip: $(ZIP)

$(ZIP): $(FILES)
	rm -f $@
	zip -q $@ $(FILES)
	@echo "Built $@"
	@unzip -l $@

clean:
	rm -f pomodoro-blocker-*.zip
