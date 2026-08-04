import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Separator from "@radix-ui/react-separator";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Activity, Bot, Gauge, Home, Menu, Network, Search, Siren, TableProperties } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, matchPath, useLocation, useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { AnalyzePage } from "./pages/AnalyzePage";
import { AppOverviewPage } from "./pages/AppOverviewPage";
import { ErrorsPage } from "./pages/ErrorsPage";
import { EventsPage } from "./pages/EventsPage";
import { NetworkPage } from "./pages/NetworkPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PerformancePage } from "./pages/PerformancePage";

import {useAsync} from "./pages/hooks";
import { api } from "./lib/api"
import { SelectBox, EmptyState, ErrorState, Loading} from "./components/ui";

const appNav = [
  { path: "", label: "App", icon: Activity, end: true },
  { path: "/events", label: "Events", icon: TableProperties },
  { path: "/errors", label: "Errors", icon: Siren },
  { path: "/performance", label: "Performance", icon: Gauge },
  { path: "/network", label: "Network", icon: Network },
  { path: "/analyze", label: "AI Analysis", icon: Bot }
];

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const appMatch = matchPath({ path: "/apps/:appId/*", end: false }, location.pathname);
  const currentAppId = appMatch?.params.appId;
  const appBase = currentAppId ? `/apps/${encodeURIComponent(currentAppId)}` : undefined;

  const {data, loading, error} = useAsync(api.overview, []);
  const apps = data?.apps ?? [];
  const selectedAppId = currentAppId ?? apps[0]?.appId;
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
            <NavLink to="/" end className={navClassName}>
              <Home size={16} />
              Overview
            </NavLink>
            {appBase ? appNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.path || "app"} to={`${appBase}${item.path}`} end={item.end} className={navClassName}>
                  <Icon size={16} />
                  {item.label}
                </NavLink>
              );
            }) : null}
          </nav>
        </aside>
        <main className="min-w-0">
          <header className="flex h-16 items-center justify-between border-b border-line px-6">
            <div className="flex items-center gap-3">
              <Search size={18} className="text-muted" />

              <SelectBox
              value={selectedAppId}
              items={apps.map((app) => app.appId)}
              onValueChange={(nextAppId) => {
              navigate(buildAppPath(location.pathname, nextAppId));
              }}
              ></SelectBox>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="rounded-md border border-line p-2 hover:bg-line" aria-label="Menu"><Menu size={18} /></DropdownMenu.Trigger>
              <DropdownMenu.Content className="z-50 rounded-md border border-line bg-panel p-1 shadow-xl">
                <DropdownMenu.Item className="rounded px-3 py-2 text-sm outline-none hover:bg-line">Server: localhost:4000</DropdownMenu.Item>
                <DropdownMenu.Item className="rounded px-3 py-2 text-sm outline-none hover:bg-line">Model: llama3.1</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </header>
          <div className="p-6">
            <Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/apps/:appId" element={<AppPage>{(appId) => <AppOverviewPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/events" element={<AppPage>{(appId) => <EventsPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/errors" element={<AppPage>{(appId) => <ErrorsPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/performance" element={<AppPage>{(appId) => <PerformancePage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/network" element={<AppPage>{(appId) => <NetworkPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/analyze" element={<AppPage>{(appId) => <AnalyzePage appId={appId} />}</AppPage>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

function navClassName({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? "bg-line text-white" : "text-muted hover:bg-line/60 hover:text-white"}`;
}

function AppPage({ children }: { children: (appId: string) => ReactNode }) {
  const { appId } = useParams<{ appId: string }>();
  return appId ? children(appId) : <Navigate to="/" replace />;
}

function NotFoundPage() {
  return (
    <div className="card flex min-h-64 flex-col items-center justify-center p-8 text-center">
      <p className="text-2xl font-semibold">Page not found</p>
      <p className="mt-2 text-sm text-muted">The requested telemetry view does not exist.</p>
      <Link to="/" className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink">Back to overview</Link>
    </div>
  );
}
function buildAppPath(pathname: string, nextAppId: string) {
  const match = matchPath({path: "/apps/:appId/*", end: false}, pathname);
  const rest = match?.params["*"];

  return rest ? `/apps/${encodeURIComponent(nextAppId)}/${rest}` : `/apps/${encodeURIComponent(nextAppId)}`;
}