import { Box, Button, Flex, Link, Message, Panel, ProgressCircle, Tabs, Text } from "@bigcommerce/big-design"
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
import { freshdeskHost } from "../../api/lib/integrations";

// The admin's nine tabs. Settings tabs share one draft with a single Save.
const TABS = [
  { id: "general", path: "/", title: "General", settings: true },
  { id: "context", path: "/context", title: "Context", settings: true },
  { id: "integrations", path: "/integrations", title: "Integrations", settings: true },
  { id: "features", path: "/features", title: "Features", settings: true },
  { id: "crm", path: "/crm", title: "CRM" },
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
        <Route path="crm" element={<ComingSoonPage tab="crm" />} />
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

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100%",
          width: "100%",
        }}
      >
        <ProgressCircle />
      </div>
    )
  }

  return (
    <Box
      marginHorizontal={{ mobile: 'none', tablet: 'xxxLarge' }}
      marginVertical={{ mobile: 'none', tablet: "xxLarge" }}
    >
      {isAuthenticated ? (
        <SettingsProvider>
          <AdminHeader />
          <NavTabs />
          <Outlet />
        </SettingsProvider>
      ) : <UnauthenticatedApp />}
    </Box>)
}

function activeTab(pathname: string) {
  return TABS.find((t) => t.path !== "/" && pathname.startsWith(t.path)) ?? TABS[0];
}

// Store name, the per-store note, and Discard / Save for the settings tabs.
function AdminHeader() {
  const location = useLocation();
  const { store, dirty, save, discard, saving, saveError, savedAt } = useSettings();
  const onSettingsTab = !!activeTab(location.pathname).settings;
  return (
    <Box marginBottom="medium">
      <Flex justifyContent="space-between" alignItems="center" flexWrap="wrap" flexGap="12px">
        <Box>
          <Text bold marginBottom="none">AI Support · {store?.storeHash ? `store-${store.storeHash}` : "…"}</Text>
          <Text color="secondary60" marginBottom="none">Multi-store app · every setting below is per store</Text>
        </Box>
        {onSettingsTab && (
          <Flex flexGap="8px" alignItems="center">
            {dirty && <Text color="secondary60" marginBottom="none">Unsaved changes</Text>}
            <Button variant="subtle" onClick={discard} disabled={!dirty || saving}>Discard</Button>
            {/* variant must be explicit: big-design's defaultProps are ignored under React 19 */}
            <Button variant="primary" onClick={save} isLoading={saving} disabled={!dirty}>Save settings</Button>
          </Flex>
        )}
      </Flex>
      {onSettingsTab && saveError && <Message type="error" messages={[{ text: saveError }]} marginTop="small" />}
      {onSettingsTab && !dirty && savedAt && Date.now() - savedAt < 15000 && (
        <Message type="success" messages={[{ text: "Settings saved." }]} marginTop="small" />
      )}
    </Box>
  );
}

function NavTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const { store } = useSettings();
  // The CRM tab takes the name of the connected CRM.
  const crmTitle = freshdeskHost(store?.freshdeskDomain) && store?.freshdeskApiKey ? "Freshdesk" : "CRM";
  return (
    <Tabs
      activeTab={activeTab(location.pathname).id}
      items={TABS.map((t) => ({ id: t.id, title: t.id === "crm" ? crmTitle : t.title }))}
      onTabClick={(id) => navigate(TABS.find((t) => t.id === id)?.path ?? "/")}
    />
  );
}

function UnauthenticatedApp() {
  return (
    <Panel description="App must be viewed in the BigCommerce control panel">
      <Text>Edit this page: <Link target="_blank" href={`/edit/${process.env.GADGET_PUBLIC_APP_ENV}/files/web/components/App.tsx`}>web/components/App.tsx</Link></Text>
    </Panel>
  )
}

function Error404() {
  return <div>404 not found</div>;
}

export default App;
