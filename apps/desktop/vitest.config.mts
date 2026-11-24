import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') },
  },
  test: {
    // Contrato 157: os testes de componente do renderer (`.test.tsx`) renderizam com `react-dom/server`, sem DOM.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    // Testes de tempo (busca de 300 h, troca de sessão da tradução, parser do chat) falhavam com um
    // processo por arquivo disputando a CPU; 4 de cada vez deixa a suíte estável numa máquina carregada.
    maxWorkers: 4,
  },
})
