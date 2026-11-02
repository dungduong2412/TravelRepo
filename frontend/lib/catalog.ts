import { publicApiFetch } from './api';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100';

export type CatalogCategory = { id: string; name: string; name_vi: string; icon: string | null; count?: number };
export type CatalogOffer = { type: 'percentage' | 'amount'; value: number; label: string };
export type CatalogListing = {
  id: string; code: string; name: string; summary: string; city: string | null; address: string | null;
  categories: CatalogCategory[]; image_url: string | null; offer: CatalogOffer | null;
};
export type CatalogDetail = CatalogListing & { description: string; phone: string | null; gallery: { id: string; url: string }[] };
export type CatalogPage = { items: CatalogListing[]; total: number; page: number; page_size: number };

/** Image paths from the API are relative ("/public/media/<id>"); resolve them against the API origin. */
export const imageSrc = (path: string | null, size: 'thumb' | 'card' | 'hero' = 'card') => (path ? `${API_BASE_URL}${path}?size=${size}` : null);

export const fetchCategories = (): Promise<CatalogCategory[]> => publicApiFetch('/public/categories');
export const fetchListings = (params: { category?: string | null; q?: string | null; page?: number }): Promise<CatalogPage> => {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.q) qs.set('q', params.q);
  qs.set('page', String(params.page || 1));
  qs.set('page_size', '24');
  return publicApiFetch(`/public/merchants?${qs}`);
};

/** Typed so the UI can tell "not found" (a legitimate answer) from a technical failure. */
export class ApiStatusError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function fetchDetail(id: string): Promise<CatalogDetail> {
  const response = await fetch(`${API_BASE_URL}/public/merchants/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new ApiStatusError(response.status, `HTTP ${response.status}`);
  return response.json();
}

export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
