"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Globe,
  User,
  Heart,
  Star,
  MapPin,
  Tag,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { publicApiFetch } from "@/lib/api";

// Category interface from backend
interface Category {
  id: string;
  category_name: string;
  category_name_vi: string;
  category_description: string | null;
  category_icon: string | null;
  is_active: boolean;
  display_order: number;
}

// Mock merchant data with discount labels and commission
const listings = [
  {
    id: 1,
    title: "Luxury Hotel Saigon",
    image:
      "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
    rating: 4.8,
    location: "District 1, HCM",
    discountLabel: "25% OFF",
    commission: "150k",
    category: "Hotels",
  },
  {
    id: 2,
    title: "Fine Dining at La Table",
    image:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=600&q=80",
    rating: 4.9,
    location: "District 3, HCM",
    discountLabel: "Save 250k",
    commission: "100k",
    category: "Fine Dining",
  },
  {
    id: 3,
    title: "Morning Coffee House",
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=600&q=80",
    rating: 4.7,
    location: "District 5, HCM",
    discountLabel: "20% OFF",
    commission: "10k",
    category: "Coffee",
  },
  {
    id: 4,
    title: "City Spa & Wellness",
    image:
      "https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?auto=format&fit=crop&w=600&q=80",
    rating: 4.6,
    location: "District 2, HCM",
    discountLabel: "30% OFF",
    commission: "50k",
    category: "Spas",
  },
  {
    id: 5,
    title: "Saigon City Tour",
    image:
      "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=600&q=80",
    rating: 4.8,
    location: "District 1, HCM",
    discountLabel: "Save 150k",
    commission: "120k",
    category: "Tours",
  },
  {
    id: 6,
    title: "Live Jazz Night",
    image:
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=600&q=80",
    rating: 4.5,
    location: "District 7, HCM",
    discountLabel: "15% OFF",
    commission: "40k",
    category: "Events",
  },
  {
    id: 7,
    title: "Beachfront Resort Vung Tau",
    image:
      "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=600&q=80",
    rating: 4.9,
    location: "Vung Tau",
    discountLabel: "35% OFF",
    commission: "200k",
    category: "Hotels",
  },
  {
    id: 8,
    title: "Rooftop Restaurant & Bar",
    image:
      "https://images.unsplash.com/photo-1551632436-cbf8dd35adfa?auto=format&fit=crop&w=600&q=80",
    rating: 4.7,
    location: "District 1, HCM",
    discountLabel: "Save 300k",
    commission: "90k",
    category: "Fine Dining",
  },
];

