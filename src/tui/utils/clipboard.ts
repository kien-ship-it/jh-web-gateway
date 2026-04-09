import { spawn } from "node:child_process";

export async function copyToClipboard(text: string): Promise<boolean> {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case "darwin":
      command = "pbcopy";
      args = [];
      break;
    case "linux":
      command = "xclip";
      args = ["-selection", "clipboard"];
      break;
    case "win32":
      command = "clip";
      args = [];
      break;
    default:
      return false;
  }

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }

    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));

    try {
      proc.stdin?.write(text);
      proc.stdin?.end();
    } catch {
      resolve(false);
    }
  });
}
