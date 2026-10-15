# Nova Commander — security review

Manual review of version 1.3.3, fixes shipped in **1.3.4** (2026-10-15).
Scope: the Electron configuration, the preload bridge and every IPC handler in the main
process, all external commands, and HTML injection in the renderer.

**Result:** no critical or high findings. One medium and eight low findings — all fixed and
verified (13/13 security checks, 55/55 feature suite, 9/9 open-items suite).

## Threat model

File names, archive contents, documents and e-mails are untrusted: a downloaded archive can
contain arbitrary names and data. The renderer is trusted local code, so the IPC boundary
only matters if the renderer were compromised (e.g. through HTML injection).

## Fixed in 1.3.4

| Severity | Issue | Fix |
|---|---|---|
| Medium | Archive passwords were passed on 7-Zip's command line (`-pSECRET`), readable by other local users via `ps`. | Passwords go to 7-Zip on stdin (bare `-p` when creating). Verified: no password in the arguments of six 7-Zip runs. |
| Low | Renderer ran with `sandbox: false`. | `sandbox: true`; the home directory now comes from the main process. |
| Low | No permission handler (camera, microphone, location, …). | All permission requests refused. |
| Low | `scripts:run` executed any path it was given. | Only files directly inside the scripts folder. |
| Low | `sys:openWith` launched any `.desktop` path it was given. | Only installed desktop entries from the application folders. |
| Low | `fs:writeNew` (batch images) accepted names containing `/` or `..`. | Plain file names only. |
| Low | `sys:defaultFM` could set any application as the default file manager. | Can only set Nova. |
| Low | A file name containing `'` or `)` could break out of the CSS `url('…')` of a folder background. | `fileUri` also percent-encodes `' ( )`. |
| Low | `.msg` / `.eml` previews read whole files into memory. | `.msg` capped at 64 MB; `.eml` reads only the first 4 MB. |

## Checked and fine

- **HTML injection:** every file name, path, alias, note, error and label inserted into the page
  goes through `esc()`. The CSP (`script-src 'self'`, no `unsafe-inline`) would block injected
  scripts and inline event handlers even if one were missed.
- **Navigation:** `will-navigate` is blocked and `window.open` is denied; no remote content is loaded.
- **Commands:** every external program is started with an argument array (no shell). User-
  controlled values are absolute paths or come after `--`, so they can't be read as options.
- **Opening files:** on Cinnamon, `xdg-open` has no handler for `.desktop` files and refuses them;
  shell scripts open in the text editor. Programs only run via the explicit Run menu items.
- **Archive extraction:** extraction happens in a temporary folder inside the destination;
  7-Zip and GNU tar refuse `../` entries.
- **Thumbnails:** SVGs are shown via `<img>`, where scripts don't run.
- **E-mail previews:** `.eml` / `.msg` content is shown as escaped plain text.
- **External URLs:** the only one opened is an OpenStreetMap link built from numeric coordinates.

## Accepted risks (by design)

- Run, Run as administrator (pkexec), the Scripts menu and Delete permanently are powerful on
  purpose; each needs an explicit menu choice.
- LibreOffice previews of untrusted Office files may fetch remote resources linked in the
  document (a tracking risk). Macros don't run during headless conversion.
- If HTML injection were ever found, the Quick Look PDF frame (`frame-src file:`) would widen
  its impact. The escaping and CSP above are the controls against it.

## Re-testing

The verification runners drive the app offscreen with a temporary HOME. They live outside the
project; ask for them to be added under `test/` if you want to re-run these checks.
