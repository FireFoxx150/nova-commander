# Cloud and MEGA

Nova uses [rclone](https://rclone.org) for cloud accounts. Each account appears in the sidebar's Cloud section, and connecting mounts it as a folder under `~/Cloud/<name>`.

## Requirements

- `rclone`
- `fuse3`, so rclone can mount the account as a folder
- The `.deb` package. The Flatpak sandbox can't use FUSE, so Nova shows an explanation there instead

Install both with:

```bash
sudo apt install rclone fuse3
```

## Add an account

Click **Add cloud account…** in the Cloud section. A terminal opens and runs `rclone config`. Finish the sign-in there, then press Refresh in the Cloud section.

To remove an account, right-click it and choose **Remove account…**. Confirm in the terminal.

## Connect and disconnect

- Click an account to connect it and open its folder. The mount waits up to 30 seconds.
- Right-click for **Connect**, **Disconnect**, **Open**, or **Remove account…**.
- Nova unmounts every account when it quits, using a lazy unmount so a dropped connection can't hang the app.

Mounts use a local cache per account, set in Settings → Cloud (10 GB by default). Mount read-only from the same settings.

## MEGA uploads

Accounts whose rclone type is `mega` also get a **MEGA** section in the sidebar. Click **Upload to <name>…** to pick files or folders on this computer and copy them into the root of that account. Each item is copied in turn, and the first error stops the batch.

Uploads don't show a progress bar, and they don't use the operations queue. Large uploads show only a start and a finish message.

MEGA accounts also appear in the Cloud section, where they can be mounted like any other account.
