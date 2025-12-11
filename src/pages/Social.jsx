import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Users, 
  MessageSquare, 
  Heart, 
  Share2, 
  Send,
  MoreHorizontal,
  Trophy,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Globe,
  BrainCircuit
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import SignalCard from '@/components/dashboard/SignalCard';

export default function Social() {
  const queryClient = useQueryClient();
  const [newPostContent, setNewPostContent] = useState('');
  
  const { data: posts } = useQuery({
    queryKey: ['posts'],
    queryFn: () => base44.entities.Post.list({ sort: { created_date: -1 }, limit: 20 }),
    initialData: []
  });

  const { data: latestSignals } = useQuery({
    queryKey: ['social-signals'],
    queryFn: () => base44.entities.Signal.list({ sort: { created_date: -1 }, limit: 2 }),
    initialData: []
  });

  const createPost = useMutation({
    mutationFn: (data) => base44.entities.Post.create(data),
    onSuccess: () => {
      setNewPostContent('');
      queryClient.invalidateQueries(['posts']);
    }
  });

  const handlePost = async () => {
    if (!newPostContent.trim()) return;
    
    // In a real app, we'd get the real user name
    const user = await base44.auth.me().catch(() => ({ full_name: 'Trader' }));
    
    createPost.mutate({
      content: newPostContent,
      author_name: user.full_name || 'Anonymous Trader',
      likes: 0,
      comments_count: 0,
      is_pro_trader: true // Mocking this
    });
  };

  // Mock Leaderboard Data
  const topTraders = [
    { name: "Alex Momentum", pnl: "+145%", winRate: "78%", rank: 1 },
    { name: "Sarah Scalps", pnl: "+112%", winRate: "82%", rank: 2 },
    { name: "Forex King", pnl: "+89%", winRate: "65%", rank: 3 },
    { name: "Macro Mike", pnl: "+67%", winRate: "60%", rank: 4 },
  ];

  // Mock Sentiment Data
  const sentimentData = [
    { pair: "EUR/USD", bullish: 65, volume: "High" },
    { pair: "GBP/USD", bullish: 42, volume: "Med" },
    { pair: "XAU/USD", bullish: 82, volume: "High" },
    { pair: "USD/JPY", bullish: 55, volume: "Low" },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="w-8 h-8 text-emerald-500" /> Community Feed
          </h1>
          <p className="text-slate-400 mt-1">Connect with top traders and share strategies</p>
        </div>
        <div className="flex gap-2">
            <Button className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all shadow-lg shadow-emerald-900/10">
                <Globe className="w-4 h-4 mr-2" /> Global Chat
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Create Post */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardContent className="p-4">
              <Textarea 
                placeholder="What's your market outlook today? Share a trade idea..." 
                className="bg-slate-950/50 border-slate-800 text-slate-200 min-h-[100px] mb-4 focus:border-emerald-500/50"
                value={newPostContent}
                onChange={(e) => setNewPostContent(e.target.value)}
              />
              <div className="flex justify-between items-center">
                <div className="flex gap-2">
                  <Button variant="ghost" size="icon" className="text-slate-400 hover:text-emerald-400">
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-slate-400 hover:text-emerald-400">
                    <BarChart2 className="w-4 h-4" />
                  </Button>
                </div>
                <Button 
                  onClick={handlePost} 
                  disabled={!newPostContent.trim()}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Send className="w-4 h-4 mr-2" /> Post
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Feed */}
          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.id} className="bg-slate-900/50 border-slate-800 backdrop-blur-sm hover:border-slate-700 transition-colors">
                <CardHeader className="p-4 pb-0 flex flex-row items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-slate-700 cursor-pointer hover:border-emerald-500/50 transition-colors">
                      <AvatarImage src="" />
                      <AvatarFallback className="bg-emerald-900 text-emerald-200 font-bold">
                        {post.author_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-200 hover:text-emerald-400 cursor-pointer transition-colors">{post.author_name}</p>
                        {post.is_pro_trader && (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400 text-[10px] h-5 border border-emerald-500/20">
                            PRO
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{new Date(post.created_date).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="text-slate-500 hover:text-slate-300">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </CardHeader>
                <CardContent className="p-4">
                  <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{post.content}</p>
                  
                  <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-800/50">
                    <button className="flex items-center gap-2 text-sm text-slate-400 hover:text-rose-400 transition-colors group">
                      <Heart className="w-4 h-4 group-hover:fill-current" /> 
                      <span>{post.likes}</span>
                    </button>
                    <button className="flex items-center gap-2 text-sm text-slate-400 hover:text-blue-400 transition-colors">
                      <MessageSquare className="w-4 h-4" /> 
                      <span>{post.comments_count}</span>
                    </button>
                    <button className="flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400 transition-colors ml-auto">
                      <Share2 className="w-4 h-4" /> 
                      <span>Share</span>
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {posts.length === 0 && (
              <div className="text-center py-10 text-slate-500 bg-slate-900/20 rounded-lg border border-dashed border-slate-800">
                <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p>No posts yet. Be the first to share your analysis!</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Widgets */}
        <div className="space-y-6">
          
          {/* Top Traders Leaderboard */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <Trophy className="w-4 h-4 text-amber-400" /> Top Traders (Weekly)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-slate-800">
                {topTraders.map((trader) => (
                  <div key={trader.rank} className="p-4 flex items-center justify-between hover:bg-slate-800/30 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 flex items-center justify-center rounded font-bold text-xs ${
                        trader.rank === 1 ? 'bg-amber-400/20 text-amber-400' : 
                        trader.rank === 2 ? 'bg-slate-300/20 text-slate-300' : 
                        trader.rank === 3 ? 'bg-orange-400/20 text-orange-400' : 'bg-slate-800 text-slate-500'
                      }`}>
                        {trader.rank}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-200">{trader.name}</p>
                        <p className="text-xs text-slate-500">Win Rate: {trader.winRate}</p>
                      </div>
                    </div>
                    <span className="text-emerald-400 font-bold text-sm">{trader.pnl}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Market Sentiment Widget */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <BarChart2 className="w-4 h-4 text-blue-400" /> Community Sentiment
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">Real-time user bias</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sentimentData.map((item) => (
                <div key={item.pair}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-300">{item.pair}</span>
                    <span className={item.bullish > 50 ? 'text-emerald-400' : 'text-rose-400'}>
                      {item.bullish}% Buy
                    </span>
                  </div>
                  <div className="flex h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full transition-all" 
                      style={{ width: `${item.bullish}%` }}
                    ></div>
                    <div 
                      className="bg-rose-500 h-full transition-all" 
                      style={{ width: `${100 - item.bullish}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Latest AI Signals Widget for Social */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
             <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <BrainCircuit className="w-4 h-4 text-purple-400" /> Trending Signals
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">High confidence setups</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
               {latestSignals.map(signal => (
                 <SignalCard key={signal.id} signal={signal} />
               ))}
               {latestSignals.length === 0 && (
                 <div className="text-center text-xs text-slate-500 py-4">No recent signals</div>
               )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}