// Listing card component - Airbnb-inspired clean design
function ListingCard({
  listing,
  isCollaborator = false,
}: {
  listing: typeof listings[0];
  isCollaborator?: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(false);
  
  return (
    <div className="group cursor-pointer">
      {/* Image container with discount badge */}
      <div className="relative overflow-hidden rounded-xl mb-3">
        <img
          src={listing.image}
          alt={listing.title}
          className="w-full h-64 object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setIsFavorite(!isFavorite);
          }}
          className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-full p-2 hover:scale-110 shadow-md transition-all duration-200"
        >
          <Heart 
            className={`w-5 h-5 transition-colors ${
              isFavorite ? 'fill-red-500 text-red-500' : 'text-gray-700'
            }`} 
          />
        </button>
        
        {/* Discount badge - prominent and eye-catching */}
        <div className="absolute top-3 left-3">
          <span className="inline-flex items-center bg-gradient-to-r from-red-500 to-pink-500 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg">
            {listing.discountLabel}
          </span>
        </div>
      </div>
      
      {/* Card content */}
      <div className="px-1">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-semibold text-gray-900 text-base line-clamp-1 flex-1 group-hover:text-[#FF385C] transition-colors">
            {listing.title}
          </h3>
          <div className="flex items-center gap-1 ml-2">
            <Star className="w-4 h-4 text-[#FF385C] fill-[#FF385C]" />
            <span className="text-sm font-semibold text-gray-900">{listing.rating}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1 text-gray-600 text-sm mb-2">
          <MapPin className="w-3.5 h-3.5" />
          <span className="line-clamp-1">{listing.location}</span>
        </div>
        
        {/* Commission badge - ONLY for collaborators */}
        {isCollaborator && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg px-2.5 py-1.5">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-700">
                  Commission
                </span>
              </div>
              <span className="text-sm font-bold text-emerald-700">
                {listing.commission}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  
  // State management
  const [categories, setCategories] = useState<Category[]>([]);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Fetch categories from backend API
  useEffect(() => {
    async function fetchCategories() {
      try {
        const data = await publicApiFetch('/categories');
        // Filter only active categories and sort by display_order
        const activeCategories = data
          .filter((cat: Category) => cat.is_active)
          .sort((a: Category, b: Category) => a.display_order - b.display_order);
        setCategories(activeCategories);
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchCategories();
  }, []);

  const filteredListings = activeCategory
    ? listings.filter((l) => l.category === activeCategory)
    : listings;
    
  const handleLoginClick = () => {
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Top Navigation Bar - Airbnb style */}
      <header className="sticky top-0 z-50 bg-white shadow-sm">
        {/* Main Navigation */}
        <div className="border-b border-gray-200">
          <div className="max-w-[1760px] mx-auto px-6 lg:px-10">
            <div className="flex items-center justify-between h-20">
              {/* Logo */}
              <div className="flex-shrink-0 cursor-pointer" onClick={() => router.push('/')}>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-[#FF385C] to-[#E61E4D] bg-clip-text text-transparent">
                  VN01
                </h1>
              </div>
              
              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-8">
                <button className="text-sm font-semibold text-gray-800 hover:text-gray-600 transition">
                  Stays
                </button>
                <button className="text-sm font-semibold text-gray-800 hover:text-gray-600 transition">
                  Experiences
                </button>
                <button className="text-sm font-semibold text-gray-800 hover:text-gray-600 transition">
                  Online Experiences
                </button>
              </nav>
              
              {/* Right side actions */}
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => router.push('/merchant/onboard')}
                  className="hidden lg:block text-sm font-semibold text-gray-800 hover:bg-gray-50 px-3 py-2 rounded-full transition"
                >
                  Become a Merchant
                </button>
                
                <button className="p-3 hover:bg-gray-100 rounded-full transition">
                  <Globe className="w-[18px] h-[18px] text-gray-700" />
                </button>
                
                {/* Menu button */}
                <div className="flex items-center gap-2 border border-gray-300 rounded-full pl-3 pr-2 py-2 hover:shadow-md transition cursor-pointer">
                  <Menu className="w-4 h-4 text-gray-700" />
                  {!isLoggedIn ? (
                    <button onClick={handleLoginClick} className="p-2 bg-gray-700 rounded-full">
                      <User className="w-4 h-4 text-white" />
                    </button>
                  ) : (
                    <button className="p-2 bg-gray-700 rounded-full">
                      <User className="w-4 h-4 text-white" />
                    </button>
                  )}
                </div>
                
                {/* Demo toggle - visible only for testing */}
                <button
                  onClick={() => setIsCollaborator(!isCollaborator)}
                  className="hidden lg:flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-xs font-semibold hover:from-blue-100 hover:to-indigo-100 transition shadow-sm"
                  title="Toggle between Guest and Collaborator view"
                >
                  {isCollaborator ? "👤 Collaborator" : "👥 Guest"}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        {/* Search Bar Section */}
        <div className="border-b border-gray-100 bg-white">
          <div className="max-w-[1760px] mx-auto px-6 lg:px-10 py-4">
            <div className="flex items-center justify-center">
              <div className="w-full max-w-3xl bg-white border border-gray-300 rounded-full shadow-md hover:shadow-lg transition-shadow">
                <div className="flex items-center">
                  <div className="flex-1 px-5 py-3">
                    <input
                      type="text"
                      placeholder="Search destinations..."
                      className="w-full bg-transparent outline-none text-sm text-gray-700 placeholder-gray-400"
                    />
                  </div>
                  <button className="m-2 p-3 bg-gradient-to-r from-[#FF385C] to-[#E61E4D] hover:from-[#E61E4D] hover:to-[#D01048] rounded-full transition-all duration-200">
                    <Search className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Categories Filter Bar */}
        <div className="border-b border-gray-100 bg-white">
          <div className="max-w-[1760px] mx-auto px-6 lg:px-10">
            {loading ? (
              <div className="flex gap-6 py-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-16 w-20 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="flex gap-8 overflow-x-auto py-4 scrollbar-hide">
                <button
                  onClick={() => setActiveCategory(null)}
                  className={`flex flex-col items-center gap-2 pb-2 border-b-2 transition-all min-w-[60px] ${
                    activeCategory === null
                      ? "border-gray-900"
                      : "border-transparent hover:border-gray-300"
                  }`}
                >
                  <div className={`text-2xl ${activeCategory === null ? '' : 'opacity-60 hover:opacity-100'}`}>
                    🏠
                  </div>
                  <span className={`text-xs font-semibold whitespace-nowrap ${
                    activeCategory === null ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
                  }`}>
                    All
                  </span>
                </button>
                {categories.map((cat) => {
                  const isActive = activeCategory === cat.category_name;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(isActive ? null : cat.category_name)}
                      className={`flex flex-col items-center gap-2 pb-2 border-b-2 transition-all min-w-[60px] ${
                        isActive
                          ? "border-gray-900"
                          : "border-transparent hover:border-gray-300"
                      }`}
                    >
                      <div className={`text-2xl ${isActive ? '' : 'opacity-60 hover:opacity-100'}`}>
                        {cat.category_icon || '✨'}
                      </div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${
                        isActive ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
                      }`}>
                        {cat.category_name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="max-w-[1760px] mx-auto px-6 lg:px-10 py-8">
        {/* Hero message for Collaborators */}
        {isCollaborator && (
          <div className="mb-8 bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border border-emerald-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">
                  👋 Welcome, Collaborator!
                </h2>
                <p className="text-sm text-gray-600">
                  You can now see commission rates on all listings. Share these amazing deals with your customers!
                </p>
              </div>
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition flex items-center gap-2">
                View Dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* Active filter indicator */}
        {activeCategory && (
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">
                {activeCategory}
              </h2>
              <span className="text-sm text-gray-500">
                ({filteredListings.length} {filteredListings.length === 1 ? 'listing' : 'listings'})
              </span>
            </div>
            <button 
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 underline underline-offset-4 transition"
            >
              Clear filter
            </button>
          </div>
        )}
        
        {/* Section header */}
        {!activeCategory && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Explore Vietnam's Best Deals
            </h2>
            <p className="text-gray-600">
              Discover unique places to stay, eat, and experience with exclusive discounts
            </p>
          </div>
        )}
        
        {/* Listings Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
                <div className="space-y-2">
                  <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-2/3 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredListings.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-10">
            {filteredListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isCollaborator={isCollaborator}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-4">
              <Search className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No listings found</h3>
            <p className="text-gray-500 mb-6">
              {activeCategory 
                ? `No listings available in ${activeCategory}. Try selecting a different category.`
                : "Check back later for new listings"}
            </p>
            {activeCategory && (
              <button 
                onClick={() => setActiveCategory(null)}
                className="px-6 py-3 bg-[#FF385C] hover:bg-[#E61E4D] text-white rounded-lg font-semibold transition shadow-md hover:shadow-lg"
              >
                View All Listings
              </button>
            )}
          </div>
        )}
      </main>
      
      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 mt-16">
        <div className="max-w-[1760px] mx-auto px-6 lg:px-10 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="font-bold text-gray-900 mb-4">About</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">How VN01 works</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Newsroom</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Careers</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-4">Community</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Support</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Safety information</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Cancellation options</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-4">Merchants</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">List your business</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Resources</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Community forum</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-bold text-gray-900 mb-4">VN01</h3>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Terms</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Privacy</a></li>
                <li><a href="#" className="text-sm text-gray-600 hover:text-gray-900 hover:underline">Sitemap</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-200 mt-8 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-600">© 2026 VN01, Inc. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <button className="p-2 hover:bg-gray-200 rounded-full transition">
                <Globe className="w-5 h-5 text-gray-600" />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
