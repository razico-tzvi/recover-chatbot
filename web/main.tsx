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
  /* big-design caps form-field width (~432px) for readability; let the
     long text fields use the full panel width instead. The class wraps the
     whole FormGroup so the override reaches the width cap. */
  .wide-field,
  .wide-field * {
    max-width: 100% !important;
  }
  .wide-field textarea {
    width: 100% !important;
  }
  /* big-design caps Textarea rows at 7; context-block editors need more room. */
  .tall-field textarea {
    min-height: 360px;
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
