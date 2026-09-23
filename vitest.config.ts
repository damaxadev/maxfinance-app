import { defineConfig } from 'vitest/config';

// Aísla los archivos de test en procesos separados (fork) en vez de threads
// compartidos. El test runner de Angular (esbuild + vitest) para este
// proyecto muestra fallas intermitentes muy poco frecuentes con la config
// por defecto (p. ej. "No provider found") al correr muchos specs juntos —
// esto reduce bastante la frecuencia sin sacrificar tanta velocidad como
// desactivar el paralelismo por completo.
export default defineConfig({
  test: {
    pool: 'forks',
    isolate: true,
  },
});
