import { defineConfig } from 'vite';

export default defineConfig({
  // Относительные пути к ассетам: сборка работает и на GitHub Pages (/deep-scoop/), и с любого другого адреса.
  base: './',
});
