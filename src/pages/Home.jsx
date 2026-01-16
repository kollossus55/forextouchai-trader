import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, TrendingUp, Zap, Shield, BrainCircuit, Activity, BarChart3, CheckCircle2 } from 'lucide-react';

export default function Home() {
  const navigate = useNavigate();

  const handleLogin = () => {
    navigate(createPageUrl('Overview'));
  };

  const handleGoToDashboard = () => {
    navigate(createPageUrl('Overview'));
  };

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden">
      {/* Animated Background Gradients */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-transparent rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-blue-500/20 via-purple-500/10 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-gradient-to-r from-yellow-500/10 to-orange-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="p-6 md:p-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <LineChart className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                ForexTouchAI
              </h1>
              <p className="text-xs text-slate-500">AI-Powered Trading Platform</p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            
            {/* Left Side - Hero Content */}
            <div className="space-y-8">
              <div className="space-y-4">
                <h2 className="text-5xl md:text-6xl font-bold leading-tight">
                  <span className="bg-gradient-to-r from-white via-emerald-100 to-cyan-100 bg-clip-text text-transparent">
                    Trade Smarter
                  </span>
                  <br />
                  <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                    with AI
                  </span>
                </h2>
                <p className="text-lg text-slate-400 leading-relaxed">
                  Advanced algorithmic trading powered by artificial intelligence. Connect your MT4/MT5 and let AI optimize your trading strategy in real-time.
                </p>
              </div>

              {/* Features Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl hover:border-emerald-500/30 transition-colors">
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <BrainCircuit className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">AI Signals</h3>
                    <p className="text-xs text-slate-500">Real-time analysis</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl hover:border-cyan-500/30 transition-colors">
                  <div className="p-2 bg-cyan-500/20 rounded-lg">
                    <Activity className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Auto Trading</h3>
                    <p className="text-xs text-slate-500">24/7 execution</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl hover:border-purple-500/30 transition-colors">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Shield className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Risk Control</h3>
                    <p className="text-xs text-slate-500">Smart limits</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl hover:border-blue-500/30 transition-colors">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Analytics</h3>
                    <p className="text-xs text-slate-500">Deep insights</p>
                  </div>
                </div>
              </div>

              {/* CTA Button */}
              <div className="flex gap-3">
                <Button 
                  onClick={handleLogin}
                  size="lg"
                  className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-cyan-600 hover:from-emerald-700 hover:via-emerald-600 hover:to-cyan-700 text-white text-lg px-12 py-6 shadow-2xl shadow-emerald-500/30 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                  <span className="relative flex items-center gap-2">
                    Login
                    <TrendingUp className="w-5 h-5" />
                  </span>
                </Button>
                <Button 
                  onClick={handleGoToDashboard}
                  size="lg"
                  className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white text-lg px-12 py-6 border border-cyan-500/50 shadow-lg shadow-cyan-500/20"
                >
                  Sign Up
                </Button>
              </div>
            </div>

            {/* Right Side - Feature Cards */}
            <div className="hidden lg:block space-y-6">
              <Card className="bg-gradient-to-br from-slate-900/90 to-slate-900/50 border-slate-800/50 backdrop-blur-xl shadow-2xl">
                <CardHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-emerald-500/20 rounded-lg">
                      <Zap className="w-5 h-5 text-emerald-400" />
                    </div>
                    <CardTitle className="text-white">AI Market Scanner</CardTitle>
                  </div>
                  <CardDescription className="text-slate-400">
                    Intelligent signal generation across all pairs with confidence scoring
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/30">
                      <span className="text-sm text-slate-300">Multi-timeframe analysis</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/30">
                      <span className="text-sm text-slate-300">Technical indicators</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800/30">
                      <span className="text-sm text-slate-300">Pattern recognition</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-5 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 rounded-xl">
                  <div className="text-3xl font-bold text-emerald-400 mb-1">95%+</div>
                  <div className="text-xs text-slate-400">Signal Accuracy</div>
                </div>
                <div className="p-5 bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border border-cyan-500/30 rounded-xl">
                  <div className="text-3xl font-bold text-cyan-400 mb-1">24/7</div>
                  <div className="text-xs text-slate-400">Market Monitoring</div>
                </div>
              </div>
            </div>

          </div>
        </main>

        {/* Footer */}
        <footer className="p-6 text-center text-xs text-slate-500">
          <p>© 2026 ForexTouchAI. Advanced AI Trading Platform.</p>
        </footer>
      </div>
    </div>
  );
}