import { matchCategory } from './receipt-category-match';
import type { CategoryWithId } from '../categories/categories';

const CATEGORIES: CategoryWithId[] = [
  { id: 'c1', uid: null, name: 'Supermercado', icon: '🛒', type: 'expense' },
  { id: 'c2', uid: null, name: 'Restaurante', icon: '🍔', type: 'expense' },
  { id: 'c3', uid: 'u1', name: 'Mercado y hogar', icon: '🏠', type: 'expense' },
  { id: 'c4', uid: null, name: 'Transporte', icon: '🚗', type: 'expense' },
];

describe('matchCategory', () => {
  it('returns null when the suggestion is null', () => {
    expect(matchCategory(null, CATEGORIES)).toBeNull();
  });

  it('returns null for an empty/blank suggestion', () => {
    expect(matchCategory('   ', CATEGORIES)).toBeNull();
  });

  it('matches exactly, case-insensitively and ignoring accents', () => {
    expect(matchCategory('supermercado', CATEGORIES)).toBe('c1');
    expect(matchCategory('RESTAURANTE', CATEGORIES)).toBe('c2');
  });

  it('matches via accent-insensitive normalization (e.g. a suggestion with a stray accent)', () => {
    const categories: CategoryWithId[] = [{ id: 'c5', uid: null, name: 'Farmacia', icon: '💊', type: 'expense' }];
    expect(matchCategory('Farmácia', categories)).toBe('c5');
  });

  it('matches a substring when exactly one category contains/is-contained-by the suggestion', () => {
    // "Hogar" es substring de "Mercado y hogar" — único candidato en esta lista.
    expect(matchCategory('Hogar', CATEGORIES)).toBe('c3');
  });

  it('matches when the suggestion is longer and contains a shorter category name', () => {
    const categories: CategoryWithId[] = [{ id: 'c6', uid: null, name: 'Ropa', icon: '👕', type: 'expense' }];
    expect(matchCategory('Tienda de Ropa', categories)).toBe('c6');
  });

  it('returns null when nothing matches at all', () => {
    expect(matchCategory('Entretenimiento', CATEGORIES)).toBeNull();
  });

  it('returns null (ambiguous) when more than one category could match by substring', () => {
    const categories: CategoryWithId[] = [
      { id: 'c7', uid: null, name: 'Mercado central', icon: '🛒', type: 'expense' },
      { id: 'c8', uid: null, name: 'Mercado gourmet', icon: '🛒', type: 'expense' },
    ];
    expect(matchCategory('Mercado', categories)).toBeNull();
  });

  it('does not match on a trivially short common substring (shorter term under 4 chars)', () => {
    // "car" (3 letras) SÍ es substring literal de "carro" — pero por ser
    // tan corto, no cuenta como match confiable.
    const categories: CategoryWithId[] = [{ id: 'c9', uid: null, name: 'Carro', icon: '🚗', type: 'expense' }];
    expect(matchCategory('Car', categories)).toBeNull();
  });

  it('returns null when there are no categories at all', () => {
    expect(matchCategory('Supermercado', [])).toBeNull();
  });
});
