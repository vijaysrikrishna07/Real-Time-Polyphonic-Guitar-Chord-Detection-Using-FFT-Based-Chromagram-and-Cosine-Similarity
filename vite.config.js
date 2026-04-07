import { defineConfig } from 'vite';
import fs from 'fs';

// Plugin: silently ignore missing .map files (mediapipe ships without them)
function ignoreMediapipeSourcemaps() {
  return {
    name: 'ignore-missing-sourcemaps',
    configureServer(server) {
      const originalReadFile = server.config.isProduction
        ? null
        : fs.promises.readFile.bind(fs.promises);

      if (!originalReadFile) return;

      fs.promises.readFile = async (path, ...args) => {
        if (typeof path === 'string' && path.endsWith('.map')) {
          try {
            return await originalReadFile(path, ...args);
          } catch (e) {
            if (e.code === 'ENOENT') {
              return '{}'; // return empty sourcemap to suppress crash
            }
            throw e;
          }
        }
        return originalReadFile(path, ...args);
      };
    },
  };
}

export default defineConfig({
  plugins: [ignoreMediapipeSourcemaps()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
});
