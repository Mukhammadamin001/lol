#!/usr/bin/env bash
# Claude Code status line: model name plus a color-coded context-window bar.
#
#   [Opus] ███████░░░░░░░░░░░░░ 36% · 72k/200k
#
# Reads the status line JSON from stdin. Needs jq.
# Env: CONTEXT_BAR_WIDTH (default 20), NO_COLOR (disables colors).

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  echo "context-bar: install jq"
  exit 0
fi

# Join on the ASCII unit separator: unlike a tab, read keeps empty fields.
IFS=$'\x1f' read -r model pct used size < <(
  jq -r '[
    (.model.display_name // "Claude"),
    (.context_window.used_percentage // ""),
    (.context_window.total_input_tokens // 0),
    (.context_window.context_window_size // 200000)
  ] | map(tostring) | join("\u001f")' <<<"$input"
)

# used_percentage can be null early in a session; derive it from token counts.
if [ -z "$pct" ]; then
  pct=$(( size > 0 ? used * 100 / size : 0 ))
fi
pct=${pct%%.*}
(( pct > 100 )) && pct=100

# Human-readable token counts: 950, 72k, 1.2M.
fmt() {
  local n=$1
  if (( n >= 1000000 )); then
    awk -v n="$n" 'BEGIN { s = sprintf("%.1f", n / 1000000); sub(/\.0$/, "", s); print s "M" }'
  elif (( n >= 1000 )); then
    echo "$(( n / 1000 ))k"
  else
    echo "$n"
  fi
}

width=${CONTEXT_BAR_WIDTH:-20}
# Shrink the bar on narrow terminals; Claude Code sets COLUMNS for us.
if [ -n "$COLUMNS" ] && (( COLUMNS < 60 )); then
  width=10
fi
filled=$(( pct * width / 100 ))
empty=$(( width - filled ))
printf -v bar_fill '%*s' "$filled" ''
printf -v bar_rest '%*s' "$empty" ''
bar="${bar_fill// /█}${bar_rest// /░}"

if [ -n "$NO_COLOR" ]; then
  color='' dim='' reset=''
else
  if   (( pct >= 90 )); then color=$'\033[31m'  # red
  elif (( pct >= 70 )); then color=$'\033[33m'  # yellow
  else                       color=$'\033[32m'  # green
  fi
  dim=$'\033[2m' reset=$'\033[0m'
fi

printf '[%s] %s%s%s %d%% %s· %s/%s%s\n' \
  "$model" "$color" "$bar" "$reset" "$pct" "$dim" "$(fmt "$used")" "$(fmt "$size")" "$reset"
