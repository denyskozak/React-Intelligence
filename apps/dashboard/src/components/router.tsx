import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";

export function useLocation() {
  const [location, setLocation] = useState(window.location);
  useEffect(() => {
    const onPop = () => setLocation(window.location);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return location;
}

export function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        history.pushState({}, "", href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      {children}
    </a>
  );
}
