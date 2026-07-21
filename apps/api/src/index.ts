// Process entrypoint: bind the app to a port. Render injects PORT; local dev falls
// back to 4000 (09 §4). The app factory itself never listens (keeps it testable).
import { createApp } from "./app";

const port = Number(process.env.PORT) || 4000;

createApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`assay-api listening on :${port}`);
});
