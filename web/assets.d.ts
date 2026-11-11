// Vite turns imported static assets into URLs.
declare module "*.svg" { const url: string; export default url; }
declare module "*.png" { const url: string; export default url; }
