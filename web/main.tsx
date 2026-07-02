import React from "react";
import ReactDOM from "react-dom/client";
import { GlobalStyles } from '@bigcommerce/big-design';
import { theme as defaultTheme } from '@bigcommerce/big-design-theme';
import { createGlobalStyle, ThemeProvider } from 'styled-components';
import App from "./components/App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found for booting react app");

const AppGlobalStyles = createGlobalStyle`
  body {
    height: 100%;
    background-color: ${({ theme }) => theme.colors.secondary10}
  }
`

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider theme={defaultTheme}>
      <>
        <AppGlobalStyles />
        <GlobalStyles />
        <App />
      </>
    </ThemeProvider>
  </React.StrictMode>
);
