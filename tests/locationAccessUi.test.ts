import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLocationPromptForAction } from '../src/services/locationAccess.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const validationSource = readFileSync(new URL('../src/services/measurementValidation.ts', import.meta.url), 'utf8');
const bestSpotSource = readFileSync(new URL('../src/services/bestSpot.ts', import.meta.url), 'utf8');

describe('non-blocking location access UI', () => {
  test('website shell renders independently of location state; no global location modal is mounted', () => {
    assert.match(appSource, /<main style=\{styles\.mainContent\}/);
    assert.doesNotMatch(appSource, /!locationIsUsable\s*&&\s*<AccessibleDialog/);
    assert.match(appSource, /<div role="status" aria-live="polite" style=\{dialogStyles\.locationStatus\}/);
  });

  test('denied, stale, or unavailable location prompts only when a location action is invoked', () => {
    for (const action of ['measure', 'best-spot'] as const) {
      assert.equal(getLocationPromptForAction(action, false), action);
      assert.equal(getLocationPromptForAction(action, true), null);
    }
    const statusCallback = appSource.match(/const handleLocationStatusChange = useCallback\(([\s\S]*?)\n  \}, \[\]\);/)?.[1] ?? '';
    assert.match(statusCallback, /setLocationStatus/);
    assert.doesNotMatch(statusCallback, /setActiveLocationPrompt/);
  });

  test('cancel and Escape dismiss the contextual prompt without a global reopen condition', () => {
    assert.match(appSource, /onClose=\{dismissLocationPrompt\}/);
    assert.match(appSource, />Cancel<\/button>/);
    assert.match(appSource, /const dismissLocationPrompt = \(\) =>/);
  });

  test('fresh lower-confidence GPS permits actions, while the preferred target remains separate', () => {
    assert.equal(getLocationPromptForAction('measure', true), null);
    assert.equal(getLocationPromptForAction('best-spot', true), null);
    assert.match(validationSource, /PREFERRED_GPS_ACCURACY_METERS = 10/);
    assert.match(bestSpotSource, /FIND_BEST_SPOT_RADIUS_METERS = 10/);
  });
});
