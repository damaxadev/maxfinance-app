import type { SharedMovement } from '../../models/movement.model';

/**
 * "🍔 Comida" / "🗂️ Sin categoría" / "❓ Categoría eliminada" / la nota
 * como último recurso — ver DATABASE.md, "Categoría denormalizada en
 * gastos compartidos". `categoryId === null` es SIEMPRE "sin categoría"
 * (el usuario no eligió ninguna) — nunca "eliminada", que es solo para un
 * `categoryId` que apuntaba a algo que ya no existe.
 *
 * No incluye el fallback a un join en vivo contra `categories` que sí
 * tiene GroupActivity.categoryLabel() (necesario ahí para categorías
 * personalizadas de gastos de antes de la denormalización) — los
 * consumidores de este helper (AbonoForm, GroupBalance) solo necesitan
 * resolver la etiqueta de un gasto ya denormalizado.
 */
export function sharedMovementLabel(movement: Pick<SharedMovement, 'categoryId' | 'categoryName' | 'categoryIcon' | 'note'>): string {
  if (movement.categoryId === null) {
    return '🗂️ Sin categoría';
  }
  if (movement.categoryName !== undefined) {
    return `${movement.categoryIcon ?? '❓'} ${movement.categoryName ?? 'Categoría eliminada'}`;
  }
  return movement.note || '🗂️ Gasto';
}
