import { useEffect } from "react";
import { Box, H1, Link, Panel, ProgressCircle, Text } from "@bigcommerce/big-design"
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
import { IndexPage } from "../routes/index";

function App() {
  const router = createBrowserRouter(
    createRoutesFromElements(
      <Route path="/" element={<Layout />}>
        <Route index element={<IndexPage />} />
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
      {isAuthenticated ? <Outlet /> : <UnauthenticatedApp />}
    </Box>)
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
