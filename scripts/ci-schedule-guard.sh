#!/usr/bin/env bash
# Fallback trigger for the daily "Sync And Deploy" schedule on this repo.
# GitHub Actions schedule events are occasionally dropped entirely (Aug 26-28
# 2026 produced no runs on this repo while the workflow stayed active), which
# silently freezes the daily prompt sync. This guard runs once a day well after
# the scheduled slot; if no workflow run was created today, it dispatches one.
#
# Install (self-hosted runner Mac):
#   cp scripts/ci-schedule-guard.sh ~/.local/bin/seedance-schedule-guard.sh
#   cp scripts/ci-schedule-guard.plist ~/Library/LaunchAgents/com.youmind.seedance-schedule-guard.plist
#   launchctl load ~/Library/LaunchAgents/com.youmind.seedance-schedule-guard.plist
set -euo pipefail

REPO="beyond-motion/youmind-seedance-sync"
GH="/opt/homebrew/bin/gh"
# launchd shells don't inherit the user proxy, and gh needs it on this network.
export https_proxy="${https_proxy:-http://127.0.0.1:7890}"
export http_proxy="${http_proxy:-http://127.0.0.1:7890}"

today="$(TZ=UTC date +%F)"
count="$("$GH" api "repos/$REPO/actions/runs?created=$today&per_page=1" --jq '.total_count')"

if [ "$count" -gt 0 ]; then
  echo "$today: workflow run already exists; no dispatch needed."
  exit 0
fi

echo "$today: no workflow run created today (schedule likely dropped); dispatching."
"$GH" workflow run sync-and-deploy.yml --repo "$REPO" --ref main
