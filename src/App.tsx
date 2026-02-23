import React, { useState, useEffect } from 'react';
import { Search, MapPin, Clock, Phone, Plus, X, Filter, Calendar, Info, Utensils, BookOpen, Map as MapIcon, List, Navigation, ExternalLink, Share2, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { db } from './firebase';
import { collection, addDoc, query, getDocs, where, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { supabase } from './supabase';

// Fix for default marker icons in Leaflet
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface Event {
  id: string | number;
  name: string;
  type: string;
  district: string;
  upazila: string;
  village: string;
  address: string;
  date_range: string;
  start_time: string;
  iftar_time: string;
  contact: string;
  description: string;
  image_url: string;
  lat?: number;
  lng?: number;
  link_url?: string;
  event_date?: string;
  event_day?: string;
  created_at?: string;
}

const DISTRICTS = ["ঢাকা", "চট্টগ্রাম", "রাজশাহী", "খুলনা", "বরিশাল", "সিলেট", "রংপুর", "ময়মনসিংহ", "বগুড়া", "কুমিল্লা"];
const EVENT_TYPES = [
  { id: "public_iftar", label: "গণ-ইফতার", icon: Utensils, color: "text-blue-600", bg: "bg-blue-50" },
  { id: "religious_gathering", label: "ওয়াজ/দ্বীনি মজলিস", icon: BookOpen, color: "text-emerald-600", bg: "bg-emerald-50" }
];

export default function App() {
  const [currentPage, setCurrentPage] = useState<'iftar' | 'about' | 'products' | 'services' | 'contact'>('iftar');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isSavingToDrive, setIsSavingToDrive] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const checkGoogleStatus = async () => {
      try {
        const res = await fetch('/api/auth/google/status');
        const data = await res.json();
        setIsGoogleConnected(data.connected);
      } catch (e) {
        console.error("Failed to check Google status", e);
      }
    };
    checkGoogleStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setIsGoogleConnected(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const connectGoogle = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (e) {
      console.error("Failed to get Google auth URL", e);
    }
  };

  const saveToDrive = async (event: Event) => {
    if (!isGoogleConnected) {
      alert("আগে গুগল ড্রাইভ কানেক্ট করুন।");
      return;
    }

    setIsSavingToDrive(event.id.toString());
    try {
      const res = await fetch('/api/drive/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventData: event })
      });
      
      if (res.ok) {
        alert("গুগল ড্রাইভে সফলভাবে সেভ হয়েছে!");
      } else {
        const error = await res.json();
        if (error.error === "Not connected to Google Drive") {
          setIsGoogleConnected(false);
          alert("গুগল ড্রাইভ কানেকশন বিচ্ছিন্ন হয়েছে। আবার কানেক্ট করুন।");
        } else {
          alert("সেভ করতে সমস্যা হয়েছে।");
        }
      }
    } catch (e) {
      console.error("Failed to save to Drive", e);
      alert("সার্ভার এরর। আবার চেষ্টা করুন।");
    } finally {
      setIsSavingToDrive(null);
    }
  };

  const deleteEvent = async (id: string | number) => {
    const password = window.prompt("ইভেন্ট ডিলিট করতে পাসওয়ার্ড দিন:");
    
    if (password !== "0179215718") {
      alert("ভুল পাসওয়ার্ড! ডিলিট করা সম্ভব নয়।");
      return;
    }

    if (!window.confirm("আপনি কি নিশ্চিত যে আপনি এই ইভেন্টটি ডিলিট করতে চান?")) return;

    try {
      // 1. Delete from Supabase
      const { error: supabaseError } = await supabase
        .from('events')
        .delete()
        .eq('id', id);
      
      if (supabaseError) throw supabaseError;

      // 2. Delete from Firebase
      if (typeof id === 'string') {
        try {
          const eventRef = doc(db, 'events', id);
          await deleteDoc(eventRef);
        } catch (firebaseError) {
          console.warn("Firebase delete failed", firebaseError);
        }
      }

      // 3. Delete from SQLite (Optional)
      await fetch('/api/events/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      fetchEvents();
    } catch (e) {
      console.error("Failed to delete event", e);
      alert("ডিলিট করতে সমস্যা হয়েছে।");
    }
  };

  const handleShare = async (event: Event) => {
    const shareData = {
      title: event.name,
      text: `${event.name}\nতারিখ: ${event.event_date || event.date_range}\nস্থান: ${event.address}, ${event.village}\nযোগাযোগ: ${event.contact}\n\nবিস্তারিত দেখুন ইফতার সন্ধানে অ্যাপে।`,
      url: window.location.href
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      // Fallback: Copy to clipboard
      const shareText = `${shareData.title}\n${shareData.text}\n${shareData.url}`;
      navigator.clipboard.writeText(shareText);
      setCopiedId(event.id.toString());
      setTimeout(() => setCopiedId(null), 2000);
    }
  };
  
  // Search filters
  const [filters, setFilters] = useState({
    district: "",
    upazila: "",
    village: "",
    type: ""
  });

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    type: "public_iftar",
    district: "",
    upazila: "",
    village: "",
    address: "",
    date_range: "",
    start_time: "",
    iftar_time: "",
    contact: "",
    description: "",
    image_url: "",
    lat: undefined as number | undefined,
    lng: undefined as number | undefined,
    link_url: "",
    event_date: "",
    event_day: ""
  });

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setFormData({
          ...formData,
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      }, (error) => {
        console.error("Error getting location", error);
        alert("লোকেশন পাওয়া যায়নি। অনুগ্রহ করে ম্যানুয়ালি দিন।");
      });
    }
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      // Primary: Fetch from Supabase
      let queryBuilder = supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.district) queryBuilder = queryBuilder.eq('district', filters.district);
      if (filters.type) queryBuilder = queryBuilder.eq('type', filters.type);
      if (filters.upazila) queryBuilder = queryBuilder.ilike('upazila', `%${filters.upazila}%`);
      if (filters.village) queryBuilder = queryBuilder.ilike('village', `%${filters.village}%`);

      const { data, error } = await queryBuilder;

      if (error) throw error;

      if (data) {
        setEvents(data as Event[]);
      }
    } catch (error) {
      console.error("Failed to fetch events from Supabase", error);
      // Fallback: Fetch from Firebase Firestore
      try {
        const eventsRef = collection(db, 'events');
        const q = query(eventsRef);
        const querySnapshot = await getDocs(q);
        const eventsData: Event[] = [];
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          let matches = true;
          if (filters.district && data.district !== filters.district) matches = false;
          if (filters.type && data.type !== filters.type) matches = false;
          if (filters.upazila && !data.upazila?.toLowerCase().includes(filters.upazila.toLowerCase())) matches = false;
          if (filters.village && !data.village?.toLowerCase().includes(filters.village.toLowerCase())) matches = false;
          
          if (matches) {
            eventsData.push({ id: doc.id, ...data } as Event);
          }
        });

        // Sort by created_at desc
        eventsData.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });

        setEvents(eventsData);
      } catch (firebaseError) {
        console.error("Firebase fallback failed", firebaseError);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [filters]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    const newEvent = {
      ...formData,
      created_at: new Date().toISOString()
    };

    try {
      // 1. Save to Supabase (Primary)
      const { error: supabaseError } = await supabase
        .from('events')
        .insert([newEvent]);
      
      if (supabaseError) throw supabaseError;

      // 2. Save to Firebase (Backup)
      try {
        await addDoc(collection(db, 'events'), newEvent);
      } catch (firebaseError) {
        console.warn("Firebase backup failed", firebaseError);
      }

      // 3. Save to Server (SQLite - Optional/Local Cache)
      try {
        await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEvent)
        });
      } catch (serverError) {
        console.warn("SQLite save failed", serverError);
      }
      
      // 3. Save to Google Drive if connected
      if (isGoogleConnected) {
        try {
          await fetch('/api/drive/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventData: formData })
          });
        } catch (driveError) {
          console.error("Failed to save to Google Drive", driveError);
        }
      }
      
      alert("সফলভাবে যুক্ত হয়েছে! ওকে ক্লিক করুন।");
      setShowAddForm(false);
      setCurrentPage('iftar'); // Go to home page
      fetchEvents(); // Refresh the list
      setFormData({
        name: "", type: "public_iftar", district: "", upazila: "", village: "",
        address: "", date_range: "", start_time: "", iftar_time: "",
        contact: "", description: "", image_url: "", lat: undefined, lng: undefined,
        link_url: "", event_date: "", event_day: ""
      });
    } catch (error) {
      console.error("Failed to add event:", error);
      alert("ইভেন্ট যুক্ত করতে সমস্যা হয়েছে: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Map Component to handle view changes
  function MapView({ events }: { events: Event[] }) {
    const map = useMap();
    useEffect(() => {
      if (events.length > 0 && events[0].lat && events[0].lng) {
        map.setView([events[0].lat, events[0].lng], 13);
      }
    }, [events, map]);

    return (
      <>
        {events.filter(e => e.lat && e.lng).map(event => (
          <Marker key={event.id} position={[event.lat!, event.lng!]}>
            <Popup>
              <div className="p-1">
                <h5 className="font-bold text-emerald-800">{event.name}</h5>
                <p className="text-xs text-slate-600 mb-2">{event.address}</p>
                <div className="flex gap-2">
                  <a 
                    href={`tel:${event.contact}`}
                    className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded-md"
                  >
                    কল দিন
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCF8] text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setCurrentPage('iftar')}>
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <Utensils size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-emerald-900">ইফতার সন্ধানে</h1>
              <p className="text-[10px] uppercase tracking-widest font-semibold text-emerald-600/70">Iftar Shondhane</p>
            </div>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            <button onClick={() => setCurrentPage('iftar')} className={`text-sm font-bold transition-colors ${currentPage === 'iftar' ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'}`}>হোম</button>
            <button onClick={() => setCurrentPage('about')} className={`text-sm font-bold transition-colors ${currentPage === 'about' ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'}`}>আমাদের সম্পর্কে</button>
            <button onClick={() => setCurrentPage('products')} className={`text-sm font-bold transition-colors ${currentPage === 'products' ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'}`}>প্রোডাক্টস</button>
            <button onClick={() => setCurrentPage('services')} className={`text-sm font-bold transition-colors ${currentPage === 'services' ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'}`}>সার্ভিস</button>
            <button onClick={() => setCurrentPage('contact')} className={`text-sm font-bold transition-colors ${currentPage === 'contact' ? 'text-emerald-600' : 'text-slate-500 hover:text-emerald-600'}`}>যোগাযোগ</button>
          </nav>

          <div className="flex items-center gap-2">
            {!isGoogleConnected ? (
              <button 
                onClick={connectGoogle}
                className="hidden sm:flex items-center gap-2 bg-white border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all"
              >
                <Share2 size={14} className="text-emerald-600" />
                কানেক্ট ড্রাইভ
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-2 rounded-xl text-xs font-bold border border-emerald-100">
                <Check size={14} />
                ড্রাইভ কানেক্টেড
              </div>
            )}
            
            <button 
              onClick={() => setShowAddForm(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-medium transition-all shadow-md active:scale-95"
            >
              <Plus size={18} />
              নতুন ইভেন্ট
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {currentPage === 'iftar' && (
          <motion.div
            key="iftar"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {/* Hero & Search */}
            <section className="bg-emerald-900 text-white py-12 px-4 relative overflow-hidden">
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-400 via-transparent to-transparent"></div>
              </div>
              
              <div className="max-w-4xl mx-auto relative z-10 text-center">
                <motion.h2 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-3xl md:text-4xl font-bold mb-4"
                >
                  আপনার এলাকায় ইফতার ও দ্বীনি মজলিসের খোঁজ নিন
                </motion.h2>
                <motion.p 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-emerald-100/80 mb-8 max-w-2xl mx-auto"
                >
                  রমজানে ইফতার মাহফিল বা ইফতারি বিতরণের তথ্য এক জায়গায়। জেলা, ইউনিয়ন এবং গ্রাম ভিত্তিক সার্চ করুন।
                </motion.p>

                {/* Search Bar */}
                <div className="bg-white p-2 rounded-2xl shadow-2xl flex flex-col md:flex-row gap-2">
                  <div className="flex-1 flex items-center px-3 border-b md:border-b-0 md:border-r border-slate-100">
                    <MapPin size={20} className="text-slate-400 mr-2" />
                    <select 
                      value={filters.district}
                      onChange={(e) => setFilters({...filters, district: e.target.value})}
                      className="w-full py-3 bg-transparent text-slate-700 focus:outline-none appearance-none cursor-pointer"
                    >
                      <option value="">জেলা নির্বাচন করুন</option>
                      {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 flex items-center px-3 border-b md:border-b-0 md:border-r border-slate-100">
                    <Filter size={20} className="text-slate-400 mr-2" />
                    <input 
                      type="text"
                      placeholder="উপজেলা/ইউনিয়ন"
                      value={filters.upazila}
                      onChange={(e) => setFilters({...filters, upazila: e.target.value})}
                      className="w-full py-3 bg-transparent text-slate-700 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1 flex items-center px-3">
                    <Search size={20} className="text-slate-400 mr-2" />
                    <input 
                      type="text"
                      placeholder="গ্রাম/মহল্লা"
                      value={filters.village}
                      onChange={(e) => setFilters({...filters, village: e.target.value})}
                      className="w-full py-3 bg-transparent text-slate-700 focus:outline-none"
                    />
                  </div>
                  <button 
                    onClick={fetchEvents}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl font-bold transition-all"
                  >
                    খুঁজুন
                  </button>
                </div>
              </div>
            </section>

            {/* Main Content */}
            <main className="max-w-5xl mx-auto px-4 py-12">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
                <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <Calendar className="text-emerald-600" />
                  সাম্প্রতিক ইভেন্টসমূহ
                </h3>
                <div className="flex items-center gap-4">
                  <div className="bg-white border border-slate-200 p-1 rounded-xl flex">
                    <button 
                      onClick={() => setViewMode('list')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'list' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <List size={16} />
                      লিস্ট
                    </button>
                    <button 
                      onClick={() => setViewMode('map')}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${viewMode === 'map' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      <MapIcon size={16} />
                      ম্যাপ
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setFilters({...filters, type: ""})}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${filters.type === "" ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                    >
                      সব
                    </button>
                    {EVENT_TYPES.map(type => (
                      <button 
                        key={type.id}
                        onClick={() => setFilters({...filters, type: type.id})}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${filters.type === type.id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-64 bg-slate-100 rounded-3xl animate-pulse"></div>
                  ))}
                </div>
              ) : viewMode === 'list' ? (
                events.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {events.map((event) => {
                      const typeInfo = EVENT_TYPES.find(t => t.id === event.type) || EVENT_TYPES[0];
                      return (
                        <motion.div 
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          key={event.id}
                          className="bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all overflow-hidden group"
                        >
                          <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${typeInfo.bg} ${typeInfo.color}`}>
                                {typeInfo.label}
                              </span>
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => deleteEvent(event.id)}
                                  className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                                  title="ডিলিট করুন"
                                >
                                  <X size={16} />
                                </button>
                                <div className="text-slate-400 group-hover:text-emerald-600 transition-colors">
                                  <Info size={20} />
                                </div>
                              </div>
                            </div>
                            
                            <h4 className="text-xl font-bold mb-2 text-slate-900 group-hover:text-emerald-700 transition-colors">
                              {event.name}
                            </h4>
                            
                            <div className="space-y-2 mb-6">
                              <div className="flex items-center gap-2 text-slate-500 text-sm">
                                <MapPin size={16} className="text-emerald-500" />
                                <span>{event.district} {event.upazila ? `> ${event.upazila}` : ''} {event.village ? `> ${event.village}` : ''}</span>
                              </div>
                              <div className="flex items-center gap-2 text-slate-500 text-sm">
                                <Calendar size={16} className="text-emerald-500" />
                                <span className="font-medium text-slate-700">
                                  {event.event_date || event.date_range || 'তারিখ উল্লেখ নেই'}
                                  {event.event_day ? ` (${event.event_day})` : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-slate-500 text-sm">
                                <Clock size={16} className="text-emerald-500" />
                                <span>{event.start_time || 'আসরের পর'} থেকে ইফতার পর্যন্ত</span>
                              </div>
                              {event.contact && (
                                <div className="flex items-center gap-2 text-slate-500 text-sm">
                                  <Phone size={16} className="text-emerald-500" />
                                  <span>{event.contact}</span>
                                </div>
                              )}
                              {event.link_url && (
                                <div className="flex items-center gap-2 text-slate-500 text-sm">
                                  <ExternalLink size={16} className="text-emerald-500" />
                                  <a href={event.link_url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline truncate max-w-[200px]">
                                    লোকেশন লিংক
                                  </a>
                                </div>
                              )}
                            </div>

                            <div className="flex gap-2">
                              <a 
                                href={event.lat && event.lng ? `https://www.google.com/maps/search/?api=1&query=${event.lat},${event.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.name} ${event.address} ${event.village}`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 py-3 rounded-xl text-center text-[12px] font-bold transition-all flex items-center justify-center gap-1"
                              >
                                <MapPin size={14} />
                                লোকেশন
                              </a>
                              <button 
                                onClick={() => handleShare(event)}
                                className="flex-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 py-3 rounded-xl text-center text-[12px] font-bold transition-all flex items-center justify-center gap-1"
                              >
                                {copiedId === event.id.toString() ? <Check size={14} /> : <Share2 size={14} />}
                                {copiedId === event.id.toString() ? 'কপি' : 'শেয়ার'}
                              </button>
                              {isGoogleConnected && (
                                <button 
                                  onClick={() => saveToDrive(event)}
                                  disabled={isSavingToDrive === event.id.toString()}
                                  className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 py-3 rounded-xl text-center text-[12px] font-bold transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                                >
                                  {isSavingToDrive === event.id.toString() ? (
                                    <div className="w-3 h-3 border-2 border-blue-700 border-t-transparent rounded-full animate-spin"></div>
                                  ) : (
                                    <Utensils size={14} />
                                  )}
                                  ড্রাইভ
                                </button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                      <Search size={32} />
                    </div>
                    <h4 className="text-xl font-bold text-slate-800 mb-2">কোনো ইভেন্ট পাওয়া যায়নি</h4>
                    <p className="text-slate-500">আপনার এলাকায় কোনো ইভেন্ট থাকলে যুক্ত করুন।</p>
                  </div>
                )
              ) : (
                <div className="h-[600px] w-full bg-white rounded-3xl border border-slate-100 shadow-xl overflow-hidden relative">
                  <MapContainer center={[23.685, 90.3563]} zoom={7} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <MapView events={events} />
                  </MapContainer>
                </div>
              )}
            </main>

            {/* Global Share Section */}
            <section className="max-w-5xl mx-auto px-4 mb-20">
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-800 rounded-[40px] p-8 md:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl shadow-emerald-200">
                <div className="text-center md:text-left">
                  <h3 className="text-2xl md:text-3xl font-bold mb-2">অন্যদের সাথে শেয়ার করুন</h3>
                  <p className="text-emerald-100/80">সদকায়ে জারিয়া হিসেবে এই অ্যাপটি আপনার বন্ধু ও পরিবারের সাথে শেয়ার করুন।</p>
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      const text = "ইফতার সন্ধানে - আপনার এলাকার ইফতার মাহফিল ও দ্বীনি মজলিসের তথ্য খুঁজে নিন।\n" + window.location.href;
                      if (navigator.share) {
                        navigator.share({ title: 'ইফতার সন্ধানে', text, url: window.location.href });
                      } else {
                        navigator.clipboard.writeText(text);
                        alert("লিংক কপি করা হয়েছে!");
                      }
                    }}
                    className="bg-white text-emerald-700 px-8 py-4 rounded-2xl font-bold flex items-center gap-3 hover:bg-emerald-50 transition-all shadow-lg active:scale-95"
                  >
                    <Share2 size={20} />
                    অ্যাপ শেয়ার করুন
                  </button>
                </div>
              </div>
            </section>
          </motion.div>
        )}

        {currentPage === 'about' && (
          <motion.div
            key="about"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-4xl mx-auto px-4 py-16"
          >
            <div className="flex flex-col md:flex-row gap-12 items-center mb-20">
              <div className="flex-1">
                <h2 className="text-4xl font-black text-emerald-900 mb-6 leading-tight">🌐 IM Softworks</h2>
                <div className="space-y-4 text-slate-600 leading-relaxed">
                  <p className="font-medium text-lg text-emerald-800">
                    IM Softworks একটি উদীয়মান সফটওয়্যার কোম্পানি, যা ভবিষ্যতমুখী প্রযুক্তি ও সৃজনশীল সমাধানের মাধ্যমে ক্লায়েন্টদের ব্যবসায়িক সাফল্যে সহায়তা করে।
                  </p>
                  <p>
                    আমরা বিশ্বাস করি— আমাদের উন্নতি তখনই সম্ভব, যখন আমাদের ক্লায়েন্ট লাভবান হবেন। আমরা শুধু সফটওয়্যার তৈরি করি না — আমরা সম্ভাবনা গড়ে তুলি।
                  </p>
                  <p className="italic border-l-4 border-emerald-500 pl-4 py-2 bg-emerald-50">
                    IM Softworks is an emerging software company that empowers clients’ business success through futuristic technology and innovative solutions. We believe that our growth is only possible when our clients benefit.
                  </p>
                </div>
              </div>
              <div className="w-full md:w-80 h-80 rounded-3xl overflow-hidden shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500">
                <img 
                  src="https://res.cloudinary.com/dlklqihg6/image/upload/v1760308052/kkchmpjdp9izcjfvvo4k.jpg" 
                  alt="Mohammad Esa Ali" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
              <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-6">
                  <Navigation size={24} />
                </div>
                <h3 className="text-xl font-bold mb-4">🎯 আমাদের লক্ষ্য (Our Mission)</h3>
                <p className="text-emerald-700 font-bold mb-2">“আপনার লাভই আমাদের সফলতা।”</p>
                <p className="text-slate-600 text-sm">
                  আমরা প্রতিটি প্রজেক্টে বিশ্বাস করি— যদি ক্লায়েন্ট উপকৃত হন, তবেই আমরা সফল। সেই লক্ষ্যেই আমাদের প্রতিটি কোড, প্রতিটি ডিজাইন এবং প্রতিটি আইডিয়া।
                </p>
                <p className="text-slate-400 text-xs mt-4 italic">
                  “Your profit is our success.” In every project, we believe that our true achievement lies in the client’s benefit.
                </p>
              </div>

              <div className="bg-emerald-900 p-8 rounded-3xl text-white shadow-xl">
                <div className="w-12 h-12 bg-emerald-800 text-emerald-400 rounded-xl flex items-center justify-center mb-6">
                  <Info size={24} />
                </div>
                <h3 className="text-xl font-bold mb-4">👋 About Me</h3>
                <p className="text-emerald-100 mb-4">
                  Hello, I am <strong>Mohammad Esa Ali</strong>, a passionate and creative tech enthusiast.
                </p>
                <p className="text-emerald-100/70 text-sm leading-relaxed">
                  I specialize in Software Development, Web Solutions, and Creative Design. My goal is to help businesses grow by building smart, future-ready, and user-friendly digital solutions.
                </p>
                <div className="mt-6 p-4 bg-emerald-800/50 rounded-xl border border-emerald-700">
                  <p className="text-xs italic">“Success comes when your clients succeed.”</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {currentPage === 'products' && (
          <motion.div
            key="products"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-5xl mx-auto px-4 py-16"
          >
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">🛠️ Products (Section)</h2>
              <p className="text-slate-500 max-w-2xl mx-auto">
                We develop smart, scalable, and future-ready software products tailored to meet the unique needs of modern businesses.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "Automate processes", desc: "আমাদের প্রোডাক্ট আপনার ব্যবসার জটিল কাজগুলোকে সহজ ও স্বয়ংক্রিয় করবে।", icon: Navigation },
                { title: "Improve efficiency", desc: "কাজের গতি এবং নির্ভুলতা বাড়িয়ে ব্যবসায়িক প্রবৃদ্ধি নিশ্চিত করে।", icon: Info },
                { title: "Scale with confidence", desc: "ভবিষ্যতের কথা মাথায় রেখে তৈরি করা স্কেলেবল সল্যুশন।", icon: MapIcon }
              ].map((product, i) => (
                <div key={i} className="bg-white p-8 rounded-[32px] border border-slate-100 shadow-sm hover:shadow-xl transition-all">
                  <div className="w-14 h-14 bg-emerald-600 text-white rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-100">
                    <product.icon size={28} />
                  </div>
                  <h4 className="text-xl font-bold text-slate-900 mb-3">{product.title}</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">{product.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-20 p-12 bg-emerald-900 rounded-[40px] text-white text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-800 rounded-full -mr-32 -mt-32 opacity-50"></div>
              <div className="relative z-10">
                <h3 className="text-2xl font-bold mb-4">আপনার ব্যবসার জন্য সঠিক প্রোডাক্ট খুঁজছেন?</h3>
                <p className="text-emerald-100/70 mb-8 max-w-xl mx-auto">আমাদের এক্সপার্ট টিমের সাথে কথা বলুন এবং আপনার প্রয়োজন অনুযায়ী কাস্টম সল্যুশন নিন।</p>
                <button onClick={() => setCurrentPage('contact')} className="bg-white text-emerald-900 px-8 py-3 rounded-xl font-bold hover:bg-emerald-50 transition-all">যোগাযোগ করুন</button>
              </div>
            </div>
          </motion.div>
        )}

        {currentPage === 'services' && (
          <motion.div
            key="services"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-5xl mx-auto px-4 py-16"
          >
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-slate-900 mb-4">🔧 আমাদের সার্ভিসসমূহ (Our Services)</h2>
              <p className="text-slate-500">আমরা আধুনিক প্রযুক্তির মাধ্যমে আপনার ব্যবসাকে এগিয়ে নিতে সাহায্য করি।</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { title: "কাস্টম সফটওয়্যার ডেভেলপমেন্ট", en: "Custom Software Development", icon: Utensils },
                { title: "ওয়েব অ্যাপ্লিকেশন", en: "Web Applications", icon: MapIcon },
                { title: "মোবাইল অ্যাপ", en: "Mobile Apps", icon: Phone },
                { title: "ক্লাউড সল্যুশন", en: "Cloud Solutions", icon: Info },
                { title: "API ডেভেলপমেন্ট", en: "API Development", icon: Navigation },
                { title: "UI/UX ডিজাইন", en: "UI/UX Design", icon: Filter }
              ].map((service, i) => (
                <motion.div 
                  key={i}
                  whileHover={{ y: -5 }}
                  className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all"
                >
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-6">
                    <service.icon size={24} />
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-2">{service.title}</h4>
                  <p className="text-slate-400 text-sm">{service.en}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {currentPage === 'contact' && (
          <motion.div
            key="contact"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-2xl mx-auto px-4 py-16"
          >
            <div className="bg-white p-10 rounded-[40px] border border-slate-100 shadow-2xl text-center">
              <div className="w-20 h-20 bg-emerald-600 text-white rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-emerald-200">
                <Phone size={40} />
              </div>
              <h2 className="text-3xl font-bold text-slate-900 mb-4">Connect with us</h2>
              <p className="text-slate-500 mb-10">আমাদের সাথে যোগাযোগ করতে নিচের ইমেইল ব্যবহার করুন।</p>
              
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 mb-8">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Email Address</p>
                <a href="mailto:im.softwark.team@gmail.com" className="text-xl font-bold text-emerald-600 hover:text-emerald-700 transition-colors">
                  im.softwark.team@gmail.com
                </a>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button className="bg-emerald-600 text-white py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all">Message Us</button>
                <button className="bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-all">Schedule Call</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Event Modal */}
      <AnimatePresence>
        {showAddForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddForm(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-emerald-50">
                <h3 className="text-xl font-bold text-emerald-900">নতুন ইভেন্ট যুক্ত করুন</h3>
                <button 
                  onClick={() => setShowAddForm(false)}
                  className="p-2 hover:bg-white rounded-full transition-colors text-emerald-700"
                >
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">ইভেন্টের নাম *</label>
                    <input 
                      required
                      type="text"
                      placeholder="উদা: বিসমিল্লাহ জামে মসজিদ ইফতার মাহফিল"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">ধরন *</label>
                    <select 
                      required
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value})}
                    >
                      {EVENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">জেলা *</label>
                    <select 
                      required
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.district}
                      onChange={(e) => setFormData({...formData, district: e.target.value})}
                    >
                      <option value="">নির্বাচন করুন</option>
                      {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">উপজেলা/ইউনিয়ন *</label>
                    <input 
                      required
                      type="text"
                      placeholder="উদা: সোনাতলা"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.upazila}
                      onChange={(e) => setFormData({...formData, upazila: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">গ্রাম/মহল্লা *</label>
                    <input 
                      required
                      type="text"
                      placeholder="উদা: উত্তর পাড়া"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.village}
                      onChange={(e) => setFormData({...formData, village: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">বিস্তারিত ঠিকানা *</label>
                  <input 
                    required
                    type="text"
                    placeholder="রাস্তা নম্বর, ল্যান্ডমার্ক ইত্যাদি"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">তারিখ *</label>
                    <input 
                      required
                      type="text"
                      placeholder="উদা: ১০ই রমজান"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.event_date}
                      onChange={(e) => setFormData({...formData, event_date: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">বার *</label>
                    <input 
                      required
                      type="text"
                      placeholder="উদা: সোমবার"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.event_day}
                      onChange={(e) => setFormData({...formData, event_day: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">শুরুর সময়</label>
                    <input 
                      type="text"
                      placeholder="উদা: আসরের পর"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.start_time}
                      onChange={(e) => setFormData({...formData, start_time: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">যোগাযোগ নম্বর</label>
                    <input 
                      type="text"
                      placeholder="উদা: 017XXXXXXXX"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      value={formData.contact}
                      onChange={(e) => setFormData({...formData, contact: e.target.value})}
                    />
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-emerald-800 uppercase flex items-center gap-1">
                      <Navigation size={14} />
                      গুগল ড্রাইভ কানেকশন
                    </label>
                    {!isGoogleConnected ? (
                      <button 
                        type="button"
                        onClick={connectGoogle}
                        className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded-md font-bold flex items-center gap-1"
                      >
                        <Share2 size={10} />
                        ড্রাইভ কানেক্ট করুন
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                        <Check size={10} />
                        ড্রাইভ কানেক্টেড
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-emerald-700/70">
                    কানেক্ট করলে আপনার দেওয়া তথ্য স্বয়ংক্রিয়ভাবে আপনার গুগল ড্রাইভে সেভ হবে।
                  </p>
                </div>

                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-emerald-800 uppercase flex items-center gap-1">
                      <Navigation size={14} />
                      ম্যাপ লোকেশন (ঐচ্ছিক)
                    </label>
                    <button 
                      type="button"
                      onClick={getCurrentLocation}
                      className="text-[10px] bg-emerald-600 text-white px-2 py-1 rounded-md font-bold flex items-center gap-1"
                    >
                      <MapPin size={10} />
                      বর্তমান লোকেশন নিন
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input 
                      type="number"
                      step="any"
                      placeholder="অক্ষাংশ (Lat)"
                      className="w-full p-2 bg-white border border-emerald-200 rounded-lg text-xs outline-none"
                      value={formData.lat || ''}
                      onChange={(e) => setFormData({...formData, lat: parseFloat(e.target.value)})}
                    />
                    <input 
                      type="number"
                      step="any"
                      placeholder="দ্রাঘিমাংশ (Lng)"
                      className="w-full p-2 bg-white border border-emerald-200 rounded-lg text-xs outline-none"
                      value={formData.lng || ''}
                      onChange={(e) => setFormData({...formData, lng: parseFloat(e.target.value)})}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">লোকেশন লিংক (Google Maps)</label>
                  <input 
                    type="url"
                    placeholder="https://maps.app.goo.gl/..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    value={formData.link_url}
                    onChange={(e) => setFormData({...formData, link_url: e.target.value})}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">বিশেষত্ব/বিবরণ</label>
                  <textarea 
                    rows={3}
                    placeholder="ইভেন্ট সম্পর্কে কিছু লিখুন..."
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all resize-none"
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg shadow-emerald-200 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      যুক্ত হচ্ছে...
                    </>
                  ) : (
                    "ইভেন্টটি যুক্ত করুন"
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-12 px-4 mt-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                <Utensils size={18} />
              </div>
              <span className="font-bold text-slate-800 text-xl">ইফতার সন্ধানে</span>
            </div>
            <p className="text-slate-500 text-sm mb-6 max-w-sm">
              IM Softworks is an emerging software company focused on empowering businesses with futuristic technology and innovative solutions.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-all border border-slate-100">
                <Info size={18} />
              </a>
              <a href="#" className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-all border border-slate-100">
                <Phone size={18} />
              </a>
            </div>
          </div>

          <div>
            <h5 className="font-bold text-slate-900 mb-6 uppercase text-xs tracking-widest">Useful Links</h5>
            <ul className="space-y-4">
              <li><button onClick={() => setCurrentPage('iftar')} className="text-slate-500 hover:text-emerald-600 text-sm transition-colors">Home</button></li>
              <li><button onClick={() => setCurrentPage('about')} className="text-slate-500 hover:text-emerald-600 text-sm transition-colors">About us</button></li>
              <li><button onClick={() => setCurrentPage('products')} className="text-slate-500 hover:text-emerald-600 text-sm transition-colors">Products</button></li>
              <li><button onClick={() => setCurrentPage('services')} className="text-slate-500 hover:text-emerald-600 text-sm transition-colors">Services</button></li>
              <li><button onClick={() => setCurrentPage('contact')} className="text-slate-500 hover:text-emerald-600 text-sm transition-colors">Contact us</button></li>
            </ul>
          </div>

          <div>
            <h5 className="font-bold text-slate-900 mb-6 uppercase text-xs tracking-widest">Connect with us</h5>
            <p className="text-slate-500 text-sm mb-4">im.softwark.team@gmail.com</p>
            <button onClick={() => setCurrentPage('contact')} className="bg-emerald-600 text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all">Contact Us</button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto border-t border-slate-50 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-400 text-xs">Copyright © IM Softwark. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-slate-400 hover:text-emerald-600 text-xs transition-colors">Legal</a>
            <a href="#" className="text-slate-400 hover:text-emerald-600 text-xs transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
