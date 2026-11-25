import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./ui/App.tsx";
import { countPageView } from "./analytics";

countPageView();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
