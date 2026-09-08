import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Sends connection-related notification emails to the current user.
// Narrow by design: only four fixed email types, recipient is always the
// authenticated user — not a generic email proxy.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json();
    const { type, downtimeMinutes, lastSyncTime } = payload;

    const email = user.email;
    if (!email) return Response.json({ error: 'No email on user' }, { status: 400 });

    let subject, body;

    if (type === 'disconnected') {
      subject = 'ALERT: MT4/MT5 Platform Disconnected';
      body = `Your trading platform has lost connection. Last sync: ${lastSyncTime || 'Unknown'}\n\nPlease check:\n1. MT4/MT5 is running\n2. ForexTouchAI EA is attached to a chart\n3. Internet connection is stable`;
    } else if (type === 'reconnected') {
      const mins = Math.floor(downtimeMinutes || 0);
      subject = '✅ ForexTouchAI - MT4/MT5 Connection Restored';
      body = `Your MT4/MT5 trading platform has successfully reconnected after being offline for ${mins} minute(s).\n\nConnection Status: ONLINE\nReconnected At: ${new Date().toLocaleString()}\n\nYour trading bots can now resume operations.`;
    } else if (type === 'reminder') {
      subject = 'REMINDER: MT4/MT5 Still Disconnected';
      body = `Your trading platform has been offline for ${downtimeMinutes} minutes.\n\nLast sync: ${lastSyncTime || 'Unknown'}`;
    } else if (type === 'test') {
      subject = 'ForexTouchAI: Test Alert';
      body = 'This is a test email alert to verify your notification settings. You will receive alerts here for major market events and trade executions.';
    } else {
      return Response.json({ error: 'Invalid email type' }, { status: 400 });
    }

    await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body });
    console.log(`[sendConnectionEmail] Sent "${type}" email to ${email}`);
    return Response.json({ success: true });
  } catch (error) {
    console.error('[sendConnectionEmail ERROR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}