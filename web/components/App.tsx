import { Provider as GadgetProvider, useGadget } from "@gadgetinc/react-bigcommerce";
import {
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
  useNavigate,
} from "react-router";
import { api } from "../api";
import { SettingsProvider, useSettings } from "../lib/settings";
import { GeneralPage } from "../routes/general";
import { ContextPage } from "../routes/context";
import { IntegrationsPage } from "../routes/integrations";
import { FeaturesPage } from "../routes/features";
import { ConversationsPage } from "../routes/conversations";
import { ComingSoonPage } from "../routes/comingSoon";
import { CrmPage } from "../routes/crm";
import { freshdeskHost } from "../../api/lib/integrations";
import { Alert, Btn } from "./ui";

// The admin's nine tabs. Settings tabs share one draft with a single Save.
const TABS = [
  { id: "general", path: "/", title: "General", settings: true },
  { id: "context", path: "/context", title: "Context", settings: true },
  { id: "integrations", path: "/integrations", title: "Integrations", settings: true },
  { id: "features", path: "/features", title: "Features", settings: true },
  { id: "crm", path: "/crm", title: "CRM", settings: true },
  { id: "analytics", path: "/analytics", title: "Analytics" },
  { id: "conversations", path: "/conversations", title: "Conversations" },
  { id: "learning", path: "/learning", title: "Learning" },
  { id: "api", path: "/api", title: "API" },
];

function App() {
  const router = createBrowserRouter(
    createRoutesFromElements(
      <Route path="/" element={<Layout />}>
        <Route index element={<GeneralPage />} />
        <Route path="context" element={<ContextPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="features" element={<FeaturesPage />} />
        <Route path="crm" element={<CrmPage />} />
        <Route path="analytics" element={<ComingSoonPage tab="analytics" />} />
        <Route path="conversations" element={<ConversationsPage />} />
        <Route path="learning" element={<ComingSoonPage tab="learning" />} />
        <Route path="api" element={<ComingSoonPage tab="api" />} />
        <Route path="*" element={<Error404 />} />
      </Route>
    )
  );

  return <RouterProvider router={router} />
}

function Layout() {
  return (
    <GadgetProvider api={api}>
      <AuthenticatedApp />
    </GadgetProvider>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useGadget();

  return (
    <div className="admin">
      <div className="wrap">
        {loading ? (
          <div className="center">Loading…</div>
        ) : isAuthenticated ? (
          <SettingsProvider>
            <AdminHeader />
            <NavTabs />
            <Outlet />
          </SettingsProvider>
        ) : <UnauthenticatedApp />}
      </div>
    </div>
  );
}

function activeTab(pathname: string) {
  return TABS.find((t) => t.path !== "/" && pathname.startsWith(t.path)) ?? TABS[0];
}

// Store pill, the per-store note, and Discard / Save for the settings tabs.
function AdminHeader() {
  const location = useLocation();
  const { store, dirty, save, discard, saving, saveError, savedAt } = useSettings();
  const onSettingsTab = !!activeTab(location.pathname).settings;
  return (
    <>
      <div className="appbar">
        <div className="logo">AI</div>
        <h1>AI Support</h1>
        <span className="tenant"><span className="dot" />{store?.storeHash ? `store-${store.storeHash}` : "…"}</span>
        <span className="hint" style={{ marginTop: 0 }}>Multi-store app · every setting below is per store</span>
        <div className="spacer" />
        {onSettingsTab && (
          <>
            {dirty && <span className="hint" style={{ marginTop: 0 }}>Unsaved changes</span>}
            <Btn onClick={discard} disabled={!dirty || saving}>Discard</Btn>
            <Btn primary onClick={save} loading={saving} disabled={!dirty}>Save settings</Btn>
          </>
        )}
      </div>
      {onSettingsTab && saveError && <Alert tone="crit">{saveError}</Alert>}
      {onSettingsTab && !dirty && savedAt && Date.now() - savedAt < 15000 && <Alert tone="good">Settings saved.</Alert>}
    </>
  );
}

function NavTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const { store } = useSettings();
  const active = activeTab(location.pathname).id;
  // The CRM tab takes the name of the connected CRM.
  const crmTitle = freshdeskHost(store?.freshdeskDomain) && store?.freshdeskApiKey ? "Freshdesk" : "CRM";
  return (
    <nav className="tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? "on" : ""} onClick={() => navigate(t.path)}>
          {t.id === "crm" ? crmTitle : t.title}
        </button>
      ))}
    </nav>
  );
}

function UnauthenticatedApp() {
  return (
    <div className="card" style={{ marginTop: 24 }}>
      <h2>App must be viewed in the BigCommerce control panel</h2>
      <p className="hint">Edit this page: <a target="_blank" href={`/edit/${process.env.GADGET_PUBLIC_APP_ENV}/files/web/components/App.tsx`}>web/components/App.tsx</a></p>
    </div>
  );
}

function Error404() {
  return <div className="card">404 not found</div>;
}

export default App;
