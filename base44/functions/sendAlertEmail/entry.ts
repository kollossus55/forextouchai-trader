import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        if (user.role !== 'admin') return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
        const payload = await req.json();

        const alertRef = payload.data;
        if (!alertRef || !alertRef.id) {
            return Response.json({ success: false, error: 'Alert ID required' });
        }

        // Verify the alert exists in the DB and use stored content — prevents spoofing with arbitrary payload
        const realAlert = await base44.asServiceRole.entities.Alert.get(alertRef.id).catch(() => null);
        if (!realAlert) {
            return Response.json({ success: false, error: 'Alert not found' });
        }

        // Use DB-stored values (not payload) and strip CRLF to prevent header injection
        const title = String(realAlert.title || '').replace(/[\r\n]/g, ' ').slice(0, 200);
        const message = String(realAlert.message || '').replace(/[\r\n]/g, ' ').slice(0, 2000);
        const alertType = ['ERROR', 'WARNING', 'SUCCESS', 'INFO'].includes(realAlert.type) ? realAlert.type : 'INFO';

        // Get all admin users to notify
        const users = await base44.asServiceRole.entities.User.list('-created_date', 50).catch(() => []);
        const adminEmails = users.filter(u => u.role === 'admin' && u.email).map(u => u.email);

        if (adminEmails.length === 0) {
            return Response.json({ success: false, message: 'No admin emails found' });
        }

        const emoji = {
            ERROR: '🚨',
            WARNING: '⚠️',
            SUCCESS: '✅',
            INFO: 'ℹ️'
        }[alertType] || 'ℹ️';

        const subject = `${emoji} ForexTouchAI Alert — ${title}`;
        const body = `${message}\n\n---\nAlert Type: ${alertType}\nTime: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}\n\nLog in to ForexTouchAI to view all your alerts.\n\nForexTouchAI — Automated Alert System`;

        await Promise.all(
            adminEmails.map(email =>
                base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body })
                    .catch(e => console.error(`Failed to email ${email}:`, e.message))
            )
        );

        console.log(`[sendAlertEmail] Sent alert email to: ${adminEmails.join(', ')}`);
        return Response.json({ success: true, notified: adminEmails });

    } catch (error) {
        console.error('[sendAlertEmail ERROR]', error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});