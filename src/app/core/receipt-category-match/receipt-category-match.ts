import type { CategoryWithId } from '../categories/categories';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// suggestedCategory de /receipt (texto libre en español, ver RECEIPT_
// SYSTEM_PROMPT) contra las categorías reales del usuario — pura y
// determinística a propósito (ver DATABASE.md, "Lectura automática de
// recibos"): MovementForm solo autoselecciona categoryId cuando esto
// devuelve un id, nunca "lo más parecido" si no hay confianza real.
//
// Match exacto (ignorando mayúsculas/tildes) gana siempre. Si no, substring
// en cualquier dirección — pero solo cuenta si el término más corto tiene
// al menos 4 caracteres (evita falsos positivos de 2-3 letras sueltas) Y
// hay EXACTAMENTE una categoría candidata: dos o más matches posibles es
// justo el caso "sin confianza", no "el primero que aparezca".
export function matchCategory(suggestedName: string | null, categories: CategoryWithId[]): string | null {
  if (!suggestedName) {
    return null;
  }
  const normalizedSuggestion = normalize(suggestedName);
  if (!normalizedSuggestion) {
    return null;
  }

  const exactMatch = categories.find((category) => normalize(category.name) === normalizedSuggestion);
  if (exactMatch) {
    return exactMatch.id;
  }

  const substringMatches = categories.filter((category) => {
    const normalizedName = normalize(category.name);
    const [shorter, longer] =
      normalizedName.length <= normalizedSuggestion.length
        ? [normalizedName, normalizedSuggestion]
        : [normalizedSuggestion, normalizedName];
    return shorter.length >= 4 && longer.includes(shorter);
  });

  return substringMatches.length === 1 ? substringMatches[0].id : null;
}
