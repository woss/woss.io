import { browser } from '$app/environment';
import { DISMISSED_TOURS_KEY } from './constants';
import { TOUR_DEFINITIONS, type TourDefinition } from './tour-config';

export const tourState = $state({
  dismissedFeatures: [] as string[],
  activeTour: undefined as TourDefinition | undefined,
});

let _initialized = false;

export function initTourState(userId: string, isOwner?: boolean): void {
  if (!browser || !userId || _initialized) return;
  if (isOwner !== undefined && !isOwner) return;
  _initialized = true;

  let initialFeatures: string[] = [];
  try {
    const local = localStorage.getItem(DISMISSED_TOURS_KEY);
    if (local) {
      initialFeatures = JSON.parse(local);
      tourState.activeTour = TOUR_DEFINITIONS.find((t) => !initialFeatures.includes(t.featureId));
    }
  } catch {}
  // Sync from server (may have dismissed from another device)
  fetch(`/api/tours?userId=${encodeURIComponent(userId)}`)
    .then((r) => r.json())
    .then((data) => {
      const serverDismissed: string[] = data.dismissed ?? [];
      tourState.dismissedFeatures = [...new Set([...initialFeatures, ...serverDismissed])];
      localStorage.setItem(DISMISSED_TOURS_KEY, JSON.stringify(tourState.dismissedFeatures));
      tourState.activeTour = TOUR_DEFINITIONS.find((t) => !tourState.dismissedFeatures.includes(t.featureId));
    })
    .catch(() => {});
}

export function handleDismissTour(userId: string): void {
  if (!tourState.activeTour || !userId) return;
  fetch('/api/tours/dismiss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, featureIds: [tourState.activeTour.featureId] }),
  }).catch(() => {});
  tourState.dismissedFeatures = [...tourState.dismissedFeatures, tourState.activeTour.featureId];
  // Persist locally so dismiss survives navigation even if server POST fails
  localStorage.setItem(DISMISSED_TOURS_KEY, JSON.stringify(tourState.dismissedFeatures));
  tourState.activeTour = TOUR_DEFINITIONS.find((t) => !tourState.dismissedFeatures.includes(t.featureId));
}
