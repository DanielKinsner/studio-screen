import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { version } from './package.json';
// The app shows the package version, so the build can never drift from it.
export default defineConfig({ base: './', define: { __APP_VERSION__: JSON.stringify(version) }, plugins: [react()], server: { host: '127.0.0.1' } });
