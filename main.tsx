/* Entry point. Everything below this line is parsed, priced and drawn in the page; there
   is no fetch in this bundle and no server to send anything to. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const host = document.getElementById("app");
if (!host) throw new Error("missing #app in the document");

createRoot(host).render(<StrictMode><App /></StrictMode>);
