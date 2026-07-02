import { defineConfig } from "vite";
import { gadget } from "gadget-server/vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [gadget(), react()],
});