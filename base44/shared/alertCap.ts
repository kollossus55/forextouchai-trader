// Shared alert-creation cap: once ALERT_CAP unread alerts exist, stop creating
// new ones until the user reads/clears them. Prevents notification spam buildup
// across monitorRiskLimits, monitorStaleTrades, connectionWatchdog, monitorBotPerformance.
export const ALERT_CAP = 15;

export async function createAlertCapped(base44, alertData) {
  try {
    const existing = await base44.asServiceRole.entities.Alert.filter({ is_read: false }, '-created_date', ALERT_CAP);
    if (existing && existing.length >= ALERT_CAP) {
      console.log(`[alertCap] Skipping alert "${alertData.title}" — ${existing.length} unread alerts at cap`);
      return null;
    }
  } catch (e) {
    console.error('[alertCap] cap check failed, allowing create:', e.message);
  }
  return await base44.asServiceRole.entities.Alert.create({ ...alertData, is_read: false });
}