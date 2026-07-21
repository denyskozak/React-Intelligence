import { ReactIntelligenceProvider, track } from "@react-intelligence/sdk";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  const [route, setRoute] = useState("/products");
  const [explode, setExplode] = useState(false);
  if (explode) throw new Error("Demo checkout render exploded");

  async function simulateFetch() {
    await fetch("https://jsonplaceholder.typicode.com/todos/1");
  }

  return (
    <main>
      <h1>React Intelligence Demo</h1>
      <p>Use these controls to create local SDK telemetry for demo-app.</p>
      <nav>
        {["/products", "/checkout", "/account"].map((item) => (
          <button key={item} onClick={() => {
            history.pushState({}, "", item);
            setRoute(item);
          }}>{item}</button>
        ))}
      </nav>
      <section>
        <h2>{route}</h2>
        <button data-testid="slow-fetch" onClick={simulateFetch}>Run fetch</button>
        <button onClick={() => console.warn("Demo warning from checkout")}>Console warn</button>
        <button onClick={() => track("checkout_started", { cartSize: 3, source: "demo_app" })}>Track checkout</button>
        <button onClick={() => setExplode(true)}>Trigger React error</button>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReactIntelligenceProvider
      appId="demo-app"
      endpoint="http://localhost:4000"
      environment="development"
      release="1.0.0"
    >
      <App />
    </ReactIntelligenceProvider>
  </React.StrictMode>
);
