import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { rpc, type ActivationStatus } from "./shared";
import { Icon, useAppearance } from "./appearance-react";
import "./ui.css";
function App() {
  useAppearance();
  const tabId = Number(new URL(location.href).searchParams.get("tab"));
  const [status, setStatus] = useState<ActivationStatus>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    rpc<ActivationStatus>({ type: "ACTIVATION_STATUS", tabId })
      .then(setStatus)
      .catch((e: unknown) => { setError(String(e)); });
  useEffect(() => {
    void load();
  }, []);
  return (
    <main className="preferences">
      <header>
        <Icon name="brand" />
        <h1>Let’s reconnect Zephyer</h1>
      </header>
      <section className="settings-section">
        <h2>
          {status?.stage === "ready"
            ? "Dock is ready"
            : "Activation needs attention"}
        </h2>
        <p role="status">
          {status?.detail || "Retry to check this tab’s connection."}
        </p>
        <p>{status?.category && `Reason: ${status.category}`}</p>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await rpc({ type: "ACTIVATION_RETRY", tabId });
              } catch (e) {
                setError(String(e));
              } finally {
                await load();
                setBusy(false);
              }
            }}
          >
            {busy ? "Reconnecting…" : "Retry activation"}
          </button>
          <button
            onClick={() =>
              chrome.tabs.create({
                url: `chrome://extensions/?id=${chrome.runtime.id}`,
              })
            }
          >
            Open extension site-access settings
          </button>
          <button onClick={() => chrome.runtime.openOptionsPage()}>
            Zephyer preferences
          </button>
        </div>
        <p>
          Allow access to the website, then refresh its tab. After an extension
          update, refresh websites that were already open. Chrome internal pages
          cannot host the dock.
        </p>
        <button
          onClick={() => {
            const blob = new Blob(
              [
                JSON.stringify(
                  { version: chrome.runtime.getManifest().version, status },
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "zephyer-activation.json";
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); }, 1000);
          }}
        >
          Export local diagnostic
        </button>
        <p>No image URLs, page text or account data are included.</p>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
