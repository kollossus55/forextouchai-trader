import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  Users, 
  MessageSquare, 
  Heart, 
  Share2, 
  Send,
  MoreHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export default function Social() {
  const queryClient = useQueryClient();
  const [newPostContent, setNewPostContent] = useState('');
  
  const { data: posts } = useQuery({
    queryKey: ['posts'],
    queryFn: () => base44.entities.Post.list({ sort: { created_date: -1 }, limit: 20 }),
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

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white">Trader Community</h1>
        <p className="text-slate-400 mt-1">Share ideas, strategies, and success stories</p>
      </div>

      {/* Create Post */}
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
        <CardContent className="p-4">
          <Textarea 
            placeholder="What's your market outlook today?" 
            className="bg-slate-950/50 border-slate-800 text-slate-200 min-h-[100px] mb-4 focus:border-emerald-500/50"
            value={newPostContent}
            onChange={(e) => setNewPostContent(e.target.value)}
          />
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-emerald-400">
                <Share2 className="w-4 h-4" />
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
          <Card key={post.id} className="bg-slate-900/50 border-slate-800 backdrop-blur-sm">
            <CardHeader className="p-4 pb-0 flex flex-row items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="w-10 h-10 border border-slate-700">
                  <AvatarImage src="" />
                  <AvatarFallback className="bg-emerald-900 text-emerald-200 font-bold">
                    {post.author_name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-200">{post.author_name}</p>
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
              <p className="text-slate-300 whitespace-pre-wrap">{post.content}</p>
              
              <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-800/50">
                <button className="flex items-center gap-2 text-sm text-slate-400 hover:text-rose-400 transition-colors">
                  <Heart className="w-4 h-4" /> 
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
          <div className="text-center py-10 text-slate-500">
            No posts yet. Be the first to share!
          </div>
        )}
      </div>
    </div>
  );
}