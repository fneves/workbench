import { platform } from "os";
import { cmuxNotify, isInsideCmux } from "#lib/cmux";
import { getNotificationsEnabled } from "#lib/config";

export function notify(title: string, body: string, sound = "default", group = "workbench"): void {
  if (!getNotificationsEnabled()) return;
  try {
    // Use cmux notifications if inside cmux
    if (isInsideCmux()) {
      cmuxNotify(title, body);
      return;
    }

    // Fallback to OS-native notifications
    const os = platform();
    if (os === "darwin") {
      const tn = Bun.spawnSync(["which", "terminal-notifier"]);
      if (tn.exitCode === 0) {
        Bun.spawn([
          "terminal-notifier",
          "-title",
          title,
          "-message",
          body,
          "-group",
          group,
          "-sound",
          sound,
        ]);
        return;
      }
      Bun.spawn([
        "osascript",
        "-e",
        `display notification "${body}" with title "${title}" sound name "${sound}"`,
      ]);
    } else if (os === "linux") {
      Bun.spawn(["notify-send", "--urgency=normal", `--app-name=${group}`, title, body]);
    }
  } catch {
    // Notifications are best-effort
  }
}
