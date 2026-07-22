import { ReactIntelligenceProvider, track } from "@react-intelligence/sdk";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
const products = [
  { id: 1, name: "Telemetry Mug", price: 18 },
  { id: 2, name: "React Profiler Tee", price: 32 },
  { id: 3, name: "Observability Notebook", price: 12 }
];

function Store() {
  const [cart, setCart] = useState(0);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Ready to generate telemetry");


  function addToCart(product: (typeof products)[number]) {
    setCart((count) => count + 1);
    track("product_added", { productId: product.id, productName: product.name, price: product.price });
    setMessage(`${product.name} added to cart`);
  }

  async function checkInventory() {
    const response = await fetch("http://localhost:4000/health");
    setMessage(response.ok ? "Inventory service is healthy" : "Inventory check failed");
  }

  function checkout(event: React.FormEvent) {
    event.preventDefault();
    track("checkout_completed", { cartSize: cart, hasEmail: Boolean(email) });
    console.warn("Test store checkout completed", { cartSize: cart });
    setMessage("Order completed — telemetry queued");
  }

  return (
    <main>
      <header>
        <div><span className="eyebrow">SDK integration test</span><h1>Intelligence Test Store</h1></div>
        <div className="cart" data-testid="cart-count">Cart · {cart}</div>
      </header>
      <nav aria-label="Store navigation">
        <NavLink data-testid="nav-products" to="/products">Products</NavLink>
        <NavLink data-testid="nav-checkout" to="/checkout">Checkout</NavLink>
        <NavLink data-testid="nav-account" to="/account"  >Account</NavLink>
      </nav>
      <p className="status" role="status">{message}</p>

        <Routes>

            <Route path="/products"
                element={
                <section className="grid">
                    {products.map((product) => (
                        <article key={product.id}>
                            <div className="product-icon">RI</div>
                            <h2>{product.name}</h2><p>€{product.price}</p>
                            <button data-testid={`add-product-${product.id}`} onClick={() => addToCart(product)}>Add to cart</button>
                        </article>
                    ))}
                    <button data-testid="inventory-check" className="secondary" onClick={checkInventory}>Check inventory API</button>
                </section>
            }
                   >
            </Route>

            <Route path="checkout"
                element={
                <form onSubmit={checkout}>
                    <h2>Checkout</h2>
                    <label>Email<input data-testid="checkout-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
                    <p>{cart} item(s) in your cart</p>
                    <button data-testid="complete-checkout" type="submit">Complete order</button>
                </form>
            }>
            </Route>

            <Route path="/account"
                element={
                <section className="account"><h2>Account</h2><p>No saved orders yet.</p></section>
            }>
            </Route>
        </Routes>
    </main>


  );
}

createRoot(document.getElementById("root")!).render(
    <ReactIntelligenceProvider appId="test-store" endpoint="http://localhost:4000" environment="test" release="0.1.0-browser-test">
      <BrowserRouter>
        <Store />
      </BrowserRouter>
    </ReactIntelligenceProvider>
)
