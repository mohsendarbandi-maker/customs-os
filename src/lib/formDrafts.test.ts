import { describe, expect, it } from 'vitest';
import { formDraftKey } from '../hooks/useAutosavedDraft';

describe('form draft keys', () => {
  it('scopes drafts to both the current user and form instance', () => {
    expect(formDraftKey('user-a', 'shipment-first')).not.toBe(
      formDraftKey('user-b', 'shipment-first'),
    );
    expect(formDraftKey('user-a', 'shipment-a')).not.toBe(
      formDraftKey('user-a', 'shipment-b'),
    );
  });

  it('does not create a shared draft key without an authenticated user', () => {
    expect(formDraftKey(null, 'shipment-first')).toBe('');
    expect(formDraftKey(undefined, 'shipment-first')).toBe('');
  });

  it('escapes form identifiers before storing them in a localStorage key', () => {
    expect(formDraftKey('user / 1', 'stage:2?shipment=4')).toContain(
      encodeURIComponent('stage:2?shipment=4'),
    );
  });
});
