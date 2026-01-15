import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { 
  User, 
  Mail, 
  Bell,
  Settings,
  Shield,
  Palette,
  Key,
  Camera,
  Save,
  TrendingUp,
  BarChart3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ColoredSlider } from '@/components/ui/colored-slider';

export default function Profile() {
  const [user, setUser] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Profile State
  const [profileData, setProfileData] = useState({
    full_name: '',
    email: '',
    profile_picture: ''
  });

  // Notification Preferences
  const [notificationPrefs, setNotificationPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem('notificationPrefs');
      return saved ? JSON.parse(saved) : {
        email_enabled: true,
        push_enabled: false,
        trade_alerts: true,
        signal_alerts: true,
        news_alerts: false,
        system_alerts: true
      };
    } catch {
      return {
        email_enabled: true,
        push_enabled: false,
        trade_alerts: true,
        signal_alerts: true,
        news_alerts: false,
        system_alerts: true
      };
    }
  });

  // Trading Settings
  const [tradingSettings, setTradingSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('tradingSettings');
      return saved ? JSON.parse(saved) : {
        default_lot_size: 0.1,
        default_risk_level: 'MEDIUM',
        default_indicators: {
          rsi: true,
          macd: true,
          bollinger: false,
          ema: true,
          stochastic: false
        }
      };
    } catch {
      return {
        default_lot_size: 0.1,
        default_risk_level: 'MEDIUM',
        default_indicators: {
          rsi: true,
          macd: true,
          bollinger: false,
          ema: true,
          stochastic: false
        }
      };
    }
  });

  // Theme Settings
  const [themeSettings, setThemeSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('themeSettings');
      return saved ? JSON.parse(saved) : {
        mode: 'dark',
        accent_color: 'emerald'
      };
    } catch {
      return {
        mode: 'dark',
        accent_color: 'emerald'
      };
    }
  });

  // API Keys
  const [apiKeys, setApiKeys] = useState(() => {
    try {
      const saved = localStorage.getItem('apiKeys');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [newApiKey, setNewApiKey] = useState({ name: '', key: '' });

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
        setProfileData({
          full_name: userData.full_name || '',
          email: userData.email || '',
          profile_picture: userData.profile_picture || ''
        });
      } catch (e) {
        console.error('Failed to fetch user:', e);
      }
    };
    fetchUser();
  }, []);

  const saveProfile = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        full_name: profileData.full_name,
        profile_picture: profileData.profile_picture
      });
      toast.success('Profile updated successfully');
    } catch (error) {
      toast.error('Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const saveNotificationPrefs = () => {
    localStorage.setItem('notificationPrefs', JSON.stringify(notificationPrefs));
    toast.success('Notification preferences saved');
  };

  const saveTradingSettings = () => {
    localStorage.setItem('tradingSettings', JSON.stringify(tradingSettings));
    toast.success('Trading settings saved');
  };

  const saveThemeSettings = () => {
    localStorage.setItem('themeSettings', JSON.stringify(themeSettings));
    toast.success('Theme settings saved');
  };

  const addApiKey = () => {
    if (!newApiKey.name || !newApiKey.key) {
      toast.error('Please fill in both fields');
      return;
    }
    const updated = [...apiKeys, { ...newApiKey, id: Date.now() }];
    setApiKeys(updated);
    localStorage.setItem('apiKeys', JSON.stringify(updated));
    setNewApiKey({ name: '', key: '' });
    toast.success('API key added');
  };

  const removeApiKey = (id) => {
    const updated = apiKeys.filter(k => k.id !== id);
    setApiKeys(updated);
    localStorage.setItem('apiKeys', JSON.stringify(updated));
    toast.success('API key removed');
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setProfileData({ ...profileData, profile_picture: file_url });
      toast.success('Image uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload image');
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <User className="w-8 h-8 text-emerald-500" /> User Profile
        </h1>
        <p className="text-slate-400 mt-1">Manage your personal information and preferences</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="bg-slate-900 border border-slate-800">
          <TabsTrigger value="profile" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <User className="w-4 h-4 mr-2" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="trading" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <TrendingUp className="w-4 h-4 mr-2" />
            Trading
          </TabsTrigger>
          <TabsTrigger value="theme" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Palette className="w-4 h-4 mr-2" />
            Theme
          </TabsTrigger>
          <TabsTrigger value="api" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Key className="w-4 h-4 mr-2" />
            API Keys
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">Profile Information</CardTitle>
              <CardDescription className="text-slate-400">
                Update your personal details and profile picture
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Picture */}
              <div className="flex items-center gap-6">
                <Avatar className="w-24 h-24 border-4 border-slate-800">
                  <AvatarImage src={profileData.profile_picture} />
                  <AvatarFallback className="bg-emerald-900 text-emerald-200 text-2xl font-bold">
                    {profileData.full_name?.charAt(0) || 'U'}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Label htmlFor="profile-pic" className="cursor-pointer">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors">
                      <Camera className="w-4 h-4" />
                      Upload Photo
                    </div>
                    <input
                      id="profile-pic"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </Label>
                  <p className="text-xs text-slate-500 mt-2">JPG, PNG or GIF. Max 2MB.</p>
                </div>
              </div>

              <Separator className="bg-slate-800" />

              {/* Name & Email */}
              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-slate-300">Full Name</Label>
                  <Input
                    id="name"
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={profileData.email}
                    disabled
                    className="bg-slate-950 border-slate-800 text-slate-500"
                  />
                  <p className="text-xs text-slate-500">Email cannot be changed</p>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={saveProfile}
                  disabled={isSaving}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">Notification Preferences</CardTitle>
              <CardDescription className="text-slate-400">
                Choose how you want to receive alerts and updates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Notification Channels */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-300">Channels</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="email-notif" className="text-slate-200">Email Notifications</Label>
                    <p className="text-xs text-slate-500">Receive alerts via email</p>
                  </div>
                  <Switch
                    id="email-notif"
                    checked={notificationPrefs.email_enabled}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, email_enabled: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="push-notif" className="text-slate-200">Push Notifications</Label>
                    <p className="text-xs text-slate-500">Browser push notifications</p>
                  </div>
                  <Switch
                    id="push-notif"
                    checked={notificationPrefs.push_enabled}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, push_enabled: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
              </div>

              <Separator className="bg-slate-800" />

              {/* Alert Types */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-300">Alert Types</h3>
                <div className="flex items-center justify-between">
                  <Label htmlFor="trade-alerts" className="text-slate-200">Trade Execution Alerts</Label>
                  <Switch
                    id="trade-alerts"
                    checked={notificationPrefs.trade_alerts}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, trade_alerts: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="signal-alerts" className="text-slate-200">AI Signal Alerts</Label>
                  <Switch
                    id="signal-alerts"
                    checked={notificationPrefs.signal_alerts}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, signal_alerts: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="news-alerts" className="text-slate-200">Market News Alerts</Label>
                  <Switch
                    id="news-alerts"
                    checked={notificationPrefs.news_alerts}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, news_alerts: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="system-alerts" className="text-slate-200">System Alerts</Label>
                  <Switch
                    id="system-alerts"
                    checked={notificationPrefs.system_alerts}
                    onCheckedChange={(c) => setNotificationPrefs({ ...notificationPrefs, system_alerts: c })}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={saveNotificationPrefs}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Preferences
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Trading Settings Tab */}
        <TabsContent value="trading" className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">Default Trading Settings</CardTitle>
              <CardDescription className="text-slate-400">
                Set your preferred defaults for trading and analysis
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Lot Size */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <Label className="text-slate-200">Default Lot Size</Label>
                  <span className="text-emerald-400 font-semibold">{tradingSettings.default_lot_size}</span>
                </div>
                <ColoredSlider
                  value={[tradingSettings.default_lot_size * 100]}
                  min={1}
                  max={100}
                  step={1}
                  onValueChange={([v]) => setTradingSettings({ ...tradingSettings, default_lot_size: v / 100 })}
                  className="py-2"
                  rangeClassName="bg-emerald-500"
                  thumbClassName="border-emerald-500"
                />
                <p className="text-xs text-slate-500">Volume for new trades (0.01 - 1.00 lots)</p>
              </div>

              <Separator className="bg-slate-800" />

              {/* Risk Level */}
              <div className="space-y-3">
                <Label className="text-slate-200">Default Risk Level</Label>
                <div className="grid grid-cols-3 gap-3">
                  {['LOW', 'MEDIUM', 'HIGH'].map(level => (
                    <button
                      key={level}
                      onClick={() => setTradingSettings({ ...tradingSettings, default_risk_level: level })}
                      className={`px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                        tradingSettings.default_risk_level === level
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  {tradingSettings.default_risk_level === 'LOW' && 'Conservative: Wider stops, lower risk'}
                  {tradingSettings.default_risk_level === 'MEDIUM' && 'Balanced: Standard risk management'}
                  {tradingSettings.default_risk_level === 'HIGH' && 'Aggressive: Tighter stops, higher risk'}
                </p>
              </div>

              <Separator className="bg-slate-800" />

              {/* Preferred Indicators */}
              <div className="space-y-3">
                <Label className="text-slate-200">Preferred Chart Indicators</Label>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ind-rsi" className="text-sm text-slate-300">RSI (14)</Label>
                    <Switch
                      id="ind-rsi"
                      checked={tradingSettings.default_indicators.rsi}
                      onCheckedChange={(c) => setTradingSettings({
                        ...tradingSettings,
                        default_indicators: { ...tradingSettings.default_indicators, rsi: c }
                      })}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ind-macd" className="text-sm text-slate-300">MACD</Label>
                    <Switch
                      id="ind-macd"
                      checked={tradingSettings.default_indicators.macd}
                      onCheckedChange={(c) => setTradingSettings({
                        ...tradingSettings,
                        default_indicators: { ...tradingSettings.default_indicators, macd: c }
                      })}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ind-bb" className="text-sm text-slate-300">Bollinger Bands</Label>
                    <Switch
                      id="ind-bb"
                      checked={tradingSettings.default_indicators.bollinger}
                      onCheckedChange={(c) => setTradingSettings({
                        ...tradingSettings,
                        default_indicators: { ...tradingSettings.default_indicators, bollinger: c }
                      })}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ind-ema" className="text-sm text-slate-300">200 EMA</Label>
                    <Switch
                      id="ind-ema"
                      checked={tradingSettings.default_indicators.ema}
                      onCheckedChange={(c) => setTradingSettings({
                        ...tradingSettings,
                        default_indicators: { ...tradingSettings.default_indicators, ema: c }
                      })}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ind-stoch" className="text-sm text-slate-300">Stochastic</Label>
                    <Switch
                      id="ind-stoch"
                      checked={tradingSettings.default_indicators.stochastic}
                      onCheckedChange={(c) => setTradingSettings({
                        ...tradingSettings,
                        default_indicators: { ...tradingSettings.default_indicators, stochastic: c }
                      })}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={saveTradingSettings}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Theme Tab */}
        <TabsContent value="theme" className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">Theme Customization</CardTitle>
              <CardDescription className="text-slate-400">
                Personalize your app's appearance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Color Mode */}
              <div className="space-y-3">
                <Label className="text-slate-200">Color Mode</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setThemeSettings({ ...themeSettings, mode: 'dark' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      themeSettings.mode === 'dark'
                        ? 'border-emerald-500 bg-slate-950'
                        : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded bg-slate-950 border border-slate-700"></div>
                      <div className="text-sm font-medium text-slate-200">Dark</div>
                    </div>
                  </button>
                  <button
                    onClick={() => setThemeSettings({ ...themeSettings, mode: 'light' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      themeSettings.mode === 'light'
                        ? 'border-emerald-500 bg-slate-950'
                        : 'border-slate-800 bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded bg-slate-100 border border-slate-300"></div>
                      <div className="text-sm font-medium text-slate-200">Light</div>
                    </div>
                  </button>
                </div>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  Light mode coming soon
                </Badge>
              </div>

              <Separator className="bg-slate-800" />

              {/* Accent Color */}
              <div className="space-y-3">
                <Label className="text-slate-200">Accent Color</Label>
                <div className="grid grid-cols-5 gap-3">
                  {[
                    { name: 'emerald', color: 'bg-emerald-500' },
                    { name: 'blue', color: 'bg-blue-500' },
                    { name: 'purple', color: 'bg-purple-500' },
                    { name: 'amber', color: 'bg-amber-500' },
                    { name: 'rose', color: 'bg-rose-500' }
                  ].map(({ name, color }) => (
                    <button
                      key={name}
                      onClick={() => setThemeSettings({ ...themeSettings, accent_color: name })}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        themeSettings.accent_color === name
                          ? 'border-white scale-105'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className={`w-full h-8 rounded ${color}`}></div>
                    </button>
                  ))}
                </div>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  Custom accents coming soon
                </Badge>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={saveThemeSettings}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Theme
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="api" className="space-y-6">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">API Key Management</CardTitle>
              <CardDescription className="text-slate-400">
                Manage third-party integration keys
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Add New Key */}
              <div className="space-y-3 p-4 bg-slate-950/50 rounded-lg border border-slate-800">
                <h3 className="text-sm font-semibold text-slate-300">Add New API Key</h3>
                <div className="grid gap-3">
                  <Input
                    placeholder="Service name (e.g., TradingView)"
                    value={newApiKey.name}
                    onChange={(e) => setNewApiKey({ ...newApiKey, name: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                  <Input
                    placeholder="API Key"
                    type="password"
                    value={newApiKey.key}
                    onChange={(e) => setNewApiKey({ ...newApiKey, key: e.target.value })}
                    className="bg-slate-950 border-slate-800 text-slate-200"
                  />
                  <Button
                    onClick={addApiKey}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Add Key
                  </Button>
                </div>
              </div>

              {/* Saved Keys */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-300">Saved API Keys</h3>
                {apiKeys.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500 bg-slate-950/30 rounded-lg border border-slate-800/30 border-dashed">
                    No API keys saved
                  </div>
                ) : (
                  <div className="space-y-2">
                    {apiKeys.map((key) => (
                      <div
                        key={key.id}
                        className="flex items-center justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800"
                      >
                        <div className="flex items-center gap-3">
                          <Shield className="w-4 h-4 text-emerald-400" />
                          <div>
                            <p className="text-sm font-medium text-slate-200">{key.name}</p>
                            <p className="text-xs text-slate-500 font-mono">••••••••••••{key.key.slice(-4)}</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => removeApiKey(key.id)}
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <p className="text-xs text-blue-400">
                  <strong>Note:</strong> API keys are stored locally in your browser. For enhanced security,
                  connect via the Settings page for supported platforms.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}