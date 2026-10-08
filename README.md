# context-bar

A Claude Code status line that shows how full the context window is:

```
[Opus] ███████░░░░░░░░░░░░░ 36% · 72k/200k
```

The bar is green below 70%, yellow from 70%, and red from 90%.

## Use it

In this repo it is already on: `.claude/settings.json` points the status line at
`.claude/statusline/context-bar.sh`. Start Claude Code here and the bar shows up.

To use it everywhere, copy the script and add it to `~/.claude/settings.json`:

```sh
cp .claude/statusline/context-bar.sh ~/.claude/context-bar.sh
```

```json
{
  "statusLine": { "type": "command", "command": "bash ~/.claude/context-bar.sh" }
}
```

Requires `jq`.

## Options

| Variable            | Effect                         |
| ------------------- | ------------------------------ |
| `CONTEXT_BAR_WIDTH` | Bar width in cells (default 20) |
| `NO_COLOR`          | Turns colors off               |
