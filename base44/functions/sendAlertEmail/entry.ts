import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();

        const alert = payload.data;
        if (!alert) {
            return Response.json({ success: false, error: 'No alert data in payload' });
        }

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
        }[alert.type] || 'ℹ️';

        const subject = `${emoji} ForexTouchAI Alert — ${alert.title}`;
        const body = `${alert.message}\n\n---\nAlert Type: ${alert.type || 'INFO'}\nTime: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}\n\nLog in to ForexTouchAI to view all your alerts.\n\nForexTouchAI — Automated Alert System`;

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