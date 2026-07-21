import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Separator from "@radix-ui/react-separator";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Activity, Bot, Gauge, Home, Menu, Network, Search, Siren, TableProperties } from "lucide-react";
import { useMemo } from "react";
import { Link, useLocation } from "./components/router";
import { AnalyzePage } from "./pages/AnalyzePage";
import { AppOverviewPage } from "./pages/AppOverviewPage";
import { ErrorsPage } from "./pages/ErrorsPage";
import { EventsPage } from "./pages/EventsPage";
import { NetworkPage } from "./pages/NetworkPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PerformancePage } from "./pages/PerformancePage";

const nav = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/apps/demo-app", label: "App", icon: Activity },
  { href: "/apps/demo-app/events", label: "Events", icon: TableProperties },
  { href: "/apps/demo-app/errors", label: "Errors", icon: Siren },
  { href: "/apps/demo-app/performance", label: "Performance", icon: Gauge },
  { href: "/apps/demo-app/network", label: "Network", icon: Network },
  { href: "/apps/demo-app/analyze", label: "AI Analysis", icon: Bot }
];

export function App() {
  const location = useLocation();
  const page = useMemo(() => route(location.pathname), [location.pathname]);

  return (
    <Tooltip.Provider>
      <div className="grid min-h-screen grid-cols-[240px_1fr] bg-ink text-slate-100">
        <aside className="border-r border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-ink"><Activity size={20} /></div>
            <div>
              <p className="font-semibold">React Intelligence</p>
              <p className="text-xs text-muted">Runtime telemetry</p>
            </div>
          </div>
          <Separator.Root className="my-4 h-px bg-line" />
          <nav className="space-y-1">
            {nav.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.href;
              return (
                <Link key={item.href} href={item.href} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${active ? "bg-line text-white" : "text-muted hover:bg-line/60 hover:text-white"}`}>
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0">
          <header className="flex h-16 items-center justify-between border-b border-line px-6">
            <div className="flex items-center gap-3">
              <Search size={18} className="text-muted" />
              <span className="text-sm text-muted">demo-app telemetry workspace</span>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="rounded-md border border-line p-2 hover:bg-line" aria-label="Menu"><Menu size={18} /></DropdownMenu.Trigger>
              <DropdownMenu.Content className="z-50 rounded-md border border-line bg-panel p-1 shadow-xl">
                <DropdownMenu.Item className="rounded px-3 py-2 text-sm outline-none hover:bg-line">Server: localhost:4000</DropdownMenu.Item>
                <DropdownMenu.Item className="rounded px-3 py-2 text-sm outline-none hover:bg-line">Model: llama3.1</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </header>
          <div className="p-6">{page}</div>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

function route(pathname: string) {
  const appId = pathname.split("/")[2] ?? "demo-app";
  if (pathname === "/") return <OverviewPage />;
  if (pathname.endsWith("/events")) return <EventsPage appId={appId} />;
  if (pathname.endsWith("/errors")) return <ErrorsPage appId={appId} />;
  if (pathname.endsWith("/performance")) return <PerformancePage appId={appId} />;
  if (pathname.endsWith("/network")) return <NetworkPage appId={appId} />;
  if (pathname.endsWith("/analyze")) return <AnalyzePage appId={appId} />;
  return <AppOverviewPage appId={appId} />;
}
