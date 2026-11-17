# Themes

Nova has four built-in themes: **Black**, **Nord**, **Midnight** and **Light**. Switch between them from the palette button in the bottom bar, the right-click menu on it, or Settings.

## User themes

A user theme is a JSON file in `~/.config/Nova Commander/themes/`. It appears in the Theme menu after a restart.

```json
{
  "name": "Solar",
  "base": "nord",
  "vars": {
    "--accent": "#f5a623",
    "--sel": "#4a3a1a"
  }
}
```

- `name`: the name shown in the menu (up to 40 characters)
- `base`: the built-in theme to start from: `black`, `nord`, `midnight` or `light`. It defaults to `black`
- `vars`: CSS variables that override the base theme

Only variable names starting with `--` are accepted. Values can only use letters, digits, spaces, and the characters `# . , ( ) % + -`. Anything else, such as `url()` or braces, is dropped. A file that isn't valid JSON is skipped.

## Variables you can override

The colours come from these variables:

| Variable | Used for |
|---|---|
| `--bg`, `--panel`, `--pane`, `--pane-2`, `--raised` | Backgrounds, from the window down to menus |
| `--line`, `--line-2` | Borders and dividers |
| `--sel`, `--sel-dim`, `--sel-line`, `--hover` | Selection and hover |
| `--text`, `--text-2`, `--muted` | Text, secondary text and captions |
| `--accent` | Highlights and the active tab |
| `--folder-back`, `--folder-front`, `--folder-front-top`, `--folder-edge` | Folder icon colours |
| `--danger`, `--ok` | Errors and success |

Look at `renderer/styles.css` for the full list. Start from the example files in the repository's `themes/` folder, which override only a few variables each.
