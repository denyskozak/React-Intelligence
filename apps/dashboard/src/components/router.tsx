import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useEffect, useState } from "react";

function getWindowLocation() {
    return {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
    }
}

export function useLocation() {
  const [location, setLocation] = useState(getWindowLocation);
  useEffect(() => {
    const onPop = () => setLocation(getWindowLocation);
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
