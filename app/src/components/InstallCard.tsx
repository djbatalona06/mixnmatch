// "Get the app": the browser's install window where possible, or the iPhone steps.
import { Share, SquarePlus, X } from "lucide-react";
import { useState } from "react";
import { isIos, useInstall } from "../store/install";
import { Button, Card } from "./ui";

const DISMISS_KEY = "mnm-install-dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Full card for the Account screen: always explains what to do. */
export function InstallCard() {
  const { prompt, installed, install } = useInstall();
  return (
    <Card className="space-y-3" id="install">
      <h2 className="text-lg font-semibold">Get the app</h2>
      {installed ? (
        <p className="text-muted">You're using the installed app. ✓</p>
      ) : prompt ? (
        <>
          <p className="text-muted">Put mix n match on your home screen. It opens like any other app.</p>
          <Button variant="primary" onClick={install}>
            Install app
          </Button>
        </>
      ) : isIos() ? (
        <IosSteps />
      ) : (
        <p className="text-muted">
          Open your browser's menu and choose <strong className="text-fg">Install app</strong> or <strong className="text-fg">Add to Home screen</strong>.
        </p>
      )}
    </Card>
  );
}

function IosSteps() {
  return (
    <ol className="space-y-2 text-muted">
      <li className="flex items-center gap-2">
        1. Tap <Share size={18} className="text-accent" aria-label="Share" /> at the bottom of Safari.
      </li>
      <li className="flex items-center gap-2">
        2. Choose <SquarePlus size={18} className="text-accent" aria-hidden /> <strong className="text-fg">Add to Home Screen</strong>.
      </li>
    </ol>
  );
}

/** Small banner for Home: only when installing is possible, hidden once dismissed. */
export function InstallBanner() {
  const { prompt, installed, install } = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  const ios = isIos();
  if (installed || dismissed || (!prompt && !ios)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode: it just shows again next time
    }
  };
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold">Put mix n match on your home screen</p>
        {prompt ? (
          <Button size="small" variant="primary" onClick={install}>
            Install app
          </Button>
        ) : (
          <IosSteps />
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Hide" className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-raised">
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
