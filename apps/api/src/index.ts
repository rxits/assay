// Process entrypoint: bind the app to a port. Render injects PORT; local dev falls
// back to 4000 (09 §4). The app factory itself never listens (keeps it testable).
import { createApp } from "./app";
import { adminGateFailsClosed } from "./lib/security";

const port = Number(process.env.PORT) || 4000;

// One line at boot, because "why did DELETE just 403?" and "why is my demo empty?" are both
// answered by the same missing variable.
if (!process.env.ADMIN_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn(
    adminGateFailsClosed()
      ? "ADMIN_TOKEN is not set — destructive routes (/api/settings, /api/data) are DISABLED."
      : "ADMIN_TOKEN is not set — destructive routes (/api/settings, /api/data) are UNPROTECTED. Set it before deploying.",
  );
}

createApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`assay-api listening on :${port}`);
});
