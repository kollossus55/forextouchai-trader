import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

/**
 * Subscribes to Signal entity changes and fires a desktop notification +
 * an in-app toast whenever a new 3rd-party (MANUAL_EXECUTION) signal is received.
 */
export default function useSignalNotifications({ enabled = true } = {}) {
    const permissionRef = useRef(false);

    // Request browser notification permission once
    useEffect(() => {
        if (!enabled) return;
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(p => {
                permissionRef.current = p === 'granted';
            });
        } else {
            permissionRef.current = Notification.permission === 'granted';
        }
    }, [enabled]);

    // Subscribe to Signal entity creates
    useEffect(() => {
        if (!enabled) return;

        const unsubscribe = base44.entities.Signal.subscribe((event) => {
            if (event.type !== 'create') return;
            const signal = event.data;
            if (!signal || signal.strategy !== 'MANUAL_EXECUTION') return;

            const pair = signal.pair || 'Unknown';
            const direction = signal.type || '';
            const account = signal.owner_email || 'all accounts';
            const title = `📡 Signal Received: ${pair} ${direction}`;
            const body = `Account: ${account} | Entry: ${signal.entry_price || 'Market'}`;

            // Desktop notification
            if ('Notification' in window && Notification.permission === 'granted') {
                const notif = new Notification(title, {
                    body,
                    icon: '/favicon.ico',
                    tag: `signal-${event.id}`, // prevent duplicate stacking
                });
                // Auto-close after 8s
                setTimeout(() => notif.close(), 8000);
            }

            // In-app toast (always shown)
            toast.success(title, {
                description: body,
                duration: 8000,
            });
        });

        return unsubscribe;
    }, [enabled]);
}