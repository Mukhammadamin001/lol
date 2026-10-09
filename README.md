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

## Encore Music

`music/` is a free music player that runs in the browser, styled after Apple
Music. It needs no account and no subscription.

- **Every song in the Apple catalog.** Search songs, albums and artists, and
  browse top charts by country and genre. Songs play as Apple's free 30-second
  previews, which come from the public iTunes Search API.
- **Free full songs.** Complete tracks that independent artists share for free
  on [Audius](https://audius.co).
- **My Files.** Add MP3, M4A, WAV, OGG or FLAC files you own. They play in full
  and stay in your browser.
- Liked songs, playlists, a queue, shuffle and repeat, synced lyrics (from
  LRCLIB), lock-screen controls, and light and dark mode. Works on phones too.
- Each song's ••• menu links to the full song on YouTube or Apple Music.

Full-length songs from the Apple catalog need an Apple Music subscription, so
the app only plays the previews Apple makes free.

### Use it

Open `music/index.html` in a browser. There's nothing to install or build.

To get a link you can open on your phone, turn on GitHub Pages: go to
**Settings → Pages**, pick **Deploy from a branch**, then choose `main` and
`/ (root)`. The player is then at
`https://<your-user>.github.io/lol/music/`.

Keyboard: <kbd>Space</kbd> plays or pauses, <kbd>←</kbd>/<kbd>→</kbd> seek
5 seconds, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> skip songs, and
<kbd>/</kbd> jumps to search.
