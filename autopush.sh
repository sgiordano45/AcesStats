#!/bin/bash
# autopush.sh — auto-commit and auto-push for AcesStats repo
# Runs via launchd every 10 minutes

REPO="$HOME/Documents/Aces/AcesStats"
LOG="$HOME/Library/Logs/acesstats-autopush.log"
PENDING="$REPO/.pending-commit"

cd "$REPO" || exit 1

# Step 1: If Claude left a pending commit message, commit now
if [ -f "$PENDING" ]; then
  MSG=$(cat "$PENDING")
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pending commit found: $MSG" >> "$LOG"
  git add -A >> "$LOG" 2>&1
  git commit -m "$MSG" >> "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Commit successful." >> "$LOG"
    rm "$PENDING"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Commit failed." >> "$LOG"
  fi
fi

# Step 2: Push any unpushed commits
AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null)

if [ "$AHEAD" -gt 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $AHEAD unpushed commit(s) found — pushing..." >> "$LOG"
  git push origin main >> "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Push successful." >> "$LOG"
  else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Push failed." >> "$LOG"
  fi
fi
