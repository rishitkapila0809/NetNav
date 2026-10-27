export type LocationDependentAction = 'measure' | 'best-spot';

/** Called only when a user invokes an action that needs a fresh location. */
export function getLocationPromptForAction(action: LocationDependentAction, hasUsableFix: boolean): LocationDependentAction | null {
  return hasUsableFix ? null : action;
}
