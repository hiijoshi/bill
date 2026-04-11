'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';

const LOGIN_HREF = '/login';
const DEMO_SECTION_HREF = '#book-demo';
const FEATURES_SECTION_HREF = '#features';
const CONTACT_SECTION_HREF = '#contact';

export default function MandiTradePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navbarScrolled, setNavbarScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setNavbarScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleFormSubmit = (e: React.FormEvent, type: string) => {
    e.preventDefault();
    alert(type === 'demo' ? 'Thank you for booking a demo! Our team will contact you shortly.' : 'Thank you for your message! We\'ll get back to you soon.');
    (e.target as HTMLFormElement).reset();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <style jsx global>{`
        * { font-family: 'Inter', sans-serif; }
        .glassmorphism { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.3); }
        .card-hover { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .card-hover:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08); }
        .btn-glow { position: relative; overflow: hidden; transition: all 0.3s ease; }
        .btn-glow::before { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent); transition: left 0.5s ease; }
        .btn-glow:hover::before { left: 100%; }
        .floating-card { animation: float 6s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-20px); } }
        .dashboard-mockup { background: linear-gradient(180deg, #0F172A 0%, #1E293B 100%); border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); }
        .tag-badge { font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
        .nav-blur { backdrop-filter: blur(12px); }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #F1F5F9; }
        ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
      `}</style>

      {/* Navbar */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-white/80 nav-blur ${navbarScrolled ? 'shadow-md' : 'shadow-sm'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
                <i className="fas fa-chart-line text-white text-lg"></i>
              </div>
              <span className="text-xl font-bold text-slate-800">MandiTrade</span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Features</a>
              <a href="#pricing" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Pricing</a>
              <a href="#about" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">About</a>
              <a href="#contact" className="text-gray-600 hover:text-blue-600 transition-colors text-sm font-medium">Contact</a>
            </div>
            <div className="hidden md:flex items-center space-x-4">
              <Link href={LOGIN_HREF} className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors">
                Login
              </Link>
              <a href={DEMO_SECTION_HREF} className="btn-glow bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-md hover:shadow-lg">
                Book a Demo
              </a>
            </div>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-lg hover:bg-gray-100">
              <i className="fas fa-bars text-xl text-gray-700"></i>
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-200">
            <div className="px-4 py-4 space-y-3">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-gray-700 hover:text-blue-600 py-2 text-sm font-medium">Features</a>
              <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block text-gray-700 hover:text-blue-600 py-2 text-sm font-medium">Pricing</a>
              <a href="#about" onClick={() => setMobileMenuOpen(false)} className="block text-gray-700 hover:text-blue-600 py-2 text-sm font-medium">About</a>
              <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="block text-gray-700 hover:text-blue-600 py-2 text-sm font-medium">Contact</a>
              <Link href={LOGIN_HREF} onClick={() => setMobileMenuOpen(false)} className="block text-gray-700 hover:text-blue-600 py-2 text-sm font-medium">
                Login
              </Link>
              <a href={DEMO_SECTION_HREF} onClick={() => setMobileMenuOpen(false)} className="block w-full btn-glow bg-blue-600 hover:bg-blue-700 text-center text-white px-5 py-2.5 rounded-lg text-sm font-semibold mt-2">
                Book a Demo
              </a>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="pt-24 pb-16 lg:pt-32 lg:pb-24 bg-gradient-to-br from-blue-50/50 via-white to-blue-100/30 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="space-y-8 fade-in">
              <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-200 rounded-full px-4 py-2">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <span className="tag-badge text-blue-700 font-semibold">Trusted by 500+ Mandi Traders</span>
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-800 leading-tight">
                Smart Business Management for <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-blue-400">Mandi Traders</span>
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 leading-relaxed max-w-xl">
                Track purchases, sales, stock, and payments in one powerful dashboard. Simplify your trading operations and grow your business.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href={DEMO_SECTION_HREF} className="btn-glow bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl text-base font-semibold transition-all shadow-lg hover:shadow-xl flex items-center justify-center space-x-2">
                  <span>Book a Demo</span>
                  <i className="fas fa-arrow-right"></i>
                </a>
                <a href={FEATURES_SECTION_HREF} className="bg-white hover:bg-gray-50 text-slate-800 px-8 py-4 rounded-xl text-base font-semibold transition-all border border-slate-200 shadow-sm hover:shadow flex items-center justify-center space-x-2">
                  <i className="fas fa-play-circle text-blue-600"></i>
                  <span>View Features</span>
                </a>
              </div>
              <div className="flex items-center space-x-6 pt-4">
                <div className="flex -space-x-3">
                  <img src="https://i.pravatar.cc/40?img=1" alt="User" className="w-10 h-10 rounded-full border-2 border-white" />
                  <img src="https://i.pravatar.cc/40?img=2" alt="User" className="w-10 h-10 rounded-full border-2 border-white" />
                  <img src="https://i.pravatar.cc/40?img=3" alt="User" className="w-10 h-10 rounded-full border-2 border-white" />
                  <img src="https://i.pravatar.cc/40?img=4" alt="User" className="w-10 h-10 rounded-full border-2 border-white" />
                </div>
                <div>
                  <div className="flex items-center space-x-1">
                    {[...Array(5)].map((_, i) => <i key={i} className="fas fa-star text-yellow-400"></i>)}
                    <span className="ml-2 font-bold text-slate-800">4.8</span>
                  </div>
                  <p className="text-sm text-gray-500">from 200+ reviews</p>
                </div>
              </div>
            </div>
            <div className="relative fade-in floating-card">
              <div className="dashboard-mockup p-6 relative">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                      <i className="fas fa-chart-bar text-white text-sm"></i>
                    </div>
                    <span className="text-white font-semibold">Dashboard Overview</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="tag-badge bg-green-500/20 text-green-400 px-3 py-1 rounded-full font-semibold">Active</span>
                    <span className="tag-badge bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full font-semibold">1 Company</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
                    <p className="text-gray-400 text-xs mb-1">Today's Sales</p>
                    <p className="text-white text-2xl font-bold">₹45,230</p>
                    <p className="text-green-400 text-xs mt-1"><i className="fas fa-arrow-up"></i> +12.5%</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-4 backdrop-blur">
                    <p className="text-gray-400 text-xs mb-1">Pending Payments</p>
                    <p className="text-white text-2xl font-bold">₹12,450</p>
                    <p className="text-red-400 text-xs mt-1"><i className="fas fa-clock"></i> 3 pending</p>
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 mb-4">
                  <p className="text-gray-400 text-xs mb-3">Weekly Performance</p>
                  <div className="flex items-end space-x-2 h-24">
                    {[40, 60, 45, 80, 65, 90, 75].map((height, i) => (
                      <div key={i} className={`flex-1 bg-blue-600/${30 + i * 10} rounded-t`} style={{ height: `${height}%` }}></div>
                    ))}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <p className="text-gray-400 text-xs mb-3">Recent Transactions</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                        <span className="text-white text-sm">Sale - Wheat</span>
                      </div>
                      <span className="text-green-400 text-sm font-semibold">+₹8,500</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                        <span className="text-white text-sm">Purchase - Rice</span>
                      </div>
                      <span className="text-red-400 text-sm font-semibold">-₹15,200</span>
                    </div>
                  </div>
                </div>
                <div className="absolute -top-4 -right-4 bg-white rounded-xl shadow-xl p-4 hidden lg:block">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <i className="fas fa-check text-green-600"></i>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Payment Received</p>
                      <p className="text-xs text-gray-500">Just now</p>
                    </div>
                  </div>
                </div>
                <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-xl p-4 hidden lg:block">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <i className="fas fa-bell text-blue-600"></i>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Stock Alert</p>
                      <p className="text-xs text-gray-500">Low inventory</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 fade-in">
            <span className="tag-badge bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">Features</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 mt-6 mb-4">
              Everything You Need to Manage Your Trading Business
            </h2>
            <p className="text-lg text-gray-600">
              Powerful tools designed specifically for mandi traders to streamline operations and boost productivity.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: 'fas fa-chart-pie', color: 'blue', title: 'Business Overview', desc: 'Get a complete snapshot of your business performance with real-time analytics and insights at your fingertips.' },
              { icon: 'fas fa-boxes-stacked', color: 'green', title: 'Stock Management', desc: 'Track inventory levels, manage stock movements, and get alerts for low stock automatically.' },
              { icon: 'fas fa-wallet', color: 'purple', title: 'Payment Tracking', desc: 'Monitor incoming and outgoing payments, track dues, and maintain complete financial records effortlessly.' },
              { icon: 'fas fa-bell', color: 'orange', title: 'Alerts & Insights', desc: 'Stay informed with smart notifications about payments, stock levels, and important business metrics.' },
              { icon: 'fas fa-building', color: 'cyan', title: 'Multi-Company Support', desc: 'Manage multiple business entities from a single dashboard with easy switching and consolidated reports.' },
              { icon: 'fas fa-file-export', color: 'red', title: 'Reports & Export', desc: 'Generate detailed reports, export data in multiple formats, and share insights with stakeholders easily.' }
            ].map((feature, i) => (
              <div key={i} className="card-hover bg-white rounded-2xl p-8 border border-slate-200 shadow-sm fade-in">
                <div className={`w-14 h-14 bg-${feature.color}-50 rounded-xl flex items-center justify-center mb-6`}>
                  <i className={`${feature.icon} text-2xl text-${feature.color}-600`}></i>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-3">{feature.title}</h3>
                <p className="text-gray-600 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 fade-in">
            <span className="tag-badge bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">Testimonials</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 mt-6 mb-4">Loved by Traders Across India</h2>
            <div className="flex items-center justify-center space-x-2 mt-6">
              <div className="flex items-center space-x-1">
                {[...Array(5)].map((_, i) => <i key={i} className="fas fa-star text-yellow-400 text-xl"></i>)}
              </div>
              <span className="text-2xl font-bold text-slate-800 ml-2">4.8</span>
              <span className="text-gray-500 ml-2">average rating</span>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { name: 'Rajesh Kumar', role: 'Grain Trader, Punjab', img: 11, text: 'MandiTrade has completely transformed how I manage my grain trading business. The dashboard is incredibly intuitive and saves me hours every day.' },
              { name: 'Priya Sharma', role: 'Commodity Trader, MP', img: 12, text: 'The payment tracking feature is a game-changer. I no longer miss any due payments and my cash flow has improved significantly.' },
              { name: 'Amit Patel', role: 'Business Owner, Gujarat', img: 13, text: 'Best investment for my business! The multi-company support helps me manage both my retail and wholesale operations seamlessly.' }
            ].map((testimonial, i) => (
              <div key={i} className="card-hover bg-white rounded-2xl p-8 border border-slate-200 shadow-sm fade-in">
                <div className="flex items-center space-x-1 mb-4">
                  {[...Array(5)].map((_, j) => <i key={j} className="fas fa-star text-yellow-400"></i>)}
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed">"{testimonial.text}"</p>
                <div className="flex items-center space-x-4">
                  <img src={`https://i.pravatar.cc/48?img=${testimonial.img}`} alt={testimonial.name} className="w-12 h-12 rounded-full" />
                  <div>
                    <p className="font-semibold text-slate-800">{testimonial.name}</p>
                    <p className="text-sm text-gray-500">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section id="about" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 fade-in">
            <span className="tag-badge bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">Our Team</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 mt-6 mb-4">Meet the People Behind MandiTrade</h2>
            <p className="text-lg text-gray-600">A passionate team dedicated to empowering mandi traders with technology.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { name: 'Vikram Singh', role: 'CEO & Founder', img: 32, gradient: 'from-blue-100 to-blue-200' },
              { name: 'Ananya Desai', role: 'CTO', img: 44, gradient: 'from-purple-100 to-purple-200' },
              { name: 'Rahul Mehta', role: 'Head of Product', img: 53, gradient: 'from-green-100 to-green-200' },
              { name: 'Sneha Reddy', role: 'Head of Sales', img: 47, gradient: 'from-orange-100 to-orange-200' }
            ].map((member, i) => (
              <div key={i} className="card-hover bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm fade-in">
                <div className={`aspect-square bg-gradient-to-br ${member.gradient} flex items-center justify-center`}>
                  <img src={`https://i.pravatar.cc/150?img=${member.img}`} alt={member.name} className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-lg" />
                </div>
                <div className="p-6 text-center">
                  <h3 className="font-bold text-slate-800 text-lg">{member.name}</h3>
                  <p className="text-blue-600 text-sm font-medium mb-4">{member.role}</p>
                  <div className="flex items-center justify-center space-x-3">
                    <a href="#" className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all">
                      <i className="fab fa-linkedin-in text-sm"></i>
                    </a>
                    <a href="#" className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center hover:bg-blue-600 hover:text-white transition-all">
                      <i className="fab fa-twitter text-sm"></i>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Book a Demo Section */}
      <section id="book-demo" className="py-20 bg-gradient-to-br from-slate-800 to-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-blue-600 rounded-full filter blur-3xl"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-400 rounded-full filter blur-3xl"></div>
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-12 fade-in">
            <span className="tag-badge bg-white/10 text-white px-4 py-2 rounded-full font-semibold">Get Started</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mt-6 mb-4">Schedule a Demo With Us</h2>
            <p className="text-lg text-gray-300 max-w-2xl mx-auto">See how MandiTrade can transform your business. Book a personalized demo with our team.</p>
          </div>
          <div className="glassmorphism rounded-3xl p-8 lg:p-12 fade-in">
            <form onSubmit={(e) => handleFormSubmit(e, 'demo')} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Full Name *</label>
                  <input type="text" required placeholder="Enter your name" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Email Address *</label>
                  <input type="email" required placeholder="Enter your email" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white" />
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Company Name *</label>
                  <input type="text" required placeholder="Your company name" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Phone Number</label>
                  <input type="tel" placeholder="+91 XXXXX XXXXX" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">Preferred Time Slot *</label>
                <select required className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white">
                  <option value="">Select a time slot</option>
                  <option value="morning">Morning (9 AM - 12 PM)</option>
                  <option value="afternoon">Afternoon (12 PM - 3 PM)</option>
                  <option value="evening">Evening (3 PM - 6 PM)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">Message (Optional)</label>
                <textarea rows={4} placeholder="Tell us about your requirements..." className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all bg-white resize-none"></textarea>
              </div>
              <button type="submit" className="btn-glow w-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl text-base font-semibold transition-all shadow-lg hover:shadow-xl flex items-center justify-center space-x-2">
                <span>Confirm Booking</span>
                <i className="fas fa-calendar-check"></i>
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 fade-in">
            <span className="tag-badge bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">Pricing</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 mt-6 mb-4">Simple, Transparent Pricing</h2>
            <p className="text-lg text-gray-600">Choose the plan that fits your business needs. No hidden fees.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { name: 'Starter', price: '₹999', desc: 'Perfect for small traders', features: ['1 Company', 'Basic Stock Tracking', 'Payment Management', 'Email Support'], disabled: ['Advanced Reports'], popular: false, dark: false },
              { name: 'Professional', price: '₹2,499', desc: 'For growing businesses', features: ['Up to 3 Companies', 'Advanced Stock Analytics', 'Complete Payment Suite', 'Priority Support', 'Advanced Reports & Export'], disabled: [], popular: true, dark: true },
              { name: 'Enterprise', price: 'Custom', desc: 'For large operations', features: ['Unlimited Companies', 'Custom Integrations', 'Dedicated Account Manager', '24/7 Phone Support', 'On-premise Deployment'], disabled: [], popular: false, dark: false }
            ].map((plan, i) => (
              <div key={i} className={`card-hover rounded-2xl p-8 shadow-xl relative fade-in ${plan.dark ? 'bg-slate-800 transform scale-105' : 'bg-white border border-slate-200 shadow-sm'} ${plan.popular ? 'transform scale-105' : ''}`}>
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-600 text-white text-sm font-bold px-4 py-1 rounded-full">Most Popular</span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-xl font-bold mb-2 ${plan.dark ? 'text-white' : 'text-slate-800'}`}>{plan.name}</h3>
                  <p className={`text-sm ${plan.dark ? 'text-gray-400' : 'text-gray-500'}`}>{plan.desc}</p>
                </div>
                <div className="mb-6">
                  <span className={`text-4xl font-bold ${plan.dark ? 'text-white' : 'text-slate-800'}`}>{plan.price}</span>
                  {plan.price !== 'Custom' && <span className={plan.dark ? 'text-gray-400' : 'text-gray-500'}>/month</span>}
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, j) => (
                    <li key={j} className="flex items-center space-x-3">
                      <i className={`fas fa-check ${plan.dark ? 'text-blue-400' : 'text-green-500'}`}></i>
                      <span className={plan.dark ? 'text-gray-300' : 'text-gray-600'}>{feature}</span>
                    </li>
                  ))}
                  {plan.disabled.map((feature, j) => (
                    <li key={j} className="flex items-center space-x-3 text-gray-400">
                      <i className="fas fa-times"></i>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                {plan.price === 'Custom' ? (
                  <a href={CONTACT_SECTION_HREF} className={`block w-full px-6 py-3 rounded-xl text-center font-semibold transition-all ${plan.dark ? 'btn-glow bg-blue-600 hover:bg-blue-700 text-white shadow-lg' : 'bg-slate-100 hover:bg-gray-200 text-slate-800'}`}>
                    Contact Sales
                  </a>
                ) : (
                  <Link href={LOGIN_HREF} className={`block w-full px-6 py-3 rounded-xl text-center font-semibold transition-all ${plan.dark ? 'btn-glow bg-blue-600 hover:bg-blue-700 text-white shadow-lg' : 'bg-slate-100 hover:bg-gray-200 text-slate-800'}`}>
                    Get Started
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 fade-in">
            <span className="tag-badge bg-blue-50 text-blue-600 px-4 py-2 rounded-full font-semibold">Contact Us</span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-800 mt-6 mb-4">Get In Touch</h2>
            <p className="text-lg text-gray-600">Have questions? We'd love to hear from you. Send us a message and we'll respond as soon as possible.</p>
          </div>
          <div className="grid lg:grid-cols-2 gap-12 max-w-6xl mx-auto">
            <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm fade-in">
              <form onSubmit={(e) => handleFormSubmit(e, 'contact')} className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Name *</label>
                  <input type="text" required placeholder="Your name" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Email *</label>
                  <input type="email" required placeholder="your@email.com" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-800 mb-2">Message *</label>
                  <textarea rows={5} required placeholder="How can we help you?" className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 transition-all resize-none"></textarea>
                </div>
                <button type="submit" className="btn-glow w-full bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl">Send Message</button>
              </form>
            </div>
            <div className="space-y-8 fade-in">
              {[
                { icon: 'fas fa-envelope', color: 'blue', title: 'Email Us', content: ['For general inquiries:', 'hello@manditrade.com', 'For support:', 'support@manditrade.com'] },
                { icon: 'fas fa-phone', color: 'green', title: 'Call Us', content: ['Mon-Fri from 9am to 6pm:', '+91 98765 43210'] },
                { icon: 'fas fa-map-marker-alt', color: 'purple', title: 'Visit Us', content: ['MandiTrade HQ', '123 Business Park, Sector 18', 'Gurugram, Haryana 122002', 'India'] }
              ].map((contact, i) => (
                <div key={i} className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm card-hover">
                  <div className="flex items-start space-x-4">
                    <div className={`w-12 h-12 bg-${contact.color}-50 rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <i className={`${contact.icon} text-${contact.color}-600 text-xl`}></i>
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg mb-2">{contact.title}</h3>
                      {contact.content.map((line, j) => (
                        <p key={j} className={`${j % 2 === 0 ? 'text-gray-600' : 'text-blue-600 hover:underline font-medium'} ${j > 0 ? 'mt-1' : ''}`}>
                          {line.includes('@') || line.includes('+91') ? (
                            <a href={line.includes('@') ? `mailto:${line}` : `tel:${line}`}>{line}</a>
                          ) : line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
            <div className="lg:col-span-1">
              <div className="flex items-center space-x-2 mb-6">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <i className="fas fa-chart-line text-white text-lg"></i>
                </div>
                <span className="text-xl font-bold">MandiTrade</span>
              </div>
              <p className="text-gray-400 mb-6 leading-relaxed">Empowering mandi traders with smart business management solutions since 2020.</p>
              <div className="flex items-center space-x-4">
                {['facebook-f', 'twitter', 'linkedin-in', 'instagram'].map((social, i) => (
                  <a key={i} href="#" className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center hover:bg-blue-600 transition-all">
                    <i className={`fab fa-${social}`}></i>
                  </a>
                ))}
              </div>
            </div>
            {[
              { title: 'Product', links: ['Features', 'Pricing', 'Integrations', 'Updates', 'Beta Program'] },
              { title: 'Company', links: ['About Us', 'Careers', 'Blog', 'Press Kit', 'Contact'] },
              { title: 'Support', links: ['Help Center', 'Documentation', 'API Reference', 'Community', 'Status Page'] }
            ].map((column, i) => (
              <div key={i}>
                <h4 className="font-semibold text-lg mb-6">{column.title}</h4>
                <ul className="space-y-3">
                  {column.links.map((link, j) => (
                    <li key={j}><a href="#" className="text-gray-400 hover:text-white transition-colors">{link}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-white/10 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <p className="text-gray-400 text-sm">© 2024 MandiTrade. All rights reserved.</p>
              <div className="flex items-center space-x-6">
                {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((link, i) => (
                  <a key={i} href="#" className="text-gray-400 hover:text-white text-sm transition-colors">{link}</a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
