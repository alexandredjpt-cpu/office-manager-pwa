/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// base './' → funciona em Cloudflare Pages (raiz) e GitHub Pages (subpasta).
export default defineConfig({
  base: './',
  define: { __VERSAO__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Office Manager (pessoal)',
        short_name: 'Office Mgr',
        description: 'Gestão pessoal de equipamentos, stock e anomalias. Offline, sem servidor.',
        lang: 'pt-PT',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#0f766e',
        // Atalhos ao manter o dedo no ícone da app (Android).
        // Partilhar fotografias de outra app (Galeria, Câmara…) para a app: abre uma anomalia nova.
        share_target: {
          action: './partilhar',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'titulo', text: 'texto', files: [{ name: 'fotos', accept: ['image/*'] }] }
        },
        shortcuts: [
          { name: 'Nova anomalia', short_name: 'Anomalia', url: './#/anomalias/nova' },
          { name: 'Plantas', short_name: 'Plantas', url: './#/plantas' },
          { name: 'Pesquisar / ler código', short_name: 'Pesquisar', url: './#/pesquisa' }
        ],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Dependências opcionais do jsPDF (HTML/SVG para PDF) que a app não usa: fora da cache offline (~380 KB).
        globIgnores: ['**/html2canvas*.js', '**/purify.es*.js', '**/index.es-*.js'],
        navigateFallback: 'index.html',
        // Recebe as fotografias partilhadas (POST /partilhar) antes das rotas do Workbox.
        importScripts: ['sw-partilha.js']
      }
    })
  ],
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts']
  }
});
