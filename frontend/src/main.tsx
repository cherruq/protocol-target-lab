import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ProtocolDescriptionProvider from "./ProtocolDescriptionProvider";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProtocolDescriptionProvider><App /></ProtocolDescriptionProvider>
  </StrictMode>,
);
