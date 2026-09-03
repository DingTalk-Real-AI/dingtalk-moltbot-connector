import { describe, it, expect, beforeEach, vi } from 'vitest';
import { __testables } from '../test';

const { toLocalPath, processLocalImages, uploadMediaToDingTalk } = __testables as any;

describe('media helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('toLocalPath', () => {
    it.each([
      ['file:///tmp/image.png', '/tmp/image.png'],
      ['file:///C:/Users/a.png', '/C:/Users/a.png'],
      ['MEDIA:/var/folders/ab/cd/image.png', '/var/folders/ab/cd/image.png'],
      ['attachment:///Users/test/image.png', '/Users/test/image.png'],
      ['/Users/测试/图片%20一.png', '/Users/测试/图片 一.png'],
      ['/tmp/a.png', '/tmp/a.png'],
      ['', ''],
    ] as const)('"%s" -> "%s"', (raw, expected) => {
      expect(toLocalPath(raw)).toBe(expected);
    });

    it('should return raw when decodeURIComponent throws', () => {
      const invalid = '/path/%XXinvalid.png';
      expect(toLocalPath(invalid)).toBe(invalid);
    });
  });

  describe('processLocalImages', () => {
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    it('should return original content when oapiToken is null', async () => {
      const content = 'hello ![img](/tmp/a.png)';
      const result = await processLocalImages(content, null, log);
      expect(result).toBe(content);
      expect(log.warn).toHaveBeenCalled();
    });

    it('should return empty string when content is empty', async () => {
      const result = await processLocalImages('', 'token', log);
      expect(result).toBe('');
    });

    it('should keep the original markdown when image upload returns null', async () => {
      const content = 'hello ![img](/tmp/dingtalk-connector-missing-image-for-test.png)';
      const result = await processLocalImages(content, 'token', log);

      expect(result).toBe(content);
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('文件不存在'));
    });
  });
});
