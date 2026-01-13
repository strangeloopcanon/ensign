SHELL := /bin/bash
.PHONY: setup check test llm-live deps-audit all

AGENT_MODE ?= baseline

setup:
	cd ensign-desktop && npm ci

check:
	cd ensign-desktop && npm run build:main
	cd ensign-desktop && npm run build:renderer

test:
	cd ensign-desktop && npm test

llm-live:
	@echo "llm-live: N/A (no goldens configured)"

deps-audit:
	@echo "deps-audit (mode=$(AGENT_MODE))"
	@cd ensign-desktop && npm audit --audit-level=high || ( \
		if [ "$(AGENT_MODE)" = "production" ]; then \
			echo "npm audit failed (blocking in production)"; exit 1; \
		else \
			echo "npm audit failed (advisory in baseline)"; exit 0; \
		fi \
	)

all: check test
	@if [ "$(AGENT_MODE)" = "production" ]; then \
		$(MAKE) deps-audit; \
	fi
