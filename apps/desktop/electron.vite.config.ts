import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      // O cliente ACP (contrato 17) vai embutido no main: o pacote só leva o `zod` em `node_modules`. O
      // adaptador não é importado (roda como processo, de `Resources/acp`).
      // As bibliotecas de email (contrato 42) também vão embutidas: são JS puro e o pack.sh não as copia. O
      // `ical.js` dos convites (contrato 59) idem.
      externalizeDeps: { exclude: ['@agentclientprotocol/sdk', 'imapflow', 'nodemailer', 'mailparser', 'ical.js'] },
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      // Com sandbox: true o preload precisa ser um único arquivo CommonJS, sem require de módulo próprio.
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      // Nada embutido como data: URL; a CSP só aceita fonte e imagem da própria origem.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
