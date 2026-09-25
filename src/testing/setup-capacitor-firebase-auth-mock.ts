import { vi } from 'vitest';

/**
 * Mockea @capacitor-firebase/authentication UNA sola vez, globalmente, para
 * toda la corrida de tests (registrado vía `setupFiles` en angular.json).
 *
 * Varios archivos de spec necesitan esto (cualquiera que transitivamente
 * importe core/auth/auth.ts). Declarar un `vi.mock(...)` local por archivo
 * causaba fallas intermitentes: el test runner de Angular (esbuild + vitest)
 * comparte el registro de módulos entre specs, y referenciar un mock
 * importado de OTRO archivo dentro de un factory de `vi.mock` choca con el
 * hoisting de vitest ("Cannot access '...' before initialization"). Con un
 * único mock global, cada spec solo necesita importar `FirebaseAuthentication`
 * normalmente y usar `vi.mocked(...)` para configurar/resetear en su propio
 * beforeEach.
 */
vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    getCurrentUser: vi.fn(),
    addListener: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  },
}));
