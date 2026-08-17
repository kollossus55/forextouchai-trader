import React, { useState } from 'react';
import { UserPlus, Loader2, Mail, Shield, User } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  const queryClient = useQueryClient();

  const handleInvite = async (e) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      toast.error('Email is required');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      toast.error('Invalid email address');
      return;
    }
    setInviting(true);
    try {
      await base44.users.inviteUser(trimmed, role);
      toast.success('Invitation sent', { description: `${trimmed} has been invited as ${role}` });
      setEmail('');
      setRole('user');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    } catch (err) {
      const msg = err?.message || 'Failed to invite user';
      toast.error('Invitation failed', { description: msg });
    } finally {
      setInviting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/20 transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Invite User
        </button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-400" /> Invite New User
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Send an invitation email. The recipient will be able to log in once they accept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleInvite} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="invite-email" className="text-slate-300 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-500" /> Email Address
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="trader@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-slate-950 border-slate-700 text-slate-100 focus:border-emerald-500/50"
              autoFocus
              disabled={inviting}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Access Level</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('user')}
                className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${
                  role === 'user'
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'
                }`}
              >
                <User className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-200">User</p>
                  <p className="text-xs text-slate-500">Standard trading access</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${
                  role === 'admin'
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'
                }`}
              >
                <Shield className="w-4 h-4 text-amber-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-200">Admin</p>
                  <p className="text-xs text-slate-500">Full platform control</p>
                </div>
              </button>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={inviting}
              className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={inviting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
            >
              {inviting
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending…</>
                : <><UserPlus className="w-4 h-4 mr-2" /> Send Invitation</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}