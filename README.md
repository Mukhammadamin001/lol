# context-bar

Two ways to watch how full Claude Code's context window is: a status line
script, and a mod with a bar above the prompt.

## Status line

A Claude Code status line that shows how full the context window is:

```
[Opus] ███████░░░░░░░░░░░░░ 36% · 72k/200k
```

The bar is green below 70%, yellow from 70%, and red from 90%.

### Use it

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

### Options

| Variable            | Effect                         |
| ------------------- | ------------------------------ |
| `CONTEXT_BAR_WIDTH` | Bar width in cells (default 20) |
| `NO_COLOR`          | Turns colors off               |

## Mod

`mods/context-bar` is a Claude Code mod (a plugin of function hooks). It adds:

- **A bar above the prompt**: `Context ███████░░░░░░░ 36% · 72k/200k [ Hide ]`,
  green, yellow from 70%, red from 90%. It appears after the first response.
- **`/context-bar [on|off]`**: shows or hides the bar (no argument toggles) and
  prints the current usage. The choice is remembered across sessions.
- **Toasts at 70% and 90%**: once each as usage climbs, and again after
  `/compact` brings it back down.

Install it from any Claude Code terminal session:

```
/plugin install context-bar --marketplace Mukhammadamin001/lol
```

Answer `y` to add the marketplace, then pick a scope.

To work on it, load it from your clone with
`claude --plugin-dir ./mods/context-bar`, and check it with:

```sh
claude plugin validate ./mods/context-bar
claude plugin test ./mods/context-bar
```
