import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Separator from "@radix-ui/react-separator";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Activity, Bell, Bot, Gauge, GitCompare, Home, Menu, Network, Plug, Search, Settings, Shield, Siren, TableProperties } from "lucide-react";
import { lazy, Suspense, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, matchPath, useLocation, useParams, useNavigate } from "react-router-dom";
import { OverviewPage } from "./pages/OverviewPage";
import type { DashboardIdentity } from "./AuthGate";

import {useAsync} from "./pages/hooks";
import { api } from "./lib/api"
import { SelectBox, EmptyState, ErrorState, Loading} from "./components/ui";
import { DashboardErrorBoundary } from "./DashboardErrorBoundary";

const AnalyzePage = lazy(() => import("./pages/AnalyzePage").then((module) => ({ default: module.AnalyzePage })));
const AppOverviewPage = lazy(() => import("./pages/AppOverviewPage").then((module) => ({ default: module.AppOverviewPage })));
const ErrorsPage = lazy(() => import("./pages/ErrorsPage").then((module) => ({ default: module.ErrorsPage })));
const EventsPage = lazy(() => import("./pages/EventsPage").then((module) => ({ default: module.EventsPage })));
const NetworkPage = lazy(() => import("./pages/NetworkPage").then((module) => ({ default: module.NetworkPage })));
const PerformancePage = lazy(() => import("./pages/PerformancePage").then((module) => ({ default: module.PerformancePage })));
const AlertsPage = lazy(() => import("./pages/AlertsPage").then((module) => ({ default: module.AlertsPage })));
const ReleasesPage = lazy(() => import("./pages/ReleasesPage").then((module) => ({ default: module.ReleasesPage })));
const SetupPage = lazy(() => import("./pages/SetupPage").then((module) => ({ default: module.SetupPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const ProjectSettingsPage = lazy(() => import("./pages/ProjectSettingsPage").then((module) => ({ default: module.ProjectSettingsPage })));

const appNav = [
  { path: "", label: "App", icon: Activity, end: true },
  { path: "/events", label: "Events", icon: TableProperties },
  { path: "/errors", label: "Errors", icon: Siren },
  { path: "/performance", label: "Performance", icon: Gauge },
  { path: "/network", label: "Network", icon: Network },
  { path: "/releases", label: "Releases", icon: GitCompare },
  { path: "/alerts", label: "Alerts", icon: Bell },
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/analyze", label: "AI Analysis", icon: Bot }
];

export function App({ identity, onSignOut }: { identity: DashboardIdentity; onSignOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const appMatch = matchPath({ path: "/apps/:appId/*", end: false }, location.pathname);
  const currentAppId = appMatch?.params.appId;
  const appBase = currentAppId ? `/apps/${encodeURIComponent(currentAppId)}` : undefined;

  const {data, loading, error} = useAsync(api.overview, []);
  const apps = data?.apps ?? [];
  const appIds = apps.map((app) => app.appId);
  const selectedAppId = currentAppId ?? appIds[0];
  const canSelectApp = selectedAppId && appIds.includes(selectedAppId);

  return (
    <Tooltip.Provider>
      <div className="grid min-h-screen grid-cols-1 bg-ink text-slate-100 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-line bg-panel p-3 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-ink"><Activity size={20} /></div>
            <div>
              <p className="font-semibold">React Intelligence</p>
              <p className="text-xs text-muted">Runtime telemetry</p>
            </div>
          </div>
          <Separator.Root className="my-3 h-px bg-line lg:my-4" />
          <nav className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-1">
            <NavLink to="/" end className={navClassName}>
              <Home size={16} />
              Overview
            </NavLink>
            {identity.role === "owner" ? <NavLink to="/setup" className={navClassName}>
              <Plug size={16} />
              Connect app
            </NavLink> : null}
            {identity.role === "owner" ? <NavLink to="/admin" className={navClassName}>
              <Shield size={16} />
              Access & ops
            </NavLink> : null}
            {appBase ? appNav.filter((item) => identity.role !== "viewer" || !["/settings", "/analyze"].includes(item.path)).map((item) => {
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
          <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line px-4 py-2 lg:px-6">
            <div className="flex items-center gap-3">
              <Search size={18} className="text-muted" />

              {loading ? (
                  <span className="text-sm text-muted">Loading...</span>
              ) : error ? (
                  <span className="text-sm text-bad">Apps failed to load</span>
              ) : canSelectApp ? (
                  <SelectBox
                      value={selectedAppId}
                      items={appIds}
                      onValueChange={(nextAppId) => {
                        navigate(buildAppPath(location.pathname, nextAppId));
                      }}
                  />
              ) : (
                  <span className="text-sm text-muted">No telemetry apps yet</span>
              )}
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="rounded-md border border-line p-2 hover:bg-line" aria-label="Menu"><Menu size={18} /></DropdownMenu.Trigger>
              <DropdownMenu.Content className="z-50 rounded-md border border-line bg-panel p-1 shadow-xl">
                <DropdownMenu.Label className="px-3 py-2 text-xs text-muted">{identity.actor} · {identity.role}</DropdownMenu.Label>
                <DropdownMenu.Item onSelect={onSignOut} className="cursor-pointer rounded px-3 py-2 text-sm outline-none hover:bg-line">Sign out</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </header>
          <div className="p-4 lg:p-6">
            <DashboardErrorBoundary><Suspense fallback={<Loading />}><Routes>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/setup" element={identity.role === "owner" ? <SetupPage /> : <Navigate to="/" replace />} />
              <Route path="/admin" element={identity.role === "owner" ? <AdminPage /> : <Navigate to="/" replace />} />
              <Route path="/apps/:appId" element={<AppPage>{(appId) => <AppOverviewPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/events" element={<AppPage>{(appId) => <EventsPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/errors" element={<AppPage>{(appId) => <ErrorsPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/performance" element={<AppPage>{(appId) => <PerformancePage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/network" element={<AppPage>{(appId) => <NetworkPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/releases" element={<AppPage>{(appId) => <ReleasesPage appId={appId} />}</AppPage>} />
              <Route path="/apps/:appId/alerts" element={<AppPage>{(appId) => <AlertsPage appId={appId} canManage={identity.role !== "viewer"} />}</AppPage>} />
              <Route path="/apps/:appId/settings" element={identity.role !== "viewer" ? <AppPage>{(appId) => <ProjectSettingsPage appId={appId} />}</AppPage> : <Navigate to="/" replace />} />
              <Route path="/apps/:appId/analyze" element={identity.role !== "viewer" ? <AppPage>{(appId) => <AnalyzePage appId={appId} />}</AppPage> : <Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes></Suspense></DashboardErrorBoundary>
          </div>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

function navClassName({ isActive }: { isActive: boolean }) {
  return `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-line text-white" : "text-muted hover:bg-line/60 hover:text-white"}`;
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
