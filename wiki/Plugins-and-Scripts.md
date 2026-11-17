# Plugins and scripts

Both add commands to the right-click menu for the selected files. They appear as **Script: …** or **Plugin: …** entries.

## Scripts

Any executable file in the scripts folder appears in the menu. Open it from the menu with **Open scripts folder**, or find it at `~/.config/Nova Commander/scripts/`.

A script runs with the selected paths as arguments, in the current folder. It also gets two environment variables:

- `NOVA_DIR`: the current folder
- `NOVA_OTHER_DIR`: the other pane's folder, or empty when dual pane is off

Anything the script prints is shown when it finishes.

## Plugins

A plugin is a folder in `~/.config/Nova Commander/plugins/`. Each plugin folder needs a `plugin.json` file and the script it runs:

```json
{
  "name": "Resize",
  "run": "resize.sh",
  "match": ["*.jpg", "*.png"]
}
```

- `name`: shown in the menu as **Plugin: Resize**
- `run`: an executable in the same folder. It must be inside the plugin's folder
- `match`: wildcards for the file names the plugin applies to. Leave it out and the plugin applies to every file

A plugin appears only when every selected name matches one of its wildcards. A missing or broken `plugin.json` is skipped without a message, so check the file if a plugin doesn't appear.

Plugin shortcuts aren't supported yet. Plugins run through the same runner as scripts, and the same `NOVA_DIR` and `NOVA_OTHER_DIR` variables are set.
