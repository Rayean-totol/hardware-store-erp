import { describe, expect, it } from 'vitest';
import { scanSupport } from '@/components/barcode-scanner';

describe('camera barcode scanning support', () => {
  it('is ready only on a secure page with a camera and a barcode detector', () => {
    expect(scanSupport({ hasDetector: true, hasCamera: true, isSecureContext: true })).toBe('ready');
  });

  it('is not offered on an insecure page (browsers block the camera there)', () => {
    expect(scanSupport({ hasDetector: true, hasCamera: true, isSecureContext: false })).toBe('insecure');
  });

  it('is not offered without a camera', () => {
    expect(scanSupport({ hasDetector: true, hasCamera: false, isSecureContext: true })).toBe('no_camera');
  });

  it('is not offered where the browser has no barcode detector (typed input still works)', () => {
    expect(scanSupport({ hasDetector: false, hasCamera: true, isSecureContext: true })).toBe('no_detector');
  });
});
