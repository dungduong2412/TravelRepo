import { createElement } from 'react';
import {
  Armchair, BedDouble, Briefcase, Building2, Car, GraduationCap, HardHat, Handshake, MapPinned, Music, Palette, Scissors, Shirt,
  ShoppingBag, Sparkles, Sprout, Store, Truck, Tv, Utensils, UserRound, Wand2, type LucideIcon,
} from 'lucide-react';

/**
 * Category icons arrive from the API as Font Awesome slugs ("shirt", "map-location-dot") or not at all (core categories have none).
 * They are mapped to Lucide components so nothing ever renders a raw "fa-regular fa-…" string.
 */
const BY_SLUG: Record<string, LucideIcon> = {
  shirt: Shirt, 'map-location-dot': MapPinned, tv: Tv, store: Store, 'user-nurse': UserRound, 'graduation-cap': GraduationCap,
  palette: Palette, spa: Sprout, 'magic-wand-sparkles': Wand2, building: Building2, 'hard-hat': HardHat, car: Car, handshake: Handshake, chair: Armchair,
};
const BY_NAME: Record<string, LucideIcon> = {
  restaurant: Utensils, hotel: BedDouble, tour: MapPinned, transport: Truck, entertainment: Music, spa: Sprout, other: Briefcase, karaoke: Music,
};

export function categoryIcon(category: { name: string; icon: string | null }): LucideIcon {
  return (category.icon && BY_SLUG[category.icon]) || BY_NAME[category.name.toLowerCase()] || (category.name.includes('Làm đẹp') ? Scissors : ShoppingBag) || Sparkles;
}

export function CategoryIcon({ category, className = 'size-6' }: { category: { name: string; icon: string | null }; className?: string }) {
  return createElement(categoryIcon(category), { 'aria-hidden': true, className, strokeWidth: 1.75 });
}